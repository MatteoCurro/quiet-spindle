/* U.Venice Transport — provider-neutral Driver State Adapter.
   Converts explicit driver hints + device GPS into canonical Observation input,
   then consumes IdentityResolver / TransitStateEngine / ExpectedPosition.
   No parallel timetable, delay or map-matching engine lives here. */
(function(global){
  'use strict';

  const G=global.UVTransitGTFS;
  if(!G)throw new Error('UVTransitGTFS required before UVTransitDriverState');

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    candidateBeforeSec:5400,
    candidateAfterSec:5400,
    stopAdvanceToleranceM:35,
    offRouteWarnM:105,
    maxProgressDistanceM:250
  });

  function timestampSec(value,now){
    const n=finite(value);
    if(n===null)return finite(now)??Date.now()/1000;
    return n>1e11?n/1000:n;
  }

  function routeKeys(route){
    if(!route)return [];
    const rows=[];
    for(const value of [
      route.id,route.short,route.long,
      route.short&&route.desc?route.short+'_'+route.desc:''
    ]){
      const key=text(value).toUpperCase();
      if(key&&!rows.includes(key))rows.push(key);
    }
    return rows;
  }

  function routeCompatible(instance,hint){
    const key=text(hint).toUpperCase();
    return !key||routeKeys(instance?.route).includes(key);
  }

  function observationId(network,observedAt){
    return ['driver-gps',text(network)||'unknown',Math.round(Number(observedAt)*1000)].join(':');
  }

  function driverObservation({servicePlan,gps,routeHint,selectedTrip,now}){
    if(!gps||finite(gps.lat)===null||finite(gps.lon)===null)return null;
    const observedAt=timestampSec(gps.timestamp,now);
    return Object.freeze({
      id:observationId(servicePlan.network,observedAt),
      provider:servicePlan.provider,
      network:servicePlan.network,
      kind:'vehicle_position',
      observedAt,
      receivedAt:finite(now)??Date.now()/1000,
      externalVehicleId:null,
      externalTripId:selectedTrip?.tripId||null,
      externalRouteId:text(routeHint)||selectedTrip?.route?.short||selectedTrip?.route?.id||null,
      serviceDate:selectedTrip?.serviceDate||null,
      startTime:null,
      directionId:selectedTrip?.direction??null,
      scheduleRelationship:null,
      position:Object.freeze({lat:Number(gps.lat),lon:Number(gps.lon)}),
      bearing:finite(gps.bearing),
      speed:finite(gps.speed),
      stopId:null,
      stopSequence:null,
      delay:null,
      details:Object.freeze({
        sourceKind:'driver_device',
        accuracy:finite(gps.accuracy)
      }),
      provenance:Object.freeze({
        format:'driver-gps',
        feedKind:'driver_position',
        upstreamEntityId:null,
        feedTimestamp:null,
        feedVersion:null,
        incrementality:null,
        isDeleted:false
      })
    });
  }

  function nextStopIndex(instance,geometry,progress,previousIndex,options){
    const rows=geometry?.shapeProgressByStop||[];
    if(!instance?.stops?.length)return -1;
    let index=Number.isInteger(previousIndex)
      ?clamp(previousIndex,0,instance.stops.length-1)
      :0;
    if(finite(progress)===null)return index;
    const p=Number(progress),tol=options.stopAdvanceToleranceM;
    while(index<instance.stops.length-1){
      const stopProgress=finite(rows[index]);
      if(stopProgress===null||p<=stopProgress+tol)break;
      index++;
    }
    return index;
  }

  function stopView(instance,index){
    if(!instance||index<0||index>=instance.stops.length)return null;
    const row=instance.stops[index],stop=row.stop||{};
    return Object.freeze({
      index,
      id:row.id,
      sequence:row.sequence,
      code:text(stop.code)||null,
      name:text(stop.name)||row.id,
      lat:finite(stop.lat),
      lon:finite(stop.lon),
      plannedArrival:row.plannedArrival,
      plannedDeparture:row.plannedDeparture
    });
  }

  function tripView(instance){
    if(!instance)return null;
    return Object.freeze({
      tripInstanceId:instance.id,
      tripId:instance.tripId,
      serviceDate:instance.serviceDate,
      route:instance.route.short||instance.route.id,
      routeId:instance.route.id,
      routeMeta:instance.route,
      direction:instance.direction,
      headsign:instance.headsign,
      shapeId:instance.shape,
      scheduledStart:instance.plannedStart,
      scheduledEnd:instance.plannedEnd,
      stops:Object.freeze(instance.stops.map((_,i)=>stopView(instance,i)))
    });
  }

  class DriverStateAdapter{
    constructor({servicePlan,expectedPosition,identityResolver,transitStateEngine,options}){
      if(!servicePlan||typeof servicePlan.around!=='function')
        throw new Error('DriverStateAdapter: ServicePlan non valido');
      if(!identityResolver||typeof identityResolver.resolve!=='function')
        throw new Error('DriverStateAdapter: IdentityResolver non valido');
      if(!transitStateEngine||typeof transitStateEngine.snapshot!=='function')
        throw new Error('DriverStateAdapter: TransitStateEngine non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.identityResolver=identityResolver;
      this.transitStateEngine=transitStateEngine;
      this.options={...DEFAULTS,...(options||{})};
    }

    routeCandidates(routeHint,now){
      const ts=finite(now)??Date.now()/1000;
      return this.servicePlan
        .around(ts,this.options.candidateBeforeSec,this.options.candidateAfterSec)
        .filter(instance=>routeCompatible(instance,routeHint))
        .sort((a,b)=>{
          const da=ts<a.plannedStart?a.plannedStart-ts:ts>a.plannedEnd?ts-a.plannedEnd:0;
          const db=ts<b.plannedStart?b.plannedStart-ts:ts>b.plannedEnd?ts-b.plannedEnd:0;
          return da-db||a.plannedStart-b.plannedStart||a.id.localeCompare(b.id);
        });
    }

    resolve({gps,routeHint,candidateTripInstanceIds,selectedTripInstanceId,previousNextStopIndex,now}={}){
      const ts=finite(now)??Date.now()/1000;
      const selected=selectedTripInstanceId?this.servicePlan.get(selectedTripInstanceId):null;
      let observation=driverObservation({
        servicePlan:this.servicePlan,gps,routeHint,selectedTrip:selected,now:ts
      });

      if(!observation){
        return Object.freeze({
          matched:false,reason:'gps_unavailable',generatedAt:ts,
          resolution:null,trip:null,tripState:null,motion:null,delay:null,
          shapeProgress:null,routeDistanceM:null,offRouteCandidate:false,
          nextStop:null,followingStop:null,geometry:null
        });
      }

      const hints={candidateTripInstanceIds:[...(candidateTripInstanceIds||[])]};
      let resolution=this.identityResolver.resolve(observation,hints);

      /* A single explicit consumer candidate is a domain restriction, not a
         competing algorithm. Lock it by canonical trip id only if the normal
         resolver could not safely decide. */
      if(!resolution?.matched&&!selected&&hints.candidateTripInstanceIds.length===1){
        const only=this.servicePlan.get(hints.candidateTripInstanceIds[0]);
        if(only){
          observation=driverObservation({
            servicePlan:this.servicePlan,gps,routeHint,selectedTrip:only,now:ts
          });
          resolution=this.identityResolver.resolve(observation);
        }
      }

      if(!resolution?.matched||!resolution.tripInstanceId){
        return Object.freeze({
          matched:false,reason:resolution?.classification||'unknown',generatedAt:ts,
          observation,resolution,trip:null,tripState:null,motion:null,delay:null,
          shapeProgress:null,routeDistanceM:null,offRouteCandidate:false,
          nextStop:null,followingStop:null,geometry:null
        });
      }

      const instance=this.servicePlan.get(resolution.tripInstanceId);
      if(!instance)return Object.freeze({
        matched:false,reason:'trip_instance_missing',generatedAt:ts,
        observation,resolution,trip:null,tripState:null,motion:null,delay:null,
        shapeProgress:null,routeDistanceM:null,offRouteCandidate:false,
        nextStop:null,followingStop:null,geometry:null
      });

      const snapshot=this.transitStateEngine.snapshot({
        observations:[observation],resolutions:[resolution],now:ts
      });
      const tripState=snapshot.trip(instance.id);
      const geometry=this.expectedPosition?.geometry(instance)||null;
      const projected=geometry?.shape
        ?G.projectToShape(geometry.shape,observation.position)
        :null;
      const routeDistanceM=finite(projected?.distance);
      const routeProgressReliable=routeDistanceM!==null&&routeDistanceM<=this.options.maxProgressDistanceM;
      const liveMotionProgress=['live','predicted_live'].includes(tripState?.motionMode)
        ?finite(tripState?.motion?.shapeProgress?.value)
        :null;
      const positionDerivedProgress=tripState?.shapeProgress?.source==='position_derived'
        ?finite(tripState.shapeProgress.value)
        :null;
      const canonicalProgress=routeProgressReliable
        ?(liveMotionProgress??positionDerivedProgress??finite(projected?.progress))
        :null;
      const nextIndex=canonicalProgress===null&&Number.isInteger(previousNextStopIndex)
        ?clamp(previousNextStopIndex,0,instance.stops.length-1)
        :nextStopIndex(instance,geometry,canonicalProgress,previousNextStopIndex,this.options);
      const next=stopView(instance,nextIndex);
      const following=stopView(instance,nextIndex+1);
      const distanceToNextStopM=next&&next.lat!==null&&next.lon!==null
        ?G.distanceM(observation.position,{lat:next.lat,lon:next.lon})
        :null;

      return Object.freeze({
        matched:true,reason:null,generatedAt:ts,
        observation,resolution,
        trip:tripView(instance),
        tripState,
        motion:tripState?.motion||null,
        delay:tripState?.delay||null,
        shapeProgress:canonicalProgress,
        progressReliable:routeProgressReliable,
        routeDistanceM,
        distanceToNextStopM:finite(distanceToNextStopM),
        offRouteCandidate:routeDistanceM!==null&&routeDistanceM>=this.options.offRouteWarnM,
        nextStop:next,
        followingStop:following,
        geometry
      });
    }
  }

  function createDriverStateAdapter(args){return new DriverStateAdapter(args)}

  global.UVTransitDriverState=Object.freeze({
    DriverStateAdapter,createDriverStateAdapter,
    _test:Object.freeze({
      timestampSec,routeKeys,routeCompatible,driverObservation,nextStopIndex,stopView,tripView
    })
  });
})(window);
