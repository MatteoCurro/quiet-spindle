/* U.Venice Transport — provider-neutral Transit State Engine.
   Reconciles ServicePlan + ExpectedPosition + Observation + IdentityResolution.
   Snapshot-oriented design follows the merge/current-view pattern used by
   permissively licensed GTFS-RT tooling such as MBTA Concentrate (MIT). */
(function(global){
  'use strict';

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    preStartAwaitSec:300,
    observationGraceSec:180,
    freshObservationSec:120,
    likelyMissingAfterSec:900,
    minFreshMatchedTripsForMissing:1,
    windowBeforeSec:7200,
    windowAfterSec:10800
  });

  const TRIP_STATUSES=Object.freeze([
    'scheduled','awaiting_observation','observed','predicted_live',
    'expected_unobserved','likely_missing','cancelled','completed'
  ]);
  const VEHICLE_STATUSES=Object.freeze([
    'matched','route_only','deadhead_candidate','depot_candidate','service_unknown','unknown'
  ]);

  function officialCancellation(observation){
    const rel=observation?.scheduleRelationship;
    if(rel===3)return true; // GTFS-RT TripDescriptor.CANCELED
    const value=text(rel).toUpperCase();
    return value==='CANCELED'||value==='CANCELLED';
  }

  function immutableRows(rows){
    return Object.freeze((rows||[]).map(x=>Object.freeze({...x})));
  }

  function freshness(observation,now){
    const at=finite(observation?.observedAt);
    if(at===null)return {observedAt:null,ageSec:null};
    return {observedAt:at,ageSec:Math.max(0,now-at)};
  }

  function strongestResolution(rows){
    const rank={
      exact:7,trip_matched:6,vehicle_correlated:5,gps_shape_matched:4,
      gps_stop_matched:3,route_only:2,unknown:1
    };
    return [...(rows||[])].sort((a,b)=>
      (rank[b?.classification]||0)-(rank[a?.classification]||0)||
      (Number(b?.confidence)||0)-(Number(a?.confidence)||0)
    )[0]||null;
  }

  class TransitStateSnapshot{
    constructor({provider,network,generatedAt,tripStates,vehicleStates,vehicleRegistrySnapshot,vehicleContinuitySnapshot,inputSummary}){
      this.provider=provider;
      this.network=network;
      this.generatedAt=generatedAt;
      this.tripStates=Object.freeze(tripStates);
      this.vehicleStates=Object.freeze(vehicleStates);
      this.vehicleRegistrySnapshot=vehicleRegistrySnapshot||null;
      this.vehicleContinuitySnapshot=vehicleContinuitySnapshot||null;
      this.inputSummary=Object.freeze({...inputSummary});
      this.byTripInstanceId=Object.freeze(Object.fromEntries(tripStates.map(x=>[x.tripInstanceId,x])));
      this.byVehicleId=Object.freeze(Object.fromEntries(vehicleStates.map(x=>[x.vehicleId,x])));
      Object.freeze(this);
    }
    trip(id){return this.byTripInstanceId[text(id)]||null}
    vehicle(id){return this.byVehicleId[text(id)]||null}
    tripsByStatus(status){return this.tripStates.filter(x=>x.status===status)}
    vehiclesByStatus(status){return this.vehicleStates.filter(x=>x.status===status)}
    summary(){
      const trips={},vehicles={},motionModes={};
      for(const row of this.tripStates){
        trips[row.status]=(trips[row.status]||0)+1;
        if(row.motionMode)motionModes[row.motionMode]=(motionModes[row.motionMode]||0)+1;
      }
      for(const row of this.vehicleStates)vehicles[row.status]=(vehicles[row.status]||0)+1;
      return {
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        tripStates:this.tripStates.length,vehicleStates:this.vehicleStates.length,
        trips,vehicles,motionModes,input:{...this.inputSummary}
      };
    }
  }

  class TransitStateEngine{
    constructor({servicePlan,expectedPosition,identityResolver,delayPosition,motionState,vehicleRegistry,vehicleContinuity,options}){
      if(!servicePlan||typeof servicePlan.instances!=='function')
        throw new Error('TransitStateEngine: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.expectedPosition=expectedPosition||null;
      this.identityResolver=identityResolver||null;
      this.delayPosition=delayPosition||null;
      this.motionState=motionState||null;
      this.vehicleRegistry=vehicleRegistry||null;
      this.vehicleContinuity=vehicleContinuity||null;
      this.options={...DEFAULTS,...(options||{})};
    }

    _resolve(observations,resolutions){
      if(Array.isArray(resolutions))return resolutions;
      if(!this.identityResolver)throw new Error('TransitStateEngine: resolutions o IdentityResolver richiesti');
      return this.identityResolver.resolveBatch(observations||[]);
    }

    _inputMaps(observations,resolutions){
      const observationById=new Map();
      for(const observation of observations||[])if(observation?.id)observationById.set(observation.id,observation);

      const resolutionsByTrip=new Map(),resolutionsByObservation=new Map();
      for(const resolution of resolutions||[]){
        if(!resolution?.observationId)continue;
        resolutionsByObservation.set(resolution.observationId,resolution);
        if(resolution.matched&&resolution.tripInstanceId){
          if(!resolutionsByTrip.has(resolution.tripInstanceId))resolutionsByTrip.set(resolution.tripInstanceId,[]);
          resolutionsByTrip.get(resolution.tripInstanceId).push(resolution);
        }
      }
      return {observationById,resolutionsByTrip,resolutionsByObservation};
    }

    _tripCandidates(now,resolutionsByTrip){
      const map=new Map();
      for(const instance of this.servicePlan.around(now,this.options.windowBeforeSec,this.options.windowAfterSec))
        map.set(instance.id,instance);
      for(const id of resolutionsByTrip.keys()){
        const instance=this.servicePlan.get(id);if(instance)map.set(id,instance);
      }
      return [...map.values()].sort((a,b)=>a.plannedStart-b.plannedStart||a.id.localeCompare(b.id));
    }

    _tripState(instance,now,maps,networkHealth){
      const resolutions=maps.resolutionsByTrip.get(instance.id)||[];
      const observations=resolutions.map(r=>maps.observationById.get(r.observationId)).filter(Boolean);
      const freshest=[...observations].sort((a,b)=>(finite(b.observedAt)??-Infinity)-(finite(a.observedAt)??-Infinity))[0]||null;
      const f=freshness(freshest,now);
      const fresh=f.ageSec!==null&&f.ageSec<=this.options.freshObservationSec;
      const cancelled=observations.some(officialCancellation);
      const active=now>=instance.plannedStart&&now<=instance.plannedEnd;
      const beforeStart=instance.plannedStart-now;
      const activeForSec=active?Math.max(0,now-instance.plannedStart):0;
      const expected=active&&this.expectedPosition
        ?this.expectedPosition.expectedState(instance,now)
        :null;
      const estimate=this.delayPosition
        ?this.delayPosition.estimate(instance,{observations,resolutions,now})
        :null;
      const motion=this.motionState
        ?this.motionState.estimate(instance,{observations,resolutions,delayEstimate:estimate,now})
        :null;
      const freshTripUpdate=observations.some(observation=>{
        if(observation?.kind!=='trip_update')return false;
        const x=freshness(observation,now);
        return x.ageSec!==null&&x.ageSec<=this.options.freshObservationSec;
      });
      let status='scheduled',confidence=null,evidence=[];

      if(cancelled){
        status='cancelled';confidence=1;
        evidence=[{type:'official_cancellation',source:'observation'}];
      }else if(now>instance.plannedEnd){
        status='completed';
      }else if(beforeStart>this.options.preStartAwaitSec){
        status='scheduled';
      }else if(now<instance.plannedStart){
        status='awaiting_observation';
      }else if(motion?.mode==='live'){
        status='observed';
      }else if(motion?.mode==='predicted_live'&&!freshTripUpdate){
        status='predicted_live';
      }else if(fresh){
        status='observed';
      }else if(activeForSec<this.options.observationGraceSec){
        status='awaiting_observation';
      }else if(
        activeForSec>=this.options.likelyMissingAfterSec&&
        networkHealth.freshMatchedTripCount>=this.options.minFreshMatchedTripsForMissing
      ){
        status='likely_missing';
        confidence=clamp(.55+Math.min(.2,(activeForSec-this.options.likelyMissingAfterSec)/3600*.1),.55,.75);
        evidence=[
          {type:'active_without_fresh_observation',activeForSec},
          {type:'network_has_fresh_matched_observations',count:networkHealth.freshMatchedTripCount}
        ];
      }else{
        status='expected_unobserved';
      }
      return Object.freeze({
        tripInstanceId:instance.id,
        provider:instance.provider,network:instance.network,serviceDate:instance.serviceDate,
        tripId:instance.tripId,routeId:instance.route.id,direction:instance.direction,
        status,active,plannedStart:instance.plannedStart,plannedEnd:instance.plannedEnd,
        expectedState:expected,
        motionMode:motion?.mode||null,
        motion,
        delay:estimate?.delay||null,
        position:estimate?.position||null,
        shapeProgress:estimate?.shapeProgress||null,
        theoreticalTime:estimate?.theoreticalTime||null,
        observationIds:Object.freeze(observations.map(x=>x.id)),
        resolutionClasses:Object.freeze(resolutions.map(x=>x.classification)),
        freshestObservedAt:f.observedAt,observationAgeSec:f.ageSec,
        confidence,
        evidence:immutableRows(evidence)
      });
    }

    _networkHealth(now,maps){
      const freshTrips=new Set();
      for(const [tripId,resolutions] of maps.resolutionsByTrip){
        for(const resolution of resolutions){
          const observation=maps.observationById.get(resolution.observationId);
          const f=freshness(observation,now);
          if(f.ageSec!==null&&f.ageSec<=this.options.freshObservationSec){
            freshTrips.add(tripId);break;
          }
        }
      }
      return {freshMatchedTripCount:freshTrips.size};
    }

    _vehicleStates(observations,resolutionsByObservation,tripStateById,now,persistVehicleRegistry){
      if(this.vehicleRegistry&&typeof this.vehicleRegistry.build==='function'){
        const args={provider:this.servicePlan.provider,network:this.servicePlan.network,observations,resolutions:[...resolutionsByObservation.values()],now};
        const registrySnapshot=persistVehicleRegistry?this.vehicleRegistry.replace(args):this.vehicleRegistry.build(args);
        const states=registrySnapshot.entries.map(entry=>Object.freeze({...entry,motion:entry.tripInstanceId?(tripStateById.get(entry.tripInstanceId)?.motion||null):null}));
        return {states,registrySnapshot};
      }
      const groups=new Map();
      for(const observation of observations||[]){
        if(!observation||observation.kind==='entity_deleted')continue;
        const vehicle=text(observation.externalVehicleId);
        if(!vehicle&&observation.kind!=='vehicle_position')continue;
        const key=vehicle||('anonymous:'+observation.id);
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(observation);
      }

      const out=[];
      for(const [key,rows] of groups){
        rows.sort((a,b)=>(finite(a.observedAt)??0)-(finite(b.observedAt)??0));
        const resolutions=rows.map(x=>resolutionsByObservation.get(x.id)).filter(Boolean);
        const strongest=strongestResolution(resolutions);
        let status='unknown',tripInstanceId=null,routeId=null;
        if(strongest?.matched){
          status='matched';tripInstanceId=strongest.tripInstanceId;routeId=strongest.routeId||null;
        }else if(strongest?.classification==='route_only'){
          status='route_only';routeId=strongest.routeId||null;
        }else if(rows.some(x=>x.externalTripId||x.externalRouteId)){
          status='service_unknown';
        }
        const latest=rows.at(-1),positionRows=rows.filter(x=>x.position),latestPosition=positionRows.at(-1)||null;
        const f=freshness(latest,now);
        out.push(Object.freeze({
          vehicleId:key,externalVehicleId:text(latest.externalVehicleId)||null,
          anonymous:!text(latest.externalVehicleId),
          provider:latest.provider,network:latest.network,status,tripInstanceId,routeId,
          observationIds:Object.freeze(rows.map(x=>x.id)),
          latestObservedAt:f.observedAt,observationAgeSec:f.ageSec,
          position:latestPosition?.position||null,
          bearing:latestPosition?.bearing??null,speed:latestPosition?.speed??null,
          strongestResolution:strongest?Object.freeze({
            classification:strongest.classification,
            confidence:strongest.confidence,
            tripInstanceId:strongest.tripInstanceId||null
          }):null,
          motion:tripInstanceId?(tripStateById.get(tripInstanceId)?.motion||null):null
        }));
      }
      return {states:out.sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId)),registrySnapshot:null};
    }

    snapshot({observations,resolutions,now,persistVehicleRegistry=false}={}){
      const timestamp=finite(now)??Date.now()/1000;
      const obs=(observations||[]).filter(x=>
        (!x?.provider||x.provider===this.servicePlan.provider)&&
        (!x?.network||x.network===this.servicePlan.network)
      );
      const resolved=this._resolve(obs,resolutions);
      const maps=this._inputMaps(obs,resolved);
      const networkHealth=this._networkHealth(timestamp,maps);
      const tripStates=this._tripCandidates(timestamp,maps.resolutionsByTrip).map(instance=>
        this._tripState(instance,timestamp,maps,networkHealth)
      );
      const tripStateById=new Map(tripStates.map(row=>[row.tripInstanceId,row]));
      const vehicleResult=this._vehicleStates(obs,maps.resolutionsByObservation,tripStateById,timestamp,persistVehicleRegistry);
      const vehicleStates=vehicleResult.states;
      const vehicleContinuitySnapshot=persistVehicleRegistry&&this.vehicleContinuity&&vehicleResult.registrySnapshot
        ?this.vehicleContinuity.ingest(vehicleResult.registrySnapshot,{now:timestamp})
        :null;
      return new TransitStateSnapshot({
        provider:this.servicePlan.provider,network:this.servicePlan.network,generatedAt:timestamp,
        tripStates,vehicleStates,vehicleRegistrySnapshot:vehicleResult.registrySnapshot,vehicleContinuitySnapshot,
        inputSummary:{
          observations:obs.length,resolutions:resolved.length,
          matchedResolutions:resolved.filter(x=>x?.matched).length,
          freshMatchedTrips:networkHealth.freshMatchedTripCount,
          registryVehicles:vehicleResult.registrySnapshot?.entries.length??vehicleStates.length,
          continuityVehicles:vehicleContinuitySnapshot?.entries.length??0
        }
      });
    }
  }

  function createTransitStateEngine(args){return new TransitStateEngine(args)}

  global.UVTransitState=Object.freeze({
    TRIP_STATUSES,VEHICLE_STATUSES,TransitStateSnapshot,TransitStateEngine,createTransitStateEngine,
    _test:Object.freeze({officialCancellation,strongestResolution,freshness})
  });
})(window);
