/* Unlock Venice Transit — motion prediction engine
   Mutates only the supplied vehicle state. No DOM or Leaflet calls. */
(function(global){
  'use strict';
  const G=global.UVTransitGTFS;
  if(!G) throw new Error('UVTransitGTFS required before UVTransitPrediction');

  const DEFAULTS=Object.freeze({
    /* Physical speed model. */
    maxSpeed:24,
    maxAccel:1.25,
    maxBrake:2.1,

    /* Feed-age handling. */
    staleDecayAfter:18,
    staleStopAt:40,
    projectionMaxAge:40,

    /* Visual reconciliation. This is NOT vehicle speed. */
    correctionHorizon:1.15,
    maxCorrectionSpeed:80,
    snapCorrectionAt:250,
    leadTolerance:14,
    freshLeadBrakeFraction:.72,

    /*
     * Elastic presentation lag.  The visual marker intentionally trails the
     * estimated physical position by a few seconds.  With periodic GPS fixes
     * this makes a fresh fix appear in front of the marker; the marker then
     * crosses that fix and continues smoothly until the next sample arrives.
     */
    defaultFixInterval:10.5,
    fixIntervalMin:5,
    fixIntervalMax:20,
    elasticLagRatio:.38,
    elasticLagMin:2.2,
    elasticLagMax:4.8,
    elasticMidPhase:.55,

    /* Stop-aware dead reckoning: no network or timetable requests are added. */
    stopApproachTramM:150,
    stopApproachBusM:105,
    stopDecelTram:1.15,
    stopDecelBus:.95,
    stopCrawlZoneM:6,
    stopCrawlSpeed:1.0,
    incomingCapSpeed:4.0
  });

  const WATER_DEFAULTS=Object.freeze({
    maxSpeed:18,
    maxAccel:.65,
    maxBrake:1.0,
    staleDecayAfter:20,
    staleStopAt:55,
    projectionMaxAge:50,
    correctionHorizon:1.4,
    maxCorrectionSpeed:45,
    snapCorrectionAt:180,
    leadTolerance:10,
    freshLeadBrakeFraction:.7,
    defaultFixInterval:6,
    fixIntervalMin:2.5,
    fixIntervalMax:18,
    elasticLagRatio:.3,
    elasticLagMin:1.2,
    elasticLagMax:3.2
  });

  const PROFILES=Object.freeze({
    land:DEFAULTS,
    water:WATER_DEFAULTS
  });

  function optionsWithDefaults(options){
    return {...DEFAULTS,...(options||{})};
  }

  function statusText(v){
    return String(v.currentStatus||'').toUpperCase();
  }

  function isStopped(v){
    return statusText(v).includes('STOPPED');
  }

  function isIncoming(v){
    return statusText(v).includes('INCOMING');
  }

  function stopDistance(v){
    if(!v.nextStop||v.nextStop.lat===null||v.nextStop.lat===undefined||
       v.nextStop.lon===null||v.nextStop.lon===undefined||
       !v.shape||v.stateProgress===null||v.stateProgress===undefined){
      return null;
    }
    const stopPr=G.projectToShape(v.shape,v.nextStop);
    if(!stopPr)return null;
    return stopPr.progress-v.stateProgress;
  }

  function stopApproachSpeedCap(v,options){
    const o=optionsWithDefaults(options);
    if(isStopped(v))return 0;

    const dist=stopDistance(v);
    if(dist===null||dist< -8)return Infinity;

    const tram=String(v.routeType)==='0';
    const start=tram?o.stopApproachTramM:o.stopApproachBusM;
    if(dist>start)return Infinity;

    if(dist<=o.stopCrawlZoneM)return o.stopCrawlSpeed;

    const decel=tram?o.stopDecelTram:o.stopDecelBus;
    let cap=Math.sqrt(Math.max(0,2*decel*(dist-o.stopCrawlZoneM)));
    cap=Math.max(o.stopCrawlSpeed,cap);

    if(isIncoming(v)&&dist<45)cap=Math.min(cap,o.incomingCapSpeed);
    return G.clamp(cap,0,o.maxSpeed);
  }

  function baseTargetSpeed(v,nowEpoch,options){
    const o=optionsWithDefaults(options);
    if(o.enabled===false)return 0;
    let target=G.clamp(v.targetSpeed||0,0,o.maxSpeed);

    /* Existing ETA-based cap, when TripUpdates give us a useful arrival time. */
    if(v.nextStop&&v.nextStop.lat!==null&&v.shape&&v.stateProgress!==null){
      const stopPr=G.projectToShape(v.shape,v.nextStop);
      if(stopPr){
        const dist=stopPr.progress-v.stateProgress;
        const sec=v.nextStop.time?Math.max(0,v.nextStop.time-nowEpoch):null;
        if(dist>=0&&dist<500&&sec!==null){
          if(sec<=2&&dist<35)target=0;
          else if(sec>0){
            const etaSpeed=G.clamp(dist/sec,0,o.maxSpeed);
            target=Math.min(target||etaSpeed,etaSpeed*1.12+.8);
          }
        }
      }
    }

    /* Geometry-based slowdown: especially visible on trams, lighter on buses. */
    const stopCap=stopApproachSpeedCap(v,o);
    if(Number.isFinite(stopCap))target=Math.min(target,stopCap);
    if(isStopped(v))target=0;
    return target;
  }

  function targetSpeed(v,nowEpoch,options){
    const o=optionsWithDefaults(options);
    let target=baseTargetSpeed(v,nowEpoch,o);
    const age=Math.max(0,nowEpoch-(v.lastDataTs||nowEpoch));
    if(age>o.staleDecayAfter){
      const span=Math.max(.001,o.staleStopAt-o.staleDecayAfter);
      const k=1-G.clamp((age-o.staleDecayAfter)/span,0,1);
      target*=k;
    }
    return target;
  }

  function smoothstep01(x){
    const t=G.clamp(x,0,1);
    return t*t*(3-2*t);
  }

  function elasticLagSeconds(v,options,ageSeconds=0){
    const o=optionsWithDefaults(options);
    const interval=G.clamp(
      Number(v.fixIntervalEma)||o.defaultFixInterval,
      o.fixIntervalMin,
      o.fixIntervalMax
    );
    const base=G.clamp(interval*o.elasticLagRatio,o.elasticLagMin,o.elasticLagMax);

    /*
     * Spring profile within one expected GPS cycle:
     *   fresh fix -> larger lag (marker behind)
     *   middle    -> lag collapses (marker catches and crosses the raw fix)
     *   late      -> lag grows again (marker eases off before the next fix)
     *
     * The profile is not repeated if the feed is late: after one expected
     * interval the final lag is held constant and stale handling takes over.
     */
    const startLag=Math.min(o.elasticLagMax,base*1.08);
    const midLag=Math.max(.8,base*.28);
    const endLag=Math.max(1.8,base*.90);
    const phase=G.clamp(Math.max(0,ageSeconds)/interval,0,1);
    const mid=G.clamp(o.elasticMidPhase,.35,.75);

    if(phase<=mid){
      const t=smoothstep01(phase/mid);
      return startLag+(midLag-startLag)*t;
    }
    const t=smoothstep01((phase-mid)/(1-mid));
    return midLag+(endLag-midLag)*t;
  }

  function projectedTravelSeconds(age,o){
    const bounded=G.clamp(age,0,Math.min(o.projectionMaxAge,o.staleStopAt));
    if(bounded<=o.staleDecayAfter)return bounded;

    /* Integrate a linearly decaying velocity from staleDecayAfter to stopAt. */
    const span=Math.max(.001,o.staleStopAt-o.staleDecayAfter);
    const x=G.clamp(bounded-o.staleDecayAfter,0,span);
    return o.staleDecayAfter + x - (x*x)/(2*span);
  }

  /*
   * Pure operational projection used by TransitState 9.0.
   * Unlike projectedAnchor(), this represents estimated physical progress and
   * intentionally applies no presentation lag.
   */
  function predictPhysicalProgress(v,nowEpoch,options){
    const o=optionsWithDefaults(options);
    if(!v.shape)return null;
    const fixProgress=v.fixProgress??v.measuredProgress;
    if(fixProgress===null||fixProgress===undefined||!Number.isFinite(Number(fixProgress)))return null;
    if(o.enabled===false||isStopped(v))return G.clamp(Number(fixProgress),0,v.shape.total);

    const fixTs=Number(v.fixTimestamp??v.lastDataTs??nowEpoch);
    const age=Math.max(0,Number(nowEpoch)-fixTs);
    const travelSeconds=projectedTravelSeconds(age,o);
    const physicalTarget=baseTargetSpeed(v,Number(nowEpoch),o);
    const fallback=G.clamp(Number(v.observedSpeed??v.speed??0)||0,0,o.maxSpeed);
    const speed=physicalTarget>0?physicalTarget:fallback;
    return G.clamp(Number(fixProgress)+speed*travelSeconds,0,v.shape.total);
  }

  /*
   * The anchor represents the presentation target, not the raw GPS position.
   * It intentionally lags the estimated physical position.  At a new fix the
   * marker should normally be behind the raw point; a few seconds later it
   * crosses that point while continuing along the route.  This keeps motion
   * continuous without letting prediction run permanently ahead of the feed.
   */
  function projectedAnchor(v,nowEpoch,options){
    const o=optionsWithDefaults(options);
    if(!v.shape)return null;
    const fixProgress=v.fixProgress??v.measuredProgress;
    if(fixProgress===null||fixProgress===undefined)return null;
    if(o.enabled===false||isStopped(v))return G.clamp(fixProgress,0,v.shape.total);

    const fixTs=v.fixTimestamp||v.lastDataTs||nowEpoch;
    const age=Math.max(0,nowEpoch-fixTs);
    const travelSeconds=projectedTravelSeconds(age,o);
    const lagSeconds=elasticLagSeconds(v,o,age);

    /* Use the stop-aware physical target so the elastic prediction also brakes. */
    const physicalTarget=baseTargetSpeed(v,nowEpoch,o);
    const fallback=G.clamp(v.observedSpeed||v.speed||0,0,o.maxSpeed);
    const speed=physicalTarget>0?physicalTarget:fallback;

    const effectiveSeconds=travelSeconds-lagSeconds;
    return G.clamp(fixProgress+speed*effectiveSeconds,0,v.shape.total);
  }

  /* Accept a progress sample only when its source timestamp advances. */
  function acceptProgressFix(v,progress,timestamp,options){
    const o=optionsWithDefaults(options);
    if(progress===null||progress===undefined||!Number.isFinite(progress)){
      return {accepted:false,reason:'no-progress'};
    }
    const ts=Number(timestamp)||0;
    const prevTs=Number(v.fixTimestamp??v.lastDataTs??0)||0;

    if(prevTs&&ts<prevTs)return {accepted:false,reason:'older'};
    if(prevTs&&ts===prevTs)return {accepted:false,reason:'duplicate'};

    const prevProgress=v.fixProgress??v.measuredProgress;
    if(prevProgress!==null&&prevProgress!==undefined&&prevTs&&ts>prevTs){
      const dt=ts-prevTs;
      const dp=progress-prevProgress;

      if(dt>=2&&dt<=60){
        const clipped=G.clamp(dt,o.fixIntervalMin,o.fixIntervalMax);
        v.fixIntervalEma=v.fixIntervalEma
          ? v.fixIntervalEma*.62+clipped*.38
          : clipped;
      }

      if(dt>.2&&dt<120&&dp>=-3&&dp<o.maxSpeed*dt*2.5){
        const obs=G.clamp(dp/dt,0,o.maxSpeed);
        v.observedSpeed=(v.observedSpeed||0)*.55+obs*.45;
        v.targetSpeed=(v.targetSpeed||0)*.4+v.observedSpeed*.6;
      }
    }

    v.fixProgress=progress;
    v.measuredProgress=progress;
    v.fixTimestamp=ts;
    if(ts)v.lastDataTs=ts;
    return {accepted:true,reason:'new'};
  }

  function placeAtProgress(v,progress){
    if(!v.shape||progress===null||progress===undefined)return false;
    v.stateProgress=G.clamp(progress,0,v.shape.total);
    const pt=G.pointAt(v.shape,v.stateProgress);
    if(!pt)return false;
    v.displayLat=pt.lat;
    v.displayLon=pt.lon;
    v.bearing=G.bearingAt(v.shape,v.stateProgress);
    return true;
  }

  function reanchorVehicle(v,nowEpoch,options){
    const anchor=projectedAnchor(v,nowEpoch,options);
    if(anchor===null)return v;
    placeAtProgress(v,anchor);
    return v;
  }

  function stepVehicle(v,nowEpoch,dt,options){
    const o=optionsWithDefaults(options);
    const elapsed=G.clamp(Number(dt)||0,.001,1);

    if(v.shape&&v.stateProgress!==null){
      const target=targetSpeed(v,nowEpoch,o);
      if(v.speed<target)v.speed=Math.min(target,v.speed+o.maxAccel*elapsed);
      else v.speed=Math.max(target,v.speed-o.maxBrake*elapsed);

      const anchor=projectedAnchor(v,nowEpoch,o);
      let correction=0;
      if(anchor!==null){
        const error=anchor-v.stateProgress;
        if(Math.abs(error)>=o.snapCorrectionAt){
          placeAtProgress(v,anchor);
          return v;
        }
        if(error>0){
          correction=G.clamp(error/o.correctionHorizon,0,o.maxCorrectionSpeed);
        }else if(error<-o.leadTolerance){
          const desiredBrake=Math.abs(error+o.leadTolerance)/o.correctionHorizon;
          const fresh=nowEpoch-(v.lastDataTs||nowEpoch)<=o.staleDecayAfter;
          const maxLeadBrake=fresh
            ? Math.max(0,v.speed*o.freshLeadBrakeFraction)
            : v.speed;
          correction=-Math.min(desiredBrake,maxLeadBrake);
        }
      }

      const visualSpeed=Math.max(0,v.speed+correction);
      placeAtProgress(v,v.stateProgress+visualSpeed*elapsed);
    }else if(v.raw){
      const alpha=1-Math.exp(-elapsed/1.1);
      v.displayLat+=alpha*(v.raw.lat-v.displayLat);
      v.displayLon+=alpha*(v.raw.lon-v.displayLon);
    }
    return v;
  }

  global.UVTransitPrediction=Object.freeze({
    DEFAULTS,PROFILES,targetSpeed,stopApproachSpeedCap,elasticLagSeconds,
    predictPhysicalProgress,projectedAnchor,acceptProgressFix,reanchorVehicle,stepVehicle
  });
})(window);
