/* U.Venice Transport — live / predicted_live / scheduled_simulation.
   Reuses the existing UVTransitPrediction physical projection without importing
   a second motion algorithm. Keeps observed evidence separate from derived motion. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitMotionState');

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function defaults(profile){
    const p=profile||global.UVTransitPrediction?.DEFAULTS||{};
    return {
      liveMaxAgeSec:finite(p.staleDecayAfter)??18,
      predictedMaxAgeSec:finite(p.projectionMaxAge)??40,
      maxSpeedMps:finite(p.maxSpeed)??24,
      minPredictionConfidence:.15
    };
  }

  function metric(value,source,confidence,observedAt,details){
    return Object.freeze({
      value:value===undefined?null:value,
      source:text(source)||'unavailable',
      confidence:clamp(Number(confidence)||0,0,1),
      observedAt:finite(observedAt),
      ...(details&&Object.keys(details).length?{details:Object.freeze({...details})}:{})
    });
  }

  function latestVehiclePosition(observations){
    return [...(observations||[])].filter(x=>x?.kind==='vehicle_position'&&x.position)
      .sort((a,b)=>(finite(b.observedAt)??-Infinity)-(finite(a.observedAt)??-Infinity))[0]||null;
  }

  function latestResolutionConfidence(observation,resolutions){
    const r=(resolutions||[]).find(x=>x?.observationId===observation?.id);
    return r?clamp(Number(r.confidence)||0,0,1):1;
  }

  function predictedProgressFromSpeed(instance,fix,progress,geometry,now,options){
    const P=global.UVTransitPrediction;
    if(!P?.predictPhysicalProgress||!geometry?.shape)return null;
    const stopped=text(fix.details?.currentStatus).toUpperCase().includes('STOPPED');
    const speed=finite(fix.speed);
    if(!stopped&&(speed===null||speed<=0))return null;
    const state={
      shape:geometry.shape,
      fixProgress:progress,
      measuredProgress:progress,
      fixTimestamp:finite(fix.observedAt),
      lastDataTs:finite(fix.observedAt),
      observedSpeed:speed,
      speed,
      targetSpeed:speed,
      routeType:instance.route?.type,
      currentStatus:fix.details?.currentStatus||'',
      nextStop:null
    };
    return P.predictPhysicalProgress(state,now,options);
  }

  function predictedProgressFromDelay(instance,fixProgress,delayEstimate,expectedPosition,now,options){
    if(!expectedPosition)return null;
    const delay=finite(delayEstimate?.delay?.value);
    if(delay===null)return null;
    const target=expectedPosition.progressAtTimestamp(instance,now-delay);
    if(target===null)return null;
    const age=Math.max(0,now-(finite(delayEstimate?.position?.observedAt)??now));
    const maxAdvance=(finite(options.maxSpeedMps)??24)*age;
    return clamp(target,fixProgress,fixProgress+maxAdvance);
  }

  class MotionStateModel{
    constructor({servicePlan,expectedPosition,delayPosition,predictionOptions,options}){
      if(!servicePlan||typeof servicePlan.get!=='function')
        throw new Error('MotionStateModel: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.delayPosition=delayPosition||null;
      this.predictionOptions=predictionOptions||null;
      this.options={...defaults(this.predictionOptions),...(options||{})};
    }

    estimate(instanceOrId,{observations,resolutions,delayEstimate,now}={}){
      const instance=typeof instanceOrId==='string'?this.servicePlan.get(instanceOrId):instanceOrId;
      if(!instance)return null;
      const timestamp=finite(now)??Date.now()/1000;
      const active=timestamp>=instance.plannedStart&&timestamp<=instance.plannedEnd;
      const rows=(observations||[]).filter(Boolean);
      const estimate=delayEstimate||this.delayPosition?.estimate(instance,{observations:rows,resolutions,now:timestamp})||null;
      const fix=latestVehiclePosition(rows);

      if(fix){
        const observedAt=finite(fix.observedAt);
        const ageSec=observedAt===null?Infinity:Math.max(0,timestamp-observedAt);
        const identityConfidence=latestResolutionConfidence(fix,resolutions);
        const liveConfidence=clamp(
          estimate?.position?.confidence??identityConfidence,0,1
        );

        if(ageSec<=this.options.liveMaxAgeSec){
          return Object.freeze({
            tripInstanceId:instance.id,generatedAt:timestamp,mode:'live',
            position:metric(Object.freeze({...fix.position}),'live',liveConfidence,observedAt,{
              observationId:fix.id,ageSec,bearing:finite(fix.bearing),speed:finite(fix.speed)
            }),
            shapeProgress:estimate?.shapeProgress?.source==='position_derived'
              ?metric(estimate.shapeProgress.value,'live',estimate.shapeProgress.confidence,observedAt,{
                observationId:fix.id,projectionDistanceM:estimate.shapeProgress.details?.projectionDistanceM??null
              })
              :metric(null,'live',0,observedAt,{observationId:fix.id,reason:'shape_progress_unavailable'}),
            anchorObservationId:fix.id,predictedFromObservedAt:null,predictionMethod:null
          });
        }

        if(active&&ageSec<=this.options.predictedMaxAgeSec&&
           estimate?.shapeProgress?.source==='position_derived'&&
           finite(estimate.shapeProgress.value)!==null){
          const geometry=this.expectedPosition?.geometry(instance)||null;
          const fixProgress=Number(estimate.shapeProgress.value);
          let predicted=predictedProgressFromSpeed(
            instance,fix,fixProgress,geometry,timestamp,this.predictionOptions
          );
          let method='physical_speed_projection';

          if(predicted===null){
            const shifted=predictedProgressFromDelay(
              instance,fixProgress,estimate,this.expectedPosition,timestamp,this.options
            );
            if(shifted!==null&&shifted>fixProgress+.01){
              predicted=shifted;method='delay_shifted_schedule';
            }
          }

          if(predicted!==null&&geometry?.shape){
            const point=G.pointAt(geometry.shape,predicted);
            if(point){
              const horizon=Math.max(1,this.options.predictedMaxAgeSec-this.options.liveMaxAgeSec);
              const agePenalty=clamp(1-(ageSec-this.options.liveMaxAgeSec)/horizon,0,1);
              const confidence=clamp(
                (estimate.shapeProgress.confidence||0)*(.45+.55*agePenalty),0,1
              );
              if(confidence>=this.options.minPredictionConfidence){
                return Object.freeze({
                  tripInstanceId:instance.id,generatedAt:timestamp,mode:'predicted_live',
                  position:metric(Object.freeze({lat:point.lat,lon:point.lon}),'predicted_live',confidence,observedAt,{
                    observationId:fix.id,ageSec,method
                  }),
                  shapeProgress:metric(predicted,'predicted_live',confidence,observedAt,{
                    observationId:fix.id,ageSec,method,fixProgress
                  }),
                  anchorObservationId:fix.id,predictedFromObservedAt:observedAt,predictionMethod:method
                });
              }
            }
          }
        }
      }

      if(active&&this.expectedPosition){
        const expected=this.expectedPosition.expectedState(instance,timestamp);
        if(expected?.expectedPosition){
          return Object.freeze({
            tripInstanceId:instance.id,generatedAt:timestamp,mode:'scheduled_simulation',
            position:metric(expected.expectedPosition,'scheduled_simulation',expected.confidence,null,{
              generatedAt:timestamp,geometryQuality:expected.geometryQuality
            }),
            shapeProgress:metric(expected.expectedShapeProgress,'scheduled_simulation',expected.confidence,null,{
              generatedAt:timestamp
            }),
            anchorObservationId:null,predictedFromObservedAt:null,predictionMethod:null
          });
        }
      }

      return Object.freeze({
        tripInstanceId:instance.id,generatedAt:timestamp,mode:'unavailable',
        position:metric(null,'unavailable',0,null,{reason:active?'geometry_unavailable':'trip_not_active'}),
        shapeProgress:metric(null,'unavailable',0,null,{reason:active?'geometry_unavailable':'trip_not_active'}),
        anchorObservationId:null,predictedFromObservedAt:null,predictionMethod:null
      });
    }
  }

  function createMotionStateModel(args){return new MotionStateModel(args)}

  global.UVTransitMotionState=Object.freeze({
    MotionStateModel,createMotionStateModel,
    _test:Object.freeze({latestVehiclePosition,predictedProgressFromSpeed,predictedProgressFromDelay})
  });
})(window);
