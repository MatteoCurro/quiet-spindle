/* U.Venice Transport — TODS-compatible operational model.
   Provider-neutral model for vehicle duties/blocks, non-revenue legs, crew runs
   and vehicle assignments. It never invents TODS certainty from GTFS alone. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const text=v=>String(v??'').trim();
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const DEADHEAD_TYPES=new Set(['deadhead','pull-out','pull-back','pullout','pullback','pull out','pull back']);

  function todsValue(row,camel,snake){
    return row?.[camel]!==undefined?row[camel]:row?.[snake];
  }

  function normalizedTripTypes(tods){
    const out=new Map();
    for(const row of tods?.trips||[]){
      const id=text(todsValue(row,'tripId','trip_id'));
      const type=text(todsValue(row,'tripType','TODS_trip_type'));
      if(id&&type)out.set(id,type);
    }
    for(const [id,type] of Object.entries(tods?.tripTypes||{})){
      if(text(id)&&text(type))out.set(text(id),text(type));
    }
    return out;
  }

  function firstStop(instance){return instance?.stops?.[0]||null}
  function lastStop(instance){return instance?.stops?.at?.(-1)||instance?.stops?.[instance.stops.length-1]||null}

  function isExplicitDeadhead(type){
    return DEADHEAD_TYPES.has(text(type).toLowerCase());
  }

  function dutyId(provider,network,serviceDate,blockId){
    return [text(provider)||'unknown',text(network)||'unknown',text(serviceDate),'vehicle-duty',text(blockId)].join(':');
  }

  function assignmentId(source,date,serviceId,blockId,vehicleId){
    return [source,text(date),text(serviceId)||'any-service',text(blockId),text(vehicleId)].join(':');
  }

  function buildVehicleDuties(servicePlan,tripTypes){
    const duties=[];
    for(const [key,base] of servicePlan.vehicleDuties||[]){
      const trips=base.tripInstanceIds.map(id=>servicePlan.get(id)).filter(Boolean)
        .sort((a,b)=>a.plannedStart-b.plannedStart||a.id.localeCompare(b.id));
      const serviceIds=[...new Set(trips.map(x=>text(x.serviceId)).filter(Boolean))].sort();
      const legs=[];
      for(let i=0;i<trips.length;i++){
        const trip=trips[i],tripType=tripTypes.get(trip.tripId)||null;
        legs.push(freeze({
          id:trip.id,
          kind:tripType?'trip_non_revenue':'trip_revenue',
          tripInstanceId:trip.id,
          tripId:trip.tripId,
          serviceId:trip.serviceId||null,
          blockId:trip.blockId,
          operationalType:tripType||'revenue',
          deadhead:isExplicitDeadhead(tripType),
          plannedStart:trip.plannedStart,
          plannedEnd:trip.plannedEnd,
          startStopId:firstStop(trip)?.id||null,
          endStopId:lastStop(trip)?.id||null,
          provenance:tripType?'tods_trip_type':'gtfs_trip'
        }));

        const next=trips[i+1];
        if(!next)continue;
        const from=lastStop(trip),to=firstStop(next),gap=Math.max(0,next.plannedStart-trip.plannedEnd);
        if(from?.id&&to?.id&&from.id!==to.id){
          legs.push(freeze({
            id:[base.id,'gap',i+1].join(':'),
            kind:'deadhead_candidate',
            tripInstanceId:null,
            tripId:null,
            serviceId:trip.serviceId===next.serviceId?(trip.serviceId||null):null,
            blockId:base.blockId,
            operationalType:'deadhead_candidate',
            deadhead:false,
            plannedStart:trip.plannedEnd,
            plannedEnd:next.plannedStart,
            startStopId:from.id,
            endStopId:to.id,
            gapSec:gap,
            provenance:'gtfs_block_gap'
          }));
        }
      }
      duties.push(freeze({
        id:dutyId(servicePlan.provider,servicePlan.network,base.serviceDate,base.blockId),
        provider:servicePlan.provider,
        network:servicePlan.network,
        serviceDate:base.serviceDate,
        blockId:base.blockId,
        serviceIds:freeze(serviceIds),
        plannedStart:base.plannedStart,
        plannedEnd:base.plannedEnd,
        tripInstanceIds:freeze(trips.map(x=>x.id)),
        legs:freeze(legs),
        provenance:'gtfs_block'
      }));
    }
    return duties.sort((a,b)=>a.plannedStart-b.plannedStart||a.id.localeCompare(b.id));
  }

  function normalizeVehicles(tods){
    return freeze((tods?.vehicles||[]).map(row=>freeze({
      vehicleId:text(todsValue(row,'vehicleId','vehicle_id')),
      label:text(todsValue(row,'vehicleLabel','vehicle_label'))||null,
      licensePlate:text(todsValue(row,'licensePlate','license_plate'))||null,
      provenance:'tods_vehicles'
    })).filter(x=>x.vehicleId));
  }

  function normalizeCrewRuns(tods){
    const grouped=new Map();
    for(const row of tods?.runEvents||tods?.run_events||[]){
      const serviceId=text(todsValue(row,'serviceId','service_id'));
      const runId=text(todsValue(row,'runId','run_id'));
      const sequence=num(todsValue(row,'eventSequence','event_sequence'));
      if(!serviceId||!runId||sequence===null)continue;
      const key=serviceId+'|'+runId;
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(freeze({
        serviceId,runId,eventSequence:sequence,
        pieceId:text(todsValue(row,'pieceId','piece_id'))||null,
        blockId:text(todsValue(row,'blockId','block_id'))||null,
        tripId:text(todsValue(row,'tripId','trip_id'))||null,
        jobType:text(todsValue(row,'jobType','job_type'))||null,
        eventType:text(todsValue(row,'eventType','event_type'))||null,
        startLocation:text(todsValue(row,'startLocation','start_location'))||null,
        startTime:text(todsValue(row,'startTime','start_time'))||null,
        endLocation:text(todsValue(row,'endLocation','end_location'))||null,
        endTime:text(todsValue(row,'endTime','end_time'))||null,
        provenance:'tods_run_events'
      }));
    }
    return freeze([...grouped.entries()].map(([key,events])=>{
      events.sort((a,b)=>a.eventSequence-b.eventSequence);
      const [serviceId,runId]=key.split('|');
      return freeze({
        id:['crew-run',serviceId,runId].join(':'),
        serviceId,runId,
        events:freeze(events),
        blockIds:freeze([...new Set(events.map(x=>x.blockId).filter(Boolean))]),
        tripIds:freeze([...new Set(events.map(x=>x.tripId).filter(Boolean))]),
        provenance:'tods_run_events'
      });
    }).sort((a,b)=>a.id.localeCompare(b.id)));
  }

  function explicitAssignments(tods,duties){
    const out=[];
    for(const row of tods?.vehicleAssignments||tods?.vehicle_assignments||[]){
      const date=text(todsValue(row,'date','date')).replaceAll('-','');
      const serviceId=text(todsValue(row,'serviceId','service_id'));
      const blockId=text(todsValue(row,'blockId','block_id'));
      const vehicleId=text(todsValue(row,'vehicleId','vehicle_id'));
      if(!date||!blockId||!vehicleId)continue;
      const matches=duties.filter(d=>d.serviceDate===date&&d.blockId===blockId&&
        (!serviceId||!d.serviceIds.length||d.serviceIds.includes(serviceId)));
      const ambiguous=!serviceId&&matches.some(d=>d.serviceIds.length>1);
      const resolvedServiceId=serviceId||(
        matches.length===1&&matches[0].serviceIds.length===1?matches[0].serviceIds[0]:''
      );
      out.push(freeze({
        id:assignmentId('tods',date,resolvedServiceId,blockId,vehicleId),
        date,serviceId:resolvedServiceId||null,blockId,vehicleId,
        dutyIds:freeze(matches.map(x=>x.id)),
        source:'tods_vehicle_assignment',
        confidence:ambiguous?0.5:1,
        status:matches.length?(ambiguous?'ambiguous_service':'planned'):'unresolved_block',
        observedAt:null
      }));
    }
    return out;
  }

  function observedAssignments(servicePlan,transitSnapshot,duties){
    if(!transitSnapshot)return [];
    const dutyByKey=new Map(duties.map(d=>[d.serviceDate+'|'+d.blockId,d]));
    const out=new Map();
    for(const vehicle of transitSnapshot.vehicleStates||[]){
      if(vehicle?.status!=='matched'||!vehicle.tripInstanceId||vehicle.anonymous)continue;
      const trip=servicePlan.get(vehicle.tripInstanceId);
      if(!trip?.blockId)continue;
      const duty=dutyByKey.get(trip.serviceDate+'|'+trip.blockId);
      if(!duty)continue;
      const vehicleId=text(vehicle.externalVehicleId||vehicle.vehicleId);
      if(!vehicleId)continue;
      const confidence=Math.max(0,Math.min(1,Number(vehicle.strongestResolution?.confidence)||0));
      const id=assignmentId('observed',trip.serviceDate,trip.serviceId,trip.blockId,vehicleId);
      const previous=out.get(id);
      const observedAt=num(vehicle.lastSeenAt)??num(transitSnapshot.generatedAt);
      if(!previous||observedAt>previous.observedAt){
        out.set(id,freeze({
          id,date:trip.serviceDate,serviceId:trip.serviceId||null,
          blockId:trip.blockId,vehicleId,dutyIds:freeze([duty.id]),
          source:'observed_realtime',confidence,
          status:'observed',observedAt
        }));
      }
    }
    return [...out.values()];
  }

  function conflicts(assignments){
    const grouped=new Map();
    for(const row of assignments){
      const key=[row.date,row.serviceId||'*',row.blockId].join('|');
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    const out=[];
    for(const [key,rows] of grouped){
      const vehicles=[...new Set(rows.map(x=>x.vehicleId))];
      if(vehicles.length>1&&rows.some(x=>x.source==='tods_vehicle_assignment')&&rows.some(x=>x.source==='observed_realtime')){
        out.push(freeze({
          key,vehicleIds:freeze(vehicles),
          assignmentIds:freeze(rows.map(x=>x.id)),
          type:'planned_observed_vehicle_mismatch'
        }));
      }
    }
    return freeze(out);
  }

  class OperationalSnapshot{
    constructor({provider,network,generatedAt,duties,deadheads,crewRuns,vehicles,assignments,assignmentConflicts}){
      this.provider=provider;this.network=network;this.generatedAt=generatedAt;
      this.duties=freeze(duties);this.deadheads=freeze(deadheads);
      this.crewRuns=crewRuns;this.vehicles=vehicles;
      this.assignments=freeze(assignments);this.assignmentConflicts=assignmentConflicts;
      Object.freeze(this);
    }
    duty(id){return this.duties.find(x=>x.id===id)||null}
    summary(){
      const explicit=this.deadheads.filter(x=>x.deadhead).length;
      const candidates=this.deadheads.filter(x=>x.kind==='deadhead_candidate').length;
      return freeze({
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        vehicleDuties:this.duties.length,
        crewRuns:this.crewRuns.length,
        explicitDeadheads:explicit,
        deadheadCandidates:candidates,
        fleetVehicles:this.vehicles.length,
        vehicleAssignments:this.assignments.length,
        plannedAssignments:this.assignments.filter(x=>x.source==='tods_vehicle_assignment').length,
        observedAssignments:this.assignments.filter(x=>x.source==='observed_realtime').length,
        assignmentConflicts:this.assignmentConflicts.length
      });
    }
  }

  class OperationalModel{
    constructor({servicePlan,tods}={}){
      if(!servicePlan||typeof servicePlan.instances!=='function')
        throw new Error('OperationalModel: ServicePlan non valido');
      this.servicePlan=servicePlan;
      this.tods=tods||{};
      this.tripTypes=normalizedTripTypes(this.tods);
      this.duties=buildVehicleDuties(servicePlan,this.tripTypes);
      this.vehicles=normalizeVehicles(this.tods);
      this.crewRuns=normalizeCrewRuns(this.tods);
      Object.freeze(this.duties);Object.freeze(this);
    }
    snapshot({transitSnapshot,now}={}){
      const generatedAt=num(now)??num(transitSnapshot?.generatedAt)??Date.now()/1000;
      const planned=explicitAssignments(this.tods,this.duties);
      const observed=observedAssignments(this.servicePlan,transitSnapshot,this.duties);
      const assignments=[...planned,...observed];
      const deadheads=[];
      for(const duty of this.duties)for(const leg of duty.legs)if(leg.deadhead||leg.kind==='deadhead_candidate')deadheads.push(leg);
      return new OperationalSnapshot({
        provider:this.servicePlan.provider,network:this.servicePlan.network,generatedAt,
        duties:this.duties,deadheads,crewRuns:this.crewRuns,vehicles:this.vehicles,
        assignments,assignmentConflicts:conflicts(assignments)
      });
    }
  }

  function createOperationalModel(args){return new OperationalModel(args)}

  global.UVTransitOperations=freeze({
    OperationalModel,OperationalSnapshot,createOperationalModel,
    _test:freeze({
      normalizedTripTypes,buildVehicleDuties,normalizeCrewRuns,
      explicitAssignments,observedAssignments,conflicts,isExplicitDeadhead
    })
  });
})(window);
