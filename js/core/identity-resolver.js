/* U.Venice Transport — provider-neutral Identity Resolver.
   Resolves canonical Observations to concrete TripInstances conservatively.
   No TransitState semantics and no long-term vehicle history are implemented here. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitIdentityResolver');

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    vehicleCorrelationTtlSec:1200,
    candidateBeforeSec:7200,
    candidateAfterSec:7200,
    gpsStopMaxM:450,
    gpsStopStrongM:180,
    gpsShapeMaxM:180,
    gpsTimeMaxSec:1800,
    minScore:30,
    minMargin:8,
    maxAlternatives:4
  });

  function parseClock(value){
    const m=/^(\d+):(\d{2}):(\d{2})$/.exec(text(value));
    if(!m)return null;
    const h=Number(m[1]),mi=Number(m[2]),s=Number(m[3]);
    return mi<60&&s<60?h*3600+mi*60+s:null;
  }

  function angleDiff(a,b){
    a=finite(a);b=finite(b);if(a===null||b===null)return null;
    let d=Math.abs((a-b)%360);if(d>180)d=360-d;return d;
  }

  function defaultTripKeys(value){
    value=text(value);return value?[value]:[];
  }

  function routeKeys(route){
    if(!route)return [];
    const id=text(route.id),short=text(route.short),long=text(route.long),desc=text(route.desc),keys=[];
    for(const x of [id,short,long,short&&desc?short+'_'+desc:''])if(x&&!keys.includes(x))keys.push(x);
    return keys;
  }

  function stopEvidenceRows(observation){
    const rows=[];
    if(observation?.stopId||observation?.stopSequence!==null&&observation?.stopSequence!==undefined){
      rows.push({id:text(observation.stopId),sequence:finite(observation.stopSequence)});
    }
    for(const u of observation?.stopTimeUpdates||[]){
      const row={id:text(u?.stopId),sequence:finite(u?.stopSequence)};
      if(row.id||row.sequence!==null)rows.push(row);
      if(rows.length>=8)break;
    }
    return rows;
  }

  function routeCompatible(instance,externalRouteId){
    externalRouteId=text(externalRouteId);if(!externalRouteId)return true;
    return routeKeys(instance.route).includes(externalRouteId);
  }

  function directionCompatible(instance,directionId){
    directionId=finite(directionId);
    return directionId===null||instance.direction===null||String(instance.direction)===String(directionId);
  }

  function stopMatch(instance,row){
    if(!row)return {exact:false,loose:false,index:null,source:null,conflict:false};
    if(row.sequence!==null){
      const i=instance.stops.findIndex(s=>Number(s.sequence)===Number(row.sequence));
      if(i>=0){
        if(row.id&&instance.stops[i].id===row.id)return {exact:true,loose:true,index:i,source:'sequence_id',conflict:false};
        return {exact:false,loose:true,index:i,source:'sequence',conflict:!!row.id};
      }
    }
    if(row.id){
      const i=instance.stops.findIndex(s=>s.id===row.id);
      if(i>=0)return {exact:false,loose:true,index:i,source:'id',conflict:false};
    }
    return {exact:false,loose:false,index:null,source:null,conflict:false};
  }

  function stopTimingEvidence(instance,observation){
    let best=null;
    for(const update of observation?.stopTimeUpdates||[]){
      const match=stopMatch(instance,{id:text(update?.stopId),sequence:finite(update?.stopSequence)});
      if(!match.loose||match.index===null)continue;
      const planned=instance.stops[match.index];
      for(const [kind,event,target] of [
        ['arrival',update?.arrival,planned.plannedArrival],
        ['departure',update?.departure,planned.plannedDeparture]
      ]){
        if(!event)continue;
        const scheduled=finite(event.scheduledTime);
        const eventTime=finite(event.time);
        const eventDelay=finite(event.delay)??finite(observation.delay);
        const inferred=scheduled!==null?scheduled:(eventTime!==null&&eventDelay!==null?eventTime-eventDelay:null);
        let delta=null,weight=0,source='';
        if(inferred!==null){
          delta=Math.abs(inferred-target);source='scheduled';
          if(delta<=60)weight=12;else if(delta<=180)weight=9;else if(delta<=600)weight=5;
        }else if(eventTime!==null){
          delta=Math.abs(eventTime-target);source='actual';
          if(delta<=600)weight=3;else if(delta<=1800)weight=2;else if(delta<=5400)weight=1;
        }
        if(weight&&(!best||weight>best.weight||weight===best.weight&&delta<best.deltaSec))
          best={type:'stop_time',weight,deltaSec:delta,stopIndex:match.index,event:kind,source};
      }
    }
    return best;
  }

  function nearestStop(instance,position){
    if(!position)return null;
    let best=null;
    for(let i=0;i<instance.stops.length;i++){
      const stop=instance.stops[i]?.stop;
      if(!Number.isFinite(stop?.lat)||!Number.isFinite(stop?.lon))continue;
      const distance=G.distanceM(position,{lat:stop.lat,lon:stop.lon});
      if(!best||distance<best.distance)best={index:i,distance,stop:instance.stops[i]};
    }
    return best;
  }

  function resultBase(observation){
    return {
      observationId:observation?.id||null,
      provider:observation?.provider||null,
      network:observation?.network||null,
      externalVehicleId:observation?.externalVehicleId||null,
      externalTripId:observation?.externalTripId||null,
      externalRouteId:observation?.externalRouteId||null
    };
  }

  class IdentityResolver{
    constructor({servicePlan,expectedPosition,tripKeys,continuityStore,options}){
      if(!servicePlan||typeof servicePlan.instances!=='function')throw new Error('IdentityResolver: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.tripKeys=typeof tripKeys==='function'?tripKeys:defaultTripKeys;
      this.continuityStore=continuityStore||null;
      this.options={...DEFAULTS,...(options||{})};
      this.byTripKey=new Map();
      this.routesByKey=new Map();
      this.vehicleLinks=new Map();
      for(const instance of servicePlan.instances()){
        for(const key of this._tripKeys(instance.tripId))this._add(this.byTripKey,key,instance);
        for(const key of routeKeys(instance.route))this._add(this.routesByKey,key,instance.route.id);
      }
    }

    _add(map,key,value){
      key=text(key);if(!key)return;
      if(!map.has(key))map.set(key,[]);
      const rows=map.get(key);
      if(!rows.includes(value))rows.push(value);
    }

    _tripKeys(value){
      const raw=this.tripKeys(value),rows=Array.isArray(raw)?raw:[raw];
      return [...new Set(rows.map(text).filter(Boolean))];
    }

    _dateFilter(rows,observation){
      let out=rows;
      if(observation.serviceDate)out=out.filter(x=>x.serviceDate===observation.serviceDate);
      const at=finite(observation.observedAt);
      if(at!==null&&out.length>1){
        const near=out.filter(x=>x.plannedEnd>=at-this.options.candidateBeforeSec&&x.plannedStart<=at+this.options.candidateAfterSec);
        if(near.length)out=near;
      }
      return out;
    }

    _exactOrAlias(observation){
      const raw=text(observation.externalTripId);if(!raw)return null;
      const exact=this._dateFilter(this.servicePlan.instances().filter(x=>x.tripId===raw),observation);
      if(exact.length===1)return this._matched(observation,exact[0],'exact',1,[{type:'trip_id_exact',weight:1000}]);
      if(exact.length>1)return null;

      const found=new Map();
      for(const key of this._tripKeys(raw))for(const instance of this.byTripKey.get(key)||[])found.set(instance.id,instance);
      let rows=this._dateFilter([...found.values()],observation);
      const route=text(observation.externalRouteId),knownRouteIds=route?[...new Set(this.routesByKey.get(route)||[])]:[];
      if(knownRouteIds.length)rows=rows.filter(x=>knownRouteIds.includes(x.route.id));
      if(finite(observation.directionId)!==null)rows=rows.filter(x=>directionCompatible(x,observation.directionId));
      if(rows.length===1)return this._matched(observation,rows[0],'trip_matched',.99,[{type:'trip_id_cross_generation',weight:900}]);
      return null;
    }

    _vehicleCorrelation(observation){
      const vehicle=text(observation.externalVehicleId),at=finite(observation.observedAt);
      if(!vehicle)return null;
      const now=at??finite(observation.receivedAt)??0;
      let link=this.vehicleLinks.get(vehicle)||null,source='batch';
      if(link&&now&&link.at&&now-link.at>this.options.vehicleCorrelationTtlSec){
        this.vehicleLinks.delete(vehicle);link=null;
      }
      if(!link&&this.continuityStore&&typeof this.continuityStore.correlation==='function'){
        link=this.continuityStore.correlation(vehicle,{
          provider:observation.provider||this.servicePlan.provider,
          network:observation.network||this.servicePlan.network,
          now
        });
        source='history';
      }
      if(!link)return null;
      const instance=this.servicePlan.get(link.tripInstanceId);
      if(!instance){if(source==='batch')this.vehicleLinks.delete(vehicle);return null}
      if(observation.serviceDate&&instance.serviceDate!==observation.serviceDate)return null;
      if(observation.externalRouteId&&!routeCompatible(instance,observation.externalRouteId))return null;
      if(!directionCompatible(instance,observation.directionId))return null;
      if(source==='history'&&observation.externalTripId){
        const observedKeys=new Set(this._tripKeys(observation.externalTripId));
        const compatible=this._tripKeys(instance.tripId).some(k=>observedKeys.has(k));
        if(!compatible)return null;
      }
      const confidence=source==='history'?Math.min(.94,Number(link.confidence)||0):Math.min(.98,link.confidence);
      return this._matched(observation,instance,'vehicle_correlated',confidence,[
        {type:source==='history'?'vehicle_history_continuity':'vehicle_id_correlation',weight:source==='history'?760:800,ageSec:now&&link.at?Math.max(0,now-link.at):null}
      ]);
    }

    _candidatePool(observation,hints){
      const at=finite(observation.observedAt);
      let rows=observation.serviceDate
        ?this.servicePlan.forServiceDate(observation.serviceDate)
        :(at!==null?this.servicePlan.around(at,this.options.candidateBeforeSec,this.options.candidateAfterSec):this.servicePlan.instances());

      const candidateIds=new Set((hints?.candidateTripInstanceIds||[]).map(text).filter(Boolean));
      if(candidateIds.size)rows=rows.filter(x=>candidateIds.has(x.id));

      const route=text(observation.externalRouteId);
      if(route){
        const knownRouteIds=[...new Set(this.routesByKey.get(route)||[])];
        if(knownRouteIds.length)rows=rows.filter(x=>knownRouteIds.includes(x.route.id));
      }
      const direction=finite(observation.directionId);
      if(direction!==null)rows=rows.filter(x=>directionCompatible(x,direction));

      const stopRows=stopEvidenceRows(observation);
      if(stopRows.length){
        const filtered=rows.filter(instance=>stopRows.some(row=>stopMatch(instance,row).loose));
        if(filtered.length)rows=filtered;
      }
      return rows;
    }

    _score(instance,observation){
      let score=0;
      const evidence=[];
      const route=text(observation.externalRouteId);
      if(route&&routeCompatible(instance,route)){score+=18;evidence.push({type:'route',weight:18})}
      const direction=finite(observation.directionId);
      if(direction!==null&&instance.direction!==null&&String(direction)===String(instance.direction)){
        score+=8;evidence.push({type:'direction',weight:8});
      }

      const start=parseClock(observation.startTime);
      if(start!==null){
        const delta=Math.abs(start-instance.plannedStartServiceSec);
        let weight=0;
        if(delta<=60)weight=22;else if(delta<=180)weight=17;else if(delta<=600)weight=10;else if(delta<=1800)weight=4;
        if(weight){score+=weight;evidence.push({type:'start_time',weight,deltaSec:delta})}
      }

      let bestStop=null;
      for(const row of stopEvidenceRows(observation)){
        const m=stopMatch(instance,row);
        if(!m.loose)continue;
        const weight=m.exact?24:(m.source==='id'?12:8);
        const type=m.exact?'stop_sequence_id':m.source==='sequence'?'stop_sequence':'stop';
        if(!bestStop||weight>bestStop.weight)bestStop={type,weight,index:m.index,conflict:m.conflict||false};
      }
      if(bestStop){score+=bestStop.weight;evidence.push(bestStop)}
      const stopTime=stopTimingEvidence(instance,observation);
      if(stopTime){score+=stopTime.weight;evidence.push(stopTime)}

      const at=finite(observation.observedAt);
      if(at!==null){
        const before=instance.plannedStart-at,after=at-instance.plannedEnd;
        if(before<=900&&after<=900){score+=6;evidence.push({type:'timetable_window',weight:6})}
        else if(before<=3600&&after<=3600){score+=2;evidence.push({type:'timetable_window',weight:2})}
      }

      let gpsStop=null,gpsShape=null,bearingEvidence=null;
      if(observation.position){
        const near=nearestStop(instance,observation.position);
        if(near&&near.distance<=this.options.gpsStopMaxM){
          let weight=near.distance<=this.options.gpsStopStrongM?18:8;
          if(bestStop&&bestStop.index===near.index)weight+=6;
          gpsStop={type:'gps_near_stop',weight,distanceM:near.distance,index:near.index};
          score+=weight;evidence.push(gpsStop);
        }

        if(this.expectedPosition){
          const geometry=this.expectedPosition.geometry(instance);
          if(geometry?.shape){
            const projection=G.projectToShape(geometry.shape,observation.position);
            if(projection&&projection.distance<=this.options.gpsShapeMaxM){
              const expectedAtProgress=this.expectedPosition.timeAtProgress(instance,projection.progress,at);
              const timeDelta=at!==null&&expectedAtProgress!==null?Math.abs(at-expectedAtProgress):null;
              if(timeDelta===null||timeDelta<=this.options.gpsTimeMaxSec){
                let weight=projection.distance<=60?20:12;
                if(timeDelta!==null){
                  if(timeDelta<=300)weight+=18;
                  else if(timeDelta<=900)weight+=10;
                  else weight+=4;
                }
                gpsShape={type:'gps_shape',weight,distanceM:projection.distance,shapeProgress:projection.progress,timeDeltaSec:timeDelta};
                score+=weight;evidence.push(gpsShape);
                const useBearing=finite(observation.bearing)!==null&&(finite(observation.speed)===null||finite(observation.speed)>=2);
                if(useBearing){
                  const shapeBearing=G.bearingAt(geometry.shape,projection.progress);
                  const delta=angleDiff(observation.bearing,shapeBearing);
                  if(delta!==null&&delta<=65){
                    const bw=delta<=25?7:3;score+=bw;
                    bearingEvidence={type:'bearing_progress',weight:bw,deltaDeg:delta};
                    evidence.push(bearingEvidence);
                  }else if(delta!==null&&delta>100){
                    score-=10;evidence.push({type:'bearing_conflict',weight:-10,deltaDeg:delta});
                  }
                }
              }
            }
          }
        }
      }

      const strongest=gpsShape?'gps_shape_matched':gpsStop?'gps_stop_matched':'trip_matched';
      return {instance,score,evidence,strongest,gpsShape,gpsStop,bearingEvidence};
    }

    _routeOnly(observation,alternatives){
      const key=text(observation.externalRouteId);if(!key)return null;
      const ids=[...new Set(this.routesByKey.get(key)||[])];
      if(ids.length!==1)return null;
      return Object.freeze({
        ...resultBase(observation),
        classification:'route_only',matched:false,tripInstanceId:null,routeId:ids[0],
        confidence:.8,evidence:Object.freeze([{type:'route_unique',weight:1}]),
        alternatives:Object.freeze((alternatives||[]).map(x=>Object.freeze({...x})))
      });
    }

    _matched(observation,instance,classification,confidence,evidence,alternatives){
      const result=Object.freeze({
        ...resultBase(observation),
        classification,matched:true,tripInstanceId:instance.id,routeId:instance.route.id,
        confidence:clamp(Number(confidence)||0,0,1),
        evidence:Object.freeze((evidence||[]).map(x=>Object.freeze({...x}))),
        alternatives:Object.freeze((alternatives||[]).map(x=>Object.freeze({...x})))
      });
      this._remember(result,observation);
      return result;
    }

    _remember(result,observation){
      const vehicle=text(observation.externalVehicleId),at=finite(observation.observedAt)??finite(observation.receivedAt);
      if(!vehicle||!result.matched||result.confidence<.8||!result.tripInstanceId)return;
      this.vehicleLinks.set(vehicle,{tripInstanceId:result.tripInstanceId,at:at??0,confidence:result.confidence});
    }

    resolve(observation,hints){
      if(!observation)return null;
      const wrongProvider=observation.provider&&this.servicePlan.provider&&observation.provider!==this.servicePlan.provider;
      const wrongNetwork=observation.network&&this.servicePlan.network&&observation.network!==this.servicePlan.network;
      if(wrongProvider||wrongNetwork)return Object.freeze({
        ...resultBase(observation),classification:'unknown',matched:false,tripInstanceId:null,routeId:null,
        confidence:0,evidence:Object.freeze([{type:'scope_mismatch',weight:0}]),alternatives:Object.freeze([])
      });
      if(observation.kind==='entity_deleted')return Object.freeze({
        ...resultBase(observation),classification:'unknown',matched:false,tripInstanceId:null,routeId:null,
        confidence:0,evidence:Object.freeze([{type:'entity_deleted',weight:0}]),alternatives:Object.freeze([])
      });

      const direct=this._exactOrAlias(observation);if(direct)return direct;
      const correlated=this._vehicleCorrelation(observation);if(correlated)return correlated;

      const ranked=this._candidatePool(observation,hints).map(instance=>this._score(instance,observation))
        .filter(x=>x.evidence.length&&x.score>0)
        .sort((a,b)=>b.score-a.score||a.instance.id.localeCompare(b.instance.id));

      if(ranked.length){
        const best=ranked[0],second=ranked[1],margin=second?best.score-second.score:best.score;
        const acceptable=best.score>=this.options.minScore&&(!second||margin>=this.options.minMargin);
        if(acceptable){
          const confidence=clamp(.55+best.score/140+(second?Math.min(.15,margin/100):.12),0,1);
          const alternatives=ranked.slice(1,1+this.options.maxAlternatives).map(x=>({
            tripInstanceId:x.instance.id,score:x.score
          }));
          return this._matched(observation,best.instance,best.strongest,confidence,best.evidence,alternatives);
        }
      }

      const alternatives=ranked.slice(0,this.options.maxAlternatives).map(x=>({tripInstanceId:x.instance.id,score:x.score}));
      const routeOnly=this._routeOnly(observation,alternatives);if(routeOnly)return routeOnly;
      return Object.freeze({
        ...resultBase(observation),
        classification:'unknown',matched:false,tripInstanceId:null,routeId:null,confidence:0,
        evidence:Object.freeze(ranked[0]?[{type:'ambiguous_or_weak',weight:ranked[0].score}]:[]),
        alternatives:Object.freeze(alternatives.map(x=>Object.freeze({...x})))
      });
    }

    resolveBatch(observations){
      const rows=[];
      if(this.continuityStore)this.vehicleLinks.clear();
      /* TripUpdates usually carry stronger timetable evidence; process them first
         so a vehicle id can conservatively correlate a subsequent position. */
      const ordered=[...(observations||[])].sort((a,b)=>
        (a.kind==='trip_update'?0:1)-(b.kind==='trip_update'?0:1)||
        (finite(a.observedAt)??0)-(finite(b.observedAt)??0)
      );
      for(const observation of ordered)rows.push(this.resolve(observation));
      return Object.freeze(rows);
    }

    forgetVehicle(vehicleId){this.vehicleLinks.delete(text(vehicleId))}
    clearCorrelations(){this.vehicleLinks.clear()}
    summary(resolutions){
      const rows=resolutions||[],classes={};
      let matched=0;
      for(const r of rows){classes[r.classification]=(classes[r.classification]||0)+1;if(r.matched)matched++}
      return {resolutions:rows.length,matched,unmatched:rows.length-matched,classes,vehicleCorrelations:this.vehicleLinks.size};
    }
  }

  function createIdentityResolver(args){return new IdentityResolver(args)}

  global.UVTransitIdentityResolver=Object.freeze({
    IdentityResolver,createIdentityResolver,
    _test:Object.freeze({parseClock,angleDiff,routeKeys,stopMatch,stopTimingEvidence,nearestStop})
  });
})(window);
