/* U.Venice Transport — provider/source capability model.
   A SourceAdapter binds one concrete provider source/network to the canonical
   engine contract. Consumers can inspect capabilities without provider-specific
   branching and use the same TransitRead facade for every registered source. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const text=v=>String(v??'').trim();

  const DEFINITIONS=freeze({
    static_schedule:freeze({id:'static_schedule',labelKey:'transit.capability.schedule',fallback:'Orari programmati'}),
    realtime_vehicle_positions:freeze({id:'realtime_vehicle_positions',labelKey:'transit.capability.vehicle_positions',fallback:'Posizione mezzi in tempo reale'}),
    realtime_trip_updates:freeze({id:'realtime_trip_updates',labelKey:'transit.capability.trip_updates',fallback:'Aggiornamenti corse in tempo reale'}),
    canonical_state:freeze({id:'canonical_state',labelKey:'transit.capability.canonical_state',fallback:'Stato servizio in tempo reale'}),
    predicted_live:freeze({id:'predicted_live',labelKey:'transit.capability.predicted_live',fallback:'Posizione stimata'}),
    scheduled_simulation:freeze({id:'scheduled_simulation',labelKey:'transit.capability.scheduled_simulation',fallback:'Posizione da orario'}),
    driver_state:freeze({id:'driver_state',labelKey:'transit.capability.driver_state',fallback:'Supporto operativo autista'}),
    derived_events:freeze({id:'derived_events',labelKey:'transit.capability.derived_events',fallback:'Diagnostica eventi derivati'}),
    operational_state:freeze({id:'operational_state',labelKey:'transit.capability.operational_state',fallback:'Dati operativi'}),
    raw_realtime:freeze({id:'raw_realtime',labelKey:'transit.capability.raw_realtime',fallback:'Feed GTFS-Realtime ufficiale'}),
    external_timetable:freeze({id:'external_timetable',labelKey:'transit.capability.external_timetable',fallback:'Orari ufficiali esterni'}),
    airport_connection:freeze({id:'airport_connection',labelKey:'transit.capability.airport_connection',fallback:'Collegamento aeroporto'}),
    ticketing:freeze({id:'ticketing',labelKey:'transit.capability.ticketing',fallback:'Acquisto biglietti'}),
    on_demand:freeze({id:'on_demand',labelKey:'transit.capability.on_demand',fallback:'Servizio su richiesta'}),
    booking:freeze({id:'booking',labelKey:'transit.capability.booking',fallback:'Prenotazione'}),
    fare_info:freeze({id:'fare_info',labelKey:'transit.capability.fare_info',fallback:'Informazioni tariffarie'})
  });

  const METHOD_CAPABILITY=freeze({
    loadRuntimeManifest:'static_schedule',
    loadRuntimeCore:'static_schedule',
    loadRuntimeShapes:'static_schedule',
    loadRuntimeSchedule:'static_schedule',
    loadStaticGtfs:'static_schedule',
    loadVehiclePositions:'realtime_vehicle_positions',
    loadTripUpdates:'realtime_trip_updates',
    loadTransitState:'canonical_state',
    peekTransitState:'canonical_state',
    loadDriverStateAdapter:'driver_state',
    loadDerivedEvents:'derived_events',
    loadOperationalState:'operational_state'
  });

  function normalizeCapabilityIds(values){
    const ids=[];
    for(const value of values||[]){
      const id=text(typeof value==='string'?value:value?.id);
      if(!id||!DEFINITIONS[id]||ids.includes(id))continue;
      ids.push(id);
    }
    return freeze(ids);
  }

  function capabilityMap(values){
    const ids=normalizeCapabilityIds(values),map={};
    for(const id of ids)map[id]=true;
    return freeze(map);
  }

  function labelsFor(values){
    return freeze(normalizeCapabilityIds(values).map(id=>DEFINITIONS[id]));
  }

  function boundArgs(name,network,args){
    switch(name){
      case 'loadRuntimeManifest': return [];
      case 'loadRuntimeCore': return [network,args[1],args[2]];
      case 'loadRuntimeShapes': return [network,args[1],args[2]];
      case 'loadRuntimeSchedule': return [network,args[1]];
      case 'loadStaticGtfs': return [network];
      case 'loadVehiclePositions': return [network];
      case 'loadTripUpdates': return [network];
      case 'loadTransitState': return [network,args[1],args[2],args[3]];
      case 'peekTransitState': return [network,args[1],args[2],args[3],args[4]];
      case 'loadDriverStateAdapter': return [network,args[1],args[2]];
      case 'loadDerivedEvents': return [network,args[1],args[2],args[3],args[4]];
      case 'loadOperationalState': return [network,args[1],args[2],args[3],args[4]];
      case 'loadStatus': return [network];
      case 'connect': return [network,args[1],args[2]];
      default: return [network,...args.slice(1)];
    }
  }

  function createSourceAdapter({
    id,providerId,network,mode,label,kind,capabilities,delegate,metadata
  }={}){
    id=text(id);providerId=text(providerId);network=text(network);mode=text(mode);
    if(!id||!providerId||!network||!delegate)
      throw new Error('SourceAdapter: id/providerId/network/delegate richiesti');

    const ids=normalizeCapabilityIds(capabilities),map=capabilityMap(ids);
    const adapter={
      id,
      providerId,
      network,
      mode:mode||null,
      kind:text(kind)||'source',
      label:text(label)||id,
      capabilities:map,
      capabilityIds:ids,
      capabilityLabels:labelsFor(ids),
      metadata:freeze({...metadata}),
      supports:capability=>map[text(capability)]===true
    };

    for(const [name,capability] of Object.entries(METHOD_CAPABILITY)){
      if(!map[capability]||typeof delegate[name]!=='function')continue;
      adapter[name]=function(...args){
        return delegate[name](...boundArgs(name,network,args));
      };
    }

    if(typeof delegate.loadStatus==='function'){
      adapter.loadStatus=function(){return delegate.loadStatus(network)};
    }
    if(typeof delegate.connect==='function'&&(map.realtime_vehicle_positions||map.realtime_trip_updates)){
      adapter.connect=function(_network,onTick,handlers){
        return delegate.connect(network,onTick,handlers);
      };
    }
    if(typeof delegate.loadPredictionAccuracy==='function'&&map.predicted_live){
      adapter.loadPredictionAccuracy=function(){return delegate.loadPredictionAccuracy(network)};
    }

    return freeze(adapter);
  }

  class SourceRegistry{
    constructor(){this._sources=new Map()}
    register(source){
      if(!source?.id)throw new Error('SourceRegistry: source.id richiesto');
      if(this._sources.has(source.id))throw new Error('SourceRegistry: source duplicata '+source.id);
      this._sources.set(source.id,source);return source;
    }
    get(id){return this._sources.get(text(id))||null}
    list(){return freeze([...this._sources.values()])}
    supporting(capability){
      const id=text(capability);
      return freeze([...this._sources.values()].filter(source=>source.supports?.(id)));
    }
    summary(){
      return freeze(this.list().map(source=>freeze({
        id:source.id,providerId:source.providerId,network:source.network,
        mode:source.mode,kind:source.kind,label:source.label,capabilityIds:source.capabilityIds
      })));
    }
  }

  function createRegistry(){return new SourceRegistry()}

  global.UVTransitCapabilities=freeze({
    DEFINITIONS,
    METHOD_CAPABILITY,
    createSourceAdapter,
    SourceRegistry,
    createRegistry,
    labelsFor,
    _test:freeze({normalizeCapabilityIds,capabilityMap,boundArgs})
  });
})(window);
