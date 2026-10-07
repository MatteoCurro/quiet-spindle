/* U.Venice Transport — diagnostic DerivedEventEngine.
   Consumes immutable TransitState snapshots and produces derived operational
   hypotheses. Derived events never become official service alerts. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitDerivedEvents');

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    historySnapshots:12,
    historyMaxAgeSec:1800,
    persistentDelaySec:300,
    persistentDelaySamples:3,
    persistentDelayMinSec:120,
    stoppedMinSec:180,
    stoppedProgressM:35,
    stoppedMinDelaySec:180,
    offShapeDistanceM:250,
    coverageBaselineSamples:3,
    coverageBaselineMin:.65,
    coverageCurrentMax:.35,
    coverageDropMin:.3,
    coverageMinExpectedTrips:4,
    consecutiveMissingTrips:2,
    maxEvidenceAgeSec:120
  });

  function frozenRows(rows){return Object.freeze((rows||[]).map(x=>Object.freeze({...x})))}
  function eventId(provider,network,type,scopeKey){
    return ['derived',text(provider)||'unknown',text(network)||'unknown',type,text(scopeKey)||'network'].join(':');
  }
  function routeKeys(instance){
    const route=instance?.route||{},rows=[];
    for(const key of [route.id,route.short,route.short&&route.desc?route.short+'_'+route.desc:'']){
      const x=text(key).toUpperCase();if(x&&!rows.includes(x))rows.push(x);
    }
    return rows;
  }
  function eventRouteKeys(candidate,servicePlan){
    const rows=[];
    for(const routeId of candidate.scope?.routeIds||[]){
      const key=text(routeId).toUpperCase();if(key&&!rows.includes(key))rows.push(key);
      for(const instance of servicePlan.instances()){
        if(instance.route?.id!==routeId)continue;
        for(const alias of routeKeys(instance))if(!rows.includes(alias))rows.push(alias);
        break;
      }
    }
    return rows;
  }
  function officialOverlap(candidate,officialAlerts,servicePlan){
    const wanted=new Set(eventRouteKeys(candidate,servicePlan));
    const ids=[];
    for(const alert of officialAlerts||[]){
      if(!alert||alert.lifecycle==='resolved')continue;
      const lines=(alert.scope?.lines||[]).map(x=>text(x).toUpperCase()).filter(Boolean);
      const routeMatch=lines.some(x=>wanted.has(x));
      const networkMatch=!(alert.scope?.networks||[]).length||
        (alert.scope.networks||[]).map(x=>text(x).toLowerCase()).includes(text(candidate.network).toLowerCase());
      if(routeMatch&&networkMatch&&alert.id)ids.push(String(alert.id));
    }
    return Object.freeze({matched:ids.length>0,alertIds:Object.freeze([...new Set(ids)])});
  }

  class DerivedEventSnapshot{
    constructor({provider,network,generatedAt,active,resolved,inputSummary}){
      this.provider=provider;this.network=network;this.generatedAt=generatedAt;
      this.active=Object.freeze(active);this.resolved=Object.freeze(resolved);
      this.events=Object.freeze([...active,...resolved]);
      this.inputSummary=Object.freeze({...inputSummary});
      Object.freeze(this);
    }
    byType(type){return this.active.filter(x=>x.type===type)}
    summary(){
      const types={},severity={},officialOverlap={matched:0,unmatched:0};
      for(const event of this.active){
        types[event.type]=(types[event.type]||0)+1;
        severity[event.severity]=(severity[event.severity]||0)+1;
        officialOverlap[event.officialOverlap?.matched?'matched':'unmatched']++;
      }
      return {
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        active:this.active.length,resolved:this.resolved.length,types,severity,officialOverlap,
        input:{...this.inputSummary}
      };
    }
  }

  class DerivedEventEngine{
    constructor({servicePlan,expectedPosition,options}){
      if(!servicePlan||typeof servicePlan.get!=='function')
        throw new Error('DerivedEventEngine: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.options={...DEFAULTS,...(options||{})};
      this.snapshots=[];
      this.delayHistory=new Map();
      this.progressHistory=new Map();
      this.coverageHistory=[];
      this.activeEvents=new Map();
    }

    _push(map,key,row,now){
      if(!map.has(key))map.set(key,[]);
      const rows=map.get(key);
      if(rows.length&&rows.at(-1).at===row.at)rows[rows.length-1]=row;
      else rows.push(row);
      const cutoff=now-this.options.historyMaxAgeSec;
      while(rows.length&&rows[0].at<cutoff)rows.shift();
    }

    _record(snapshot){
      const now=snapshot.generatedAt;
      this.snapshots.push(snapshot);
      while(this.snapshots.length>this.options.historySnapshots)this.snapshots.shift();
      while(this.snapshots.length&&this.snapshots[0].generatedAt<now-this.options.historyMaxAgeSec)this.snapshots.shift();

      const activeTrips=snapshot.tripStates.filter(x=>x.active);
      const expected=activeTrips.length;
      const observed=activeTrips.filter(x=>['observed','predicted_live'].includes(x.status)).length;
      const coverage=expected?observed/expected:1;
      this.coverageHistory.push({at:now,expected,observed,coverage});
      while(this.coverageHistory.length>this.options.historySnapshots)this.coverageHistory.shift();
      while(this.coverageHistory.length&&this.coverageHistory[0].at<now-this.options.historyMaxAgeSec)this.coverageHistory.shift();

      for(const trip of snapshot.tripStates){
        const delay=finite(trip.delay?.value);
        if(delay!==null&&trip.delay?.source!=='schedule_only'){
          const evidenceAt=finite(trip.delay?.observedAt);
          if(evidenceAt!==null)this._push(this.delayHistory,trip.tripInstanceId,{
            at:evidenceAt,value:delay,confidence:finite(trip.delay?.confidence)??0,source:trip.delay?.source||null
          },now);
        }
        const progress=finite(trip.motion?.shapeProgress?.value);
        if(progress!==null&&trip.active&&['live','predicted_live'].includes(trip.motionMode)){
          const evidenceAt=finite(trip.motion?.shapeProgress?.observedAt)??finite(trip.motion?.position?.observedAt);
          if(evidenceAt!==null)this._push(this.progressHistory,trip.tripInstanceId,{
            at:evidenceAt,progress,mode:trip.motionMode,
            confidence:finite(trip.motion?.shapeProgress?.confidence)??0
          },now);
        }
      }
    }

    _tripExpectedUnobserved(snapshot){
      const out=[];
      for(const trip of snapshot.tripStates){
        if(!['expected_unobserved','likely_missing'].includes(trip.status))continue;
        out.push({
          type:'trip_expected_unobserved',
          severity:trip.status==='likely_missing'?'major':'minor',
          confidence:trip.status==='likely_missing'?(finite(trip.confidence)??.6):.5,
          scope:{tripInstanceIds:[trip.tripInstanceId],routeIds:[trip.routeId],vehicleIds:[]},
          scopeKey:trip.tripInstanceId,
          evidence:[
            {type:'trip_state',status:trip.status},
            {type:'observation_age',ageSec:trip.observationAgeSec??null}
          ]
        });
      }
      return out;
    }

    _consecutiveMissing(snapshot){
      const byRoute=new Map();
      for(const trip of snapshot.tripStates){
        if(!trip.routeId)continue;
        if(!byRoute.has(trip.routeId))byRoute.set(trip.routeId,[]);
        byRoute.get(trip.routeId).push(trip);
      }
      const out=[];
      for(const [routeId,rows] of byRoute){
        rows.sort((a,b)=>a.plannedStart-b.plannedStart||a.tripInstanceId.localeCompare(b.tripInstanceId));
        let run=[];
        const flush=()=>{
          if(run.length>=this.options.consecutiveMissingTrips){
            const ids=run.map(x=>x.tripInstanceId);
            const confidence=clamp(run.reduce((n,x)=>n+(finite(x.confidence)??.55),0)/run.length,0,1);
            out.push({
              type:'consecutive_missing_trips',severity:run.length>=3?'critical':'major',
              confidence,
              scope:{tripInstanceIds:ids,routeIds:[routeId],vehicleIds:[]},
              scopeKey:routeId+':'+ids[0]+':'+ids.at(-1),
              evidence:[{type:'consecutive_likely_missing',count:run.length}]
            });
          }
          run=[];
        };
        for(const trip of rows){
          if(trip.status==='likely_missing')run.push(trip);else flush();
        }
        flush();
      }
      return out;
    }

    _persistentDelay(snapshot){
      const out=[];
      for(const trip of snapshot.tripStates){
        const currentDelay=finite(trip.delay?.value);
        if(currentDelay===null||currentDelay<this.options.persistentDelaySec||
           trip.delay?.source==='schedule_only')continue;
        const rows=this.delayHistory.get(trip.tripInstanceId)||[];
        const qualifying=[];
        for(let i=rows.length-1;i>=0;i--){
          if(rows[i].value<this.options.persistentDelaySec)break;
          qualifying.unshift(rows[i]);
        }
        if(qualifying.length<this.options.persistentDelaySamples)continue;
        const duration=qualifying.at(-1).at-qualifying[0].at;
        if(duration<this.options.persistentDelayMinSec)continue;
        const latest=qualifying.at(-1),avg=qualifying.reduce((n,x)=>n+x.value,0)/qualifying.length;
        const confidence=clamp(qualifying.reduce((n,x)=>n+x.confidence,0)/qualifying.length,0,1);
        out.push({
          type:'persistent_delay',severity:avg>=600?'major':'minor',confidence,
          scope:{tripInstanceIds:[trip.tripInstanceId],routeIds:[trip.routeId],vehicleIds:[]},
          scopeKey:trip.tripInstanceId,
          evidence:[
            {type:'delay_samples',count:qualifying.length,durationSec:duration},
            {type:'delay',latestSec:latest.value,averageSec:Math.round(avg),source:latest.source}
          ]
        });
      }
      return out;
    }

    _stoppedAnomaly(snapshot){
      const out=[];
      for(const trip of snapshot.tripStates){
        if(!trip.active||!['live','predicted_live'].includes(trip.motionMode))continue;
        const delay=finite(trip.delay?.value);
        if(delay===null||delay<this.options.stoppedMinDelaySec)continue;
        const rows=this.progressHistory.get(trip.tripInstanceId)||[];
        if(rows.length<2)continue;
        const latest=rows.at(-1),cutoff=latest.at-this.options.stoppedMinSec;
        const window=rows.filter(x=>x.at>=cutoff);
        if(window.length<2||latest.at-window[0].at<this.options.stoppedMinSec)continue;
        const values=window.map(x=>x.progress);
        const moved=Math.max(...values)-Math.min(...values);
        if(moved>this.options.stoppedProgressM)continue;
        const confidence=clamp(window.reduce((n,x)=>n+x.confidence,0)/window.length*.85,0,1);
        out.push({
          type:'vehicle_stopped_anomaly',severity:'minor',confidence,
          scope:{tripInstanceIds:[trip.tripInstanceId],routeIds:[trip.routeId],vehicleIds:[]},
          scopeKey:trip.tripInstanceId,
          evidence:[
            {type:'low_progress_change',durationSec:latest.at-window[0].at,progressRangeM:moved},
            {type:'delay',valueSec:delay,source:trip.delay?.source||null}
          ]
        });
      }
      return out;
    }

    _offShape(snapshot){
      if(!this.expectedPosition)return [];
      const out=[];
      for(const trip of snapshot.tripStates){
        if(!trip.active||trip.position?.source!=='official_realtime_position'||!trip.position?.value)continue;
        const observedAt=finite(trip.position?.observedAt);
        if(observedAt===null||snapshot.generatedAt-observedAt>this.options.maxEvidenceAgeSec)continue;
        const instance=this.servicePlan.get(trip.tripInstanceId);
        const geometry=instance?this.expectedPosition.geometry(instance):null;
        if(!geometry?.shape)continue;
        const projection=G.projectToShape(geometry.shape,trip.position.value);
        if(!projection||projection.distance<this.options.offShapeDistanceM)continue;
        const confidence=clamp((finite(trip.position.confidence)??0)*Math.min(1,projection.distance/this.options.offShapeDistanceM*.7),0,1);
        out.push({
          type:'vehicle_off_shape',severity:projection.distance>=500?'major':'minor',confidence,
          scope:{tripInstanceIds:[trip.tripInstanceId],routeIds:[trip.routeId],vehicleIds:[]},
          scopeKey:trip.tripInstanceId,
          evidence:[{type:'shape_distance',distanceM:projection.distance,thresholdM:this.options.offShapeDistanceM}]
        });
      }
      return out;
    }

    _coverageDrop(snapshot){
      const current=this.coverageHistory.at(-1);
      if(!current||current.expected<this.options.coverageMinExpectedTrips)return [];
      const previous=this.coverageHistory.slice(0,-1).slice(-this.options.coverageBaselineSamples);
      if(previous.length<this.options.coverageBaselineSamples)return [];
      const baseline=previous.reduce((n,x)=>n+x.coverage,0)/previous.length;
      const drop=baseline-current.coverage;
      if(baseline<this.options.coverageBaselineMin||
         current.coverage>this.options.coverageCurrentMax||
         drop<this.options.coverageDropMin)return [];
      return [{
        type:'realtime_coverage_drop',severity:current.coverage<=.15?'critical':'major',
        confidence:clamp(.6+Math.min(.3,drop*.5),0,1),
        scope:{tripInstanceIds:[],routeIds:[],vehicleIds:[]},
        scopeKey:'network',
        evidence:[{
          type:'coverage',baseline, current:current.coverage,drop,
          expectedTrips:current.expected,observedTrips:current.observed
        }]
      }];
    }

    _possibleUndocumented(candidates){
      const out=[];
      for(const candidate of candidates){
        if(candidate.type!=='consecutive_missing_trips')continue;
        if(candidate.officialOverlap?.matched)continue;
        out.push({
          type:'possible_undocumented_disruption',severity:'major',
          confidence:clamp(candidate.confidence*.8,0,.8),
          scope:candidate.scope,
          scopeKey:candidate.scopeKey,
          evidence:[
            {type:'derived_from',eventType:'consecutive_missing_trips'},
            {type:'official_overlap',matched:false}
          ]
        });
      }
      return out;
    }

    _candidate(candidate,snapshot,officialAlerts){
      const base={
        provider:snapshot.provider,network:snapshot.network,
        sourceKind:'derived',userVisible:false,
        type:candidate.type,severity:candidate.severity||'info',
        confidence:clamp(Number(candidate.confidence)||0,0,1),
        scope:Object.freeze({
          tripInstanceIds:Object.freeze([...(candidate.scope?.tripInstanceIds||[])]),
          routeIds:Object.freeze([...(candidate.scope?.routeIds||[])]),
          vehicleIds:Object.freeze([...(candidate.scope?.vehicleIds||[])])
        }),
        evidence:frozenRows(candidate.evidence),
        scopeKey:candidate.scopeKey||'network'
      };
      return {...base,officialOverlap:officialOverlap(base,officialAlerts,this.servicePlan)};
    }

    _materialize(candidates,now){
      const current=new Map(),active=[];
      for(const candidate of candidates){
        const id=eventId(candidate.provider,candidate.network,candidate.type,candidate.scopeKey);
        const previous=this.activeEvents.get(id);
        const event=Object.freeze({
          id,sourceKind:'derived',userVisible:false,
          provider:candidate.provider,network:candidate.network,type:candidate.type,
          lifecycle:'active',severity:candidate.severity,confidence:candidate.confidence,
          firstSeenAt:previous?.firstSeenAt??now,lastSeenAt:now,occurrences:(previous?.occurrences||0)+1,
          scope:candidate.scope,evidence:candidate.evidence,officialOverlap:candidate.officialOverlap
        });
        current.set(id,event);active.push(event);
      }
      const resolved=[];
      for(const [id,previous] of this.activeEvents){
        if(current.has(id))continue;
        resolved.push(Object.freeze({...previous,lifecycle:'resolved',resolvedAt:now}));
      }
      this.activeEvents=current;
      return {active,resolved};
    }

    analyze(snapshot,{officialAlerts}={}){
      if(!snapshot||!Array.isArray(snapshot.tripStates))
        throw new Error('DerivedEventEngine: TransitStateSnapshot non valido');
      if(snapshot.provider!==this.servicePlan.provider||snapshot.network!==this.servicePlan.network)
        throw new Error('DerivedEventEngine: snapshot fuori scope');

      this._record(snapshot);
      let candidates=[
        ...this._tripExpectedUnobserved(snapshot),
        ...this._consecutiveMissing(snapshot),
        ...this._persistentDelay(snapshot),
        ...this._stoppedAnomaly(snapshot),
        ...this._offShape(snapshot),
        ...this._coverageDrop(snapshot)
      ].map(x=>this._candidate(x,snapshot,officialAlerts||[]));

      const secondary=this._possibleUndocumented(candidates)
        .map(x=>this._candidate(x,snapshot,officialAlerts||[]));
      candidates=[...candidates,...secondary];

      const lifecycle=this._materialize(candidates,snapshot.generatedAt);
      return new DerivedEventSnapshot({
        provider:snapshot.provider,network:snapshot.network,generatedAt:snapshot.generatedAt,
        active:lifecycle.active,resolved:lifecycle.resolved,
        inputSummary:{
          tripStates:snapshot.tripStates.length,vehicleStates:snapshot.vehicleStates?.length||0,
          officialAlerts:(officialAlerts||[]).length,historySnapshots:this.snapshots.length
        }
      });
    }

    clear(){
      this.snapshots=[];this.delayHistory.clear();this.progressHistory.clear();
      this.coverageHistory=[];this.activeEvents.clear();
    }
  }

  function createDerivedEventEngine(args){return new DerivedEventEngine(args)}

  global.UVTransitDerivedEvents=Object.freeze({
    DerivedEventEngine,DerivedEventSnapshot,createDerivedEventEngine,
    _test:Object.freeze({eventId,routeKeys,officialOverlap})
  });
})(window);
