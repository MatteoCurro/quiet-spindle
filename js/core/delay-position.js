/* U.Venice Transport — delay and position estimation.
   Evidence hierarchy: official realtime timing -> GPS position-derived delay ->
   schedule-only fallback. Prediction from the last live fix belongs to 8.9.
   Latest-position selection and separated stop-time evidence adapt patterns
   reviewed in MBTA Concentrate (MIT), without importing its runtime. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitDelayPosition');

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    maxProjectionDistanceM:250,
    highProjectionDistanceM:60,
    freshSec:120,
    agingSec:600,
    staleSec:1800
  });

  function metric(value,source,confidence,observedAt,details){
    return Object.freeze({
      value:value===undefined?null:value,
      source:text(source)||'unavailable',
      confidence:clamp(Number(confidence)||0,0,1),
      observedAt:finite(observedAt),
      ...(details&&Object.keys(details).length?{details:Object.freeze({...details})}:{})
    });
  }

  function ageFactor(observedAt,now,options){
    const at=finite(observedAt),ts=finite(now);
    if(at===null||ts===null)return 1;
    const age=Math.max(0,ts-at),o={...DEFAULTS,...(options||{})};
    if(age<=o.freshSec)return 1;
    if(age<=o.agingSec){
      const t=(age-o.freshSec)/Math.max(1,o.agingSec-o.freshSec);
      return 1-t*.4;
    }
    if(age<=o.staleSec){
      const t=(age-o.agingSec)/Math.max(1,o.staleSec-o.agingSec);
      return .6-t*.25;
    }
    return .15;
  }

  function stopIndex(instance,update){
    const seq=finite(update?.stopSequence);
    if(seq!==null){
      const i=instance.stops.findIndex(s=>Number(s.sequence)===Number(seq));
      if(i>=0)return i;
    }
    const id=text(update?.stopId);
    return id?instance.stops.findIndex(s=>s.id===id):-1;
  }

  function eventCandidates(instance,observation){
    const rows=[];
    for(const update of observation?.stopTimeUpdates||[]){
      const i=stopIndex(instance,update);if(i<0)continue;
      const planned=instance.stops[i];
      for(const [eventName,event,plannedTime] of [
        ['arrival',update?.arrival,planned.plannedArrival],
        ['departure',update?.departure,planned.plannedDeparture]
      ]){
        if(!event)continue;
        const delay=finite(event.delay);
        const actual=finite(event.time);
        const scheduled=finite(event.scheduledTime);
        if(delay!==null){
          rows.push({
            delaySec:delay,eventTime:actual,scheduledTime:scheduled??plannedTime,
            stopId:planned.id,stopSequence:planned.sequence,event:eventName,
            quality:1,kind:'event_delay'
          });
        }else if(actual!==null&&Number.isFinite(plannedTime)){
          rows.push({
            delaySec:actual-plannedTime,eventTime:actual,scheduledTime:plannedTime,
            stopId:planned.id,stopSequence:planned.sequence,event:eventName,
            quality:.96,kind:'event_time'
          });
        }
      }
    }
    return rows;
  }

  function officialDelay(instance,observations,now,options){
    const tripUpdates=(observations||[]).filter(x=>x?.kind==='trip_update')
      .sort((a,b)=>(finite(b.observedAt)??-Infinity)-(finite(a.observedAt)??-Infinity));
    const candidates=[];
    for(const observation of tripUpdates){
      const top=finite(observation.delay);
      if(top!==null){
        candidates.push({
          observation,delaySec:top,quality:1,kind:'trip_delay',
          eventTime:null,scheduledTime:null,stopId:null,stopSequence:null,event:null
        });
      }
      for(const row of eventCandidates(instance,observation))
        candidates.push({...row,observation});
    }
    if(!candidates.length)return null;

    const expectedNow=finite(now);
    candidates.sort((a,b)=>{
      const ao=finite(a.observation.observedAt)??-Infinity,bo=finite(b.observation.observedAt)??-Infinity;
      if(bo!==ao)return bo-ao;
      if(b.quality!==a.quality)return b.quality-a.quality;
      if(expectedNow!==null&&a.eventTime!==null&&b.eventTime!==null)
        return Math.abs(a.eventTime-expectedNow)-Math.abs(b.eventTime-expectedNow);
      return 0;
    });
    const best=candidates[0],observedAt=finite(best.observation.observedAt);
    const confidence=best.quality*ageFactor(observedAt,now,options);
    return metric(best.delaySec,'official_realtime',confidence,observedAt,{
      method:best.kind,event:best.event,stopId:best.stopId,stopSequence:best.stopSequence,
      eventTime:best.eventTime,scheduledTime:best.scheduledTime,
      observationId:best.observation.id
    });
  }

  function observedPositionSource(observation){
    const format=text(observation?.provenance?.format).toLowerCase();
    const sourceKind=text(observation?.details?.sourceKind).toLowerCase();
    return format==='driver-gps'||sourceKind==='driver_device'
      ?'driver_gps_position'
      :'official_realtime_position';
  }

  function latestVehiclePosition(observations){
    return [...(observations||[])].filter(x=>x?.kind==='vehicle_position'&&x.position)
      .sort((a,b)=>(finite(b.observedAt)??-Infinity)-(finite(a.observedAt)??-Infinity))[0]||null;
  }

  function resolutionConfidence(observation,resolutions){
    const row=(resolutions||[]).find(x=>x?.observationId===observation?.id);
    return row?clamp(Number(row.confidence)||0,0,1):1;
  }

  function projectionEvidence(instance,observation,expectedPosition,resolutions,now,options){
    if(!observation?.position||!expectedPosition)return null;
    const geometry=expectedPosition.geometry(instance);
    if(!geometry?.shape||geometry.status==='unavailable')return null;
    const projection=G.projectToShape(geometry.shape,observation.position);
    const o={...DEFAULTS,...(options||{})};
    if(!projection||projection.distance>o.maxProjectionDistanceM)return null;

    const observedAt=finite(observation.observedAt);
    if(observedAt===null)return null;
    const theoretical=expectedPosition.timeAtProgress(instance,projection.progress,observedAt);
    if(theoretical===null)return null;

    const distanceFactor=projection.distance<=o.highProjectionDistanceM
      ?1
      :clamp(1-(projection.distance-o.highProjectionDistanceM)/
        Math.max(1,o.maxProjectionDistanceM-o.highProjectionDistanceM)*.55,.45,1);
    const identity=resolutionConfidence(observation,resolutions);
    const geometryConfidence=clamp(Number(geometry.confidence)||0,0,1);
    const confidence=identity*geometryConfidence*distanceFactor*ageFactor(observedAt,now,o);

    return Object.freeze({
      observationId:observation.id,
      observedAt,
      position:Object.freeze({...observation.position}),
      shapeProgress:projection.progress,
      projectedPosition:Object.freeze({...projection.point}),
      projectionDistanceM:projection.distance,
      theoreticalTimestamp:theoretical,
      delaySec:observedAt-theoretical,
      confidence:clamp(confidence,0,1),
      geometryQuality:geometry.quality
    });
  }

  class DelayPositionModel{
    constructor({servicePlan,expectedPosition,options}){
      if(!servicePlan||typeof servicePlan.get!=='function')
        throw new Error('DelayPositionModel: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.options={...DEFAULTS,...(options||{})};
    }

    estimate(instanceOrId,{observations,resolutions,now}={}){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      const timestamp=finite(now)??Date.now()/1000;
      const active=timestamp>=instance.plannedStart&&timestamp<=instance.plannedEnd;
      const rows=(observations||[]).filter(Boolean);
      const vp=latestVehiclePosition(rows);
      const projection=vp?projectionEvidence(
        instance,vp,this.expectedPosition,resolutions,timestamp,this.options
      ):null;
      const official=officialDelay(instance,rows,timestamp,this.options);

      let delay;
      if(official)delay=official;
      else if(projection){
        delay=metric(projection.delaySec,'position_derived',projection.confidence,projection.observedAt,{
          observationId:projection.observationId,
          shapeProgress:projection.shapeProgress,
          theoreticalTimestamp:projection.theoreticalTimestamp,
          projectionDistanceM:projection.projectionDistanceM,
          geometryQuality:projection.geometryQuality
        });
      }else{
        delay=metric(null,'schedule_only',0,null,{reason:'no_realtime_delay_evidence'});
      }

      let position,shapeProgress,theoreticalTime;
      if(vp){
        const confidence=resolutionConfidence(vp,resolutions)*ageFactor(vp.observedAt,timestamp,this.options);
        position=metric(Object.freeze({...vp.position}),observedPositionSource(vp),confidence,vp.observedAt,{
          observationId:vp.id,
          bearing:finite(vp.bearing),speed:finite(vp.speed)
        });
      }else{
        const expected=active?this.expectedPosition?.expectedState(instance,timestamp)||null:null;
        if(expected?.expectedPosition){
          position=metric(expected.expectedPosition,'schedule_shape',expected.confidence,null,{
            generatedAt:timestamp,geometryQuality:expected.geometryQuality
          });
        }else{
          position=metric(null,'schedule_only',0,null,{reason:active?'position_unavailable':'trip_not_active'});
        }
      }

      if(projection){
        shapeProgress=metric(projection.shapeProgress,'position_derived',projection.confidence,projection.observedAt,{
          observationId:projection.observationId,projectionDistanceM:projection.projectionDistanceM
        });
        theoreticalTime=metric(projection.theoreticalTimestamp,'position_derived',projection.confidence,projection.observedAt,{
          observationId:projection.observationId
        });
      }else{
        const expected=active?this.expectedPosition?.expectedState(instance,timestamp)||null:null;
        shapeProgress=metric(
          expected?.expectedShapeProgress??null,
          expected?.expectedShapeProgress===null||expected?.expectedShapeProgress===undefined?'schedule_only':'schedule_shape',
          expected?.confidence||0,null,{generatedAt:timestamp}
        );
        theoreticalTime=metric(
          expected?.expectedTimestampAtPosition??null,
          expected?.expectedTimestampAtPosition===null||expected?.expectedTimestampAtPosition===undefined?'schedule_only':'schedule_shape',
          expected?.confidence||0,null,{generatedAt:timestamp}
        );
      }

      return Object.freeze({
        tripInstanceId:instance.id,
        generatedAt:timestamp,
        delay,position,shapeProgress,theoreticalTime,
        liveObservationId:vp?.id||null,
        hasOfficialTiming:!!official,
        hasProjectedLivePosition:!!projection
      });
    }
  }

  function createDelayPositionModel(args){return new DelayPositionModel(args)}

  global.UVTransitDelayPosition=Object.freeze({
    DelayPositionModel,createDelayPositionModel,
    _test:Object.freeze({metric,ageFactor,eventCandidates,officialDelay,latestVehiclePosition,observedPositionSource,projectionEvidence})
  });
})(window);
