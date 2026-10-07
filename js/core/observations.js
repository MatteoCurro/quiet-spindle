/* U.Venice Transport — provider-neutral Observation Model.
   Canonicalizes realtime/AVL inputs without resolving them to TripInstances.
   ObservationStore is a current-feed store, not a history/continuity layer. */
(function(global){
  'use strict';

  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const cleanObject=value=>{
    const out={};
    for(const [k,v] of Object.entries(value||{}))if(v!==null&&v!==undefined&&v!=='')out[k]=v;
    return out;
  };
  const freezeArray=rows=>Object.freeze(rows.map(x=>Object.freeze(x)));

  function observedAt(value,fallback){
    const v=finite(value),f=finite(fallback);
    return v!==null?v:(f!==null?f:null);
  }

  function vehicleId(desc){
    return text(desc?.id)||text(desc?.label)||null;
  }

  function positionOf(pos){
    const lat=finite(pos?.latitude??pos?.lat),lon=finite(pos?.longitude??pos?.lon??pos?.lng);
    if(lat===null||lon===null||lat < -90||lat > 90||lon < -180||lon > 180)return null;
    return Object.freeze({lat,lon});
  }

  function tripFields(trip){
    return {
      externalTripId:text(trip?.tripId??trip?.trip_id)||null,
      externalRouteId:text(trip?.routeId??trip?.route_id)||null,
      serviceDate:text(trip?.startDate??trip?.start_date)||null,
      startTime:text(trip?.startTime??trip?.start_time)||null,
      directionId:finite(trip?.directionId??trip?.direction_id),
      scheduleRelationship:trip?.scheduleRelationship??trip?.schedule_relationship??null
    };
  }

  function stopEvent(event){
    if(!event)return null;
    const out=cleanObject({
      delay:finite(event.delay),
      time:finite(event.time),
      uncertainty:finite(event.uncertainty),
      scheduledTime:finite(event.scheduledTime??event.scheduled_time)
    });
    return Object.keys(out).length?Object.freeze(out):null;
  }

  function stopTimeUpdates(rows){
    return freezeArray((rows||[]).map(row=>cleanObject({
      stopId:text(row?.stopId??row?.stop_id)||null,
      stopSequence:finite(row?.stopSequence??row?.stop_sequence),
      scheduleRelationship:row?.scheduleRelationship??row?.schedule_relationship??null,
      assignedStopId:text(row?.stopTimeProperties?.assignedStopId??row?.stop_time_properties?.assigned_stop_id)||null,
      arrival:stopEvent(row?.arrival),
      departure:stopEvent(row?.departure)
    })));
  }

  function provenance({format,feedKind,entityId,feedTimestamp,feedVersion,incrementality,isDeleted}){
    return Object.freeze(cleanObject({
      format:format||'unknown',
      feedKind,
      entityId:text(entityId)||null,
      feedTimestamp:finite(feedTimestamp),
      feedVersion:text(feedVersion)||null,
      incrementality:incrementality??null,
      isDeleted:isDeleted===true?true:null
    }));
  }

  function observationId({provider,network,kind,entityId,externalVehicleId,externalTripId,observedAt,index}){
    const anchor=text(entityId)||text(externalVehicleId)||text(externalTripId)||String(index??0);
    return [text(provider)||'unknown',text(network)||'unknown',kind,anchor,observedAt??'na'].join(':');
  }

  function vehicleObservation({provider,network,entity,header,receivedAt,index}){
    const vp=entity?.vehicle;
    if(!vp)return null;
    const trip=tripFields(vp.trip||{}),ts=observedAt(vp.timestamp,header?.timestamp);
    const pos=positionOf(vp.position);
    const externalVehicleId=vehicleId(vp.vehicle);
    const details=cleanObject({
      currentStatus:vp.currentStatus??vp.current_status??null,
      congestionLevel:vp.congestionLevel??vp.congestion_level??null,
      occupancyStatus:vp.occupancyStatus??vp.occupancy_status??null,
      occupancyPercentage:finite(vp.occupancyPercentage??vp.occupancy_percentage),
      odometer:finite(vp.position?.odometer)
    });
    const base={
      provider:text(provider)||'unknown',network:text(network)||'unknown',kind:'vehicle_position',
      observedAt:ts,receivedAt:finite(receivedAt),
      externalVehicleId,externalTripId:trip.externalTripId,externalRouteId:trip.externalRouteId,
      serviceDate:trip.serviceDate,startTime:trip.startTime,directionId:trip.directionId,
      scheduleRelationship:trip.scheduleRelationship,
      position:pos,bearing:finite(vp.position?.bearing),speed:finite(vp.position?.speed),
      stopId:text(vp.stopId??vp.stop_id)||null,
      stopSequence:finite(vp.currentStopSequence??vp.current_stop_sequence),
      delay:null,
      details:Object.freeze(details),
      provenance:provenance({
        format:'gtfs-rt',feedKind:'vehicle_positions',entityId:entity?.id,
        feedTimestamp:header?.timestamp,feedVersion:header?.gtfsRealtimeVersion,
        incrementality:header?.incrementality,isDeleted:entity?.isDeleted
      })
    };
    return Object.freeze({
      id:observationId({...base,entityId:entity?.id,index}),
      ...base
    });
  }

  function tripUpdateObservation({provider,network,entity,header,receivedAt,index}){
    const tu=entity?.tripUpdate??entity?.trip_update;
    if(!tu)return null;
    const trip=tripFields(tu.trip||{}),ts=observedAt(tu.timestamp,header?.timestamp);
    const updates=stopTimeUpdates(tu.stopTimeUpdate??tu.stop_time_update);
    const firstStop=updates.find(x=>x.stopId||x.stopSequence!==undefined)||null;
    const externalVehicleId=vehicleId(tu.vehicle);
    const base={
      provider:text(provider)||'unknown',network:text(network)||'unknown',kind:'trip_update',
      observedAt:ts,receivedAt:finite(receivedAt),
      externalVehicleId,externalTripId:trip.externalTripId,externalRouteId:trip.externalRouteId,
      serviceDate:trip.serviceDate,startTime:trip.startTime,directionId:trip.directionId,
      scheduleRelationship:trip.scheduleRelationship,
      position:null,bearing:null,speed:null,
      stopId:firstStop?.stopId||null,stopSequence:firstStop?.stopSequence??null,
      delay:finite(tu.delay),
      stopTimeUpdates:updates,
      details:Object.freeze({}),
      provenance:provenance({
        format:'gtfs-rt',feedKind:'trip_updates',entityId:entity?.id,
        feedTimestamp:header?.timestamp,feedVersion:header?.gtfsRealtimeVersion,
        incrementality:header?.incrementality,isDeleted:entity?.isDeleted
      })
    };
    return Object.freeze({
      id:observationId({...base,entityId:entity?.id,index}),
      ...base
    });
  }

  function deletedObservation({provider,network,entity,header,receivedAt,feedKind,index}){
    if(!entity?.isDeleted||entity?.vehicle||entity?.tripUpdate||entity?.trip_update)return null;
    const ts=observedAt(null,header?.timestamp);
    const base={
      provider:text(provider)||'unknown',network:text(network)||'unknown',kind:'entity_deleted',
      observedAt:ts,receivedAt:finite(receivedAt),
      externalVehicleId:null,externalTripId:null,externalRouteId:null,
      serviceDate:null,startTime:null,directionId:null,scheduleRelationship:null,
      position:null,bearing:null,speed:null,stopId:null,stopSequence:null,delay:null,
      details:Object.freeze({}),
      provenance:provenance({
        format:'gtfs-rt',feedKind,entityId:entity?.id,
        feedTimestamp:header?.timestamp,feedVersion:header?.gtfsRealtimeVersion,
        incrementality:header?.incrementality,isDeleted:true
      })
    };
    return Object.freeze({
      id:observationId({...base,entityId:entity?.id,index}),
      ...base
    });
  }

  function fromGtfsRealtimeFeed({provider,network,feed,feedKind,receivedAt}){
    const header=feed?.header||{},entities=feed?.entity||feed?.entities||[],observations=[];
    const kind=text(feedKind);
    for(let i=0;i<entities.length;i++){
      const entity=entities[i];
      const row=kind==='vehicle_positions'
        ?vehicleObservation({provider,network,entity,header,receivedAt,index:i})
        :kind==='trip_updates'
          ?tripUpdateObservation({provider,network,entity,header,receivedAt,index:i})
          :null;
      if(row)observations.push(row);
      else {
        const deleted=deletedObservation({provider,network,entity,header,receivedAt,feedKind:kind,index:i});
        if(deleted)observations.push(deleted);
      }
    }
    return Object.freeze(observations);
  }

  function fromGtfsRealtimeFeeds({provider,network,vehiclePositions,tripUpdates,receivedAt}){
    const received=finite(receivedAt)??Date.now()/1000;
    const vehicle=fromGtfsRealtimeFeed({
      provider,network,feed:vehiclePositions,feedKind:'vehicle_positions',receivedAt:received
    });
    const trips=fromGtfsRealtimeFeed({
      provider,network,feed:tripUpdates,feedKind:'trip_updates',receivedAt:received
    });
    return Object.freeze({
      provider:text(provider)||'unknown',network:text(network)||'unknown',receivedAt:received,
      vehiclePositions:vehicle,tripUpdates:trips,
      observations:Object.freeze([...vehicle,...trips])
    });
  }

  class ObservationStore{
    constructor(){
      this._byScope=new Map();
      this._byId=new Map();
    }

    replaceScope(scope,observations){
      scope=text(scope);if(!scope)throw new Error('ObservationStore: scope obbligatorio');
      const previous=this._byScope.get(scope)||[];
      for(const id of previous)this._byId.delete(id);
      const ids=[];
      for(const observation of observations||[]){
        if(!observation?.id)continue;
        this._byId.set(observation.id,observation);ids.push(observation.id);
      }
      this._byScope.set(scope,Object.freeze(ids));
      return this.forScope(scope);
    }

    ingestGtfsRealtime(batch){
      if(!batch)throw new Error('ObservationStore: batch obbligatorio');
      const prefix=[batch.provider,batch.network].join(':');
      this.replaceScope(prefix+':vehicle_positions',batch.vehiclePositions||[]);
      this.replaceScope(prefix+':trip_updates',batch.tripUpdates||[]);
      return this.summary();
    }

    all(){return [...this._byId.values()]}
    get(id){return this._byId.get(text(id))||null}
    forScope(scope){return (this._byScope.get(text(scope))||[]).map(id=>this._byId.get(id)).filter(Boolean)}
    query(filters){
      filters=filters||{};
      return this.all().filter(o=>
        (!filters.provider||o.provider===filters.provider)&&
        (!filters.network||o.network===filters.network)&&
        (!filters.kind||o.kind===filters.kind)&&
        (!filters.externalVehicleId||o.externalVehicleId===filters.externalVehicleId)&&
        (!filters.externalTripId||o.externalTripId===filters.externalTripId)
      );
    }
    clear(){this._byScope.clear();this._byId.clear()}
    summary(){
      const rows=this.all(),kinds={};
      let positioned=0,incomplete=0;
      for(const o of rows){
        kinds[o.kind]=(kinds[o.kind]||0)+1;
        if(o.position)positioned++;
        if(!o.externalTripId&&!o.externalRouteId&&!o.externalVehicleId)incomplete++;
      }
      return {observations:rows.length,positioned,incomplete,kinds};
    }
  }

  global.UVTransitObservations=Object.freeze({
    ObservationStore,fromGtfsRealtimeFeed,fromGtfsRealtimeFeeds,
    _test:Object.freeze({positionOf,tripFields,stopTimeUpdates,observationId})
  });
})(window);
