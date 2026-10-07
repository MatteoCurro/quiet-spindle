/* U.Venice Transport — provider-neutral read-only consumer boundary.
   Map, Journey, Driver and Diagnostics read transit data through this facade.
   The source adapter remains replaceable; consumers never need provider-specific
   loader names or access to mutable core engine/store instances. */
(function(global){
  'use strict';
  const freeze=o=>Object.freeze(o);
  const NETWORK_DEFAULT='aut';

  function requireFn(source,name){
    const fn=source?.[name];
    if(typeof fn!=='function')throw new Error('TransitReadAPI: capability '+name+' non disponibile');
    return fn.bind(source);
  }
  function optionalFn(source,name){
    const fn=source?.[name];
    return typeof fn==='function'?fn.bind(source):null;
  }
  function stateView(result,network){
    const snapshot=result?.snapshot||null;
    if(!snapshot)throw new Error('TransitReadAPI: TransitState snapshot non disponibile');
    const metrics=global.UVTransitMetrics?.fromSnapshot
      ?global.UVTransitMetrics.fromSnapshot(snapshot)
      :null;
    const quality=metrics&&global.UVTransitSourceQuality?.fromState
      ?global.UVTransitSourceQuality.fromState({snapshot,metrics})
      :null;
    return freeze({
      provider:result?.provider||snapshot.provider||null,
      network:result?.network||snapshot.network||network||null,
      receivedAt:result?.receivedAt??null,
      snapshot,
      registry:snapshot.vehicleRegistrySnapshot||result?.vehicleRegistry||null,
      continuity:snapshot.vehicleContinuitySnapshot||result?.vehicleContinuity||null,
      observationHistory:result?.observationHistorySummary
        ?freeze({...result.observationHistorySummary})
        :result?.observationHistory?.summary
          ?freeze({...result.observationHistory.summary()})
          :null,
      predictionAccuracy:result?.predictionAccuracySummary
        ?freeze({...result.predictionAccuracySummary})
        :result?.predictionAccuracy?.summary
          ?freeze({...result.predictionAccuracy.summary()})
          :null,
      learning:result?.learningSummary?freeze({...result.learningSummary}):null,
      metrics,
      quality,
      summary:freeze(snapshot.summary?{...snapshot.summary()}:{})
    });
  }
  function derivedView(result,network){
    const events=result?.events||null;
    if(!events)throw new Error('TransitReadAPI: DerivedEvent snapshot non disponibile');
    return freeze({
      provider:result?.provider||null,
      network:result?.network||network||null,
      receivedAt:result?.receivedAt??null,
      snapshot:result?.snapshot||null,
      events,
      summary:freeze(events.summary?{...events.summary()}:{})
    });
  }
  function driverView(result,network){
    const adapter=result?.driverStateAdapter;
    if(!adapter||typeof adapter.routeCandidates!=='function'||typeof adapter.resolve!=='function')
      throw new Error('TransitReadAPI: Driver State Adapter non disponibile');
    return freeze({
      provider:result?.plan?.provider||result?.provider||null,
      network:result?.plan?.network||network||null,
      routeCandidates:(routeHint,now)=>adapter.routeCandidates(routeHint,now),
      resolve:input=>adapter.resolve(input)
    });
  }
  function capabilitiesFor(source){
    const has=name=>typeof source?.[name]==='function';
    return freeze({
      runtimeManifest:has('loadRuntimeManifest'),
      runtimeCore:has('loadRuntimeCore'),
      runtimeShapes:has('loadRuntimeShapes'),
      runtimeSchedule:has('loadRuntimeSchedule'),
      staticGtfs:has('loadStaticGtfs'),
      vehiclePositions:has('loadVehiclePositions'),
      tripUpdates:has('loadTripUpdates'),
      transitState:has('loadTransitState'),
      cachedTransitState:has('peekTransitState'),
      driverState:has('loadDriverStateAdapter'),
      derivedEvents:has('loadDerivedEvents'),
      operationalState:has('loadOperationalState'),
      learning:has('loadLearningLayer'),
      subscription:has('connect')
    });
  }
  function create({source}={}){
    if(!source)throw new Error('TransitReadAPI: source richiesto');

    const runtimeManifest=()=>requireFn(source,'loadRuntimeManifest')();
    const runtimeCore=(network=NETWORK_DEFAULT,manifest,snapshot)=>requireFn(source,'loadRuntimeCore')(network,manifest,snapshot);
    const runtimeShapes=(network=NETWORK_DEFAULT,manifest,snapshot)=>requireFn(source,'loadRuntimeShapes')(network,manifest,snapshot);
    const runtimeSchedule=(network=NETWORK_DEFAULT,manifest)=>requireFn(source,'loadRuntimeSchedule')(network,manifest);
    const staticGtfs=(network=NETWORK_DEFAULT)=>requireFn(source,'loadStaticGtfs')(network);
    const vehiclePositions=(network=NETWORK_DEFAULT)=>requireFn(source,'loadVehiclePositions')(network);
    const tripUpdates=(network=NETWORK_DEFAULT)=>requireFn(source,'loadTripUpdates')(network);
    const transitState=async(network=NETWORK_DEFAULT,{manifest,wantedDays,now}={})=>
      stateView(await requireFn(source,'loadTransitState')(network,manifest,wantedDays,now),network);
    const cachedTransitState=async(network=NETWORK_DEFAULT,{manifest,wantedDays,now,maxAgeMs}={})=>{
      const fn=optionalFn(source,'peekTransitState');
      if(!fn)return null;
      const result=await fn(network,manifest,wantedDays,now,maxAgeMs);
      return result?stateView(result,network):null;
    };
    const driverCore=async(network=NETWORK_DEFAULT,{manifest,wantedDays}={})=>
      driverView(await requireFn(source,'loadDriverStateAdapter')(network,manifest,wantedDays),network);
    const transitMetrics=async(network=NETWORK_DEFAULT,options={})=>
      (await transitState(network,options)).metrics;
    const sourceQuality=async(network=NETWORK_DEFAULT,options={})=>
      (await transitState(network,options)).quality;
    const observationHistory=async(network=NETWORK_DEFAULT,options={})=>
      (await transitState(network,options)).observationHistory;
    const predictionAccuracy=async(network=NETWORK_DEFAULT,options={})=>
      (await transitState(network,options)).predictionAccuracy;
    const learning=async(network=NETWORK_DEFAULT,options={})=>
      (await transitState(network,options)).learning;
    const operationalState=async(network=NETWORK_DEFAULT,{manifest,wantedDays,now,tods}={})=>{
      const result=await requireFn(source,'loadOperationalState')(network,manifest,wantedDays,now,tods);
      const snapshot=result?.snapshot;
      if(!snapshot)throw new Error('TransitReadAPI: Operational snapshot non disponibile');
      return freeze({
        provider:result?.provider||snapshot.provider||null,
        network:result?.network||snapshot.network||network||null,
        receivedAt:result?.receivedAt??null,
        snapshot,
        summary:freeze(snapshot.summary?{...snapshot.summary()}:{})
      });
    };
    const derivedEvents=async(network=NETWORK_DEFAULT,{manifest,wantedDays,now,officialAlerts}={})=>
      derivedView(await requireFn(source,'loadDerivedEvents')(network,manifest,wantedDays,now,officialAlerts),network);
    const subscribe=(onTick,handlers,network=NETWORK_DEFAULT)=>{
      const fn=optionalFn(source,'connect');
      return fn?fn(network,onTick,handlers):null;
    };

    const state=freeze({read:transitState,cached:cachedTransitState});
    const map=freeze({runtimeManifest,runtimeCore,runtimeShapes,staticGtfs,vehiclePositions,tripUpdates,state:transitState,subscribe});
    const journey=freeze({runtimeManifest,runtimeSchedule,runtimeShapes,staticGtfs,tripUpdates,state:transitState,cachedState:cachedTransitState});
    const driver=freeze({core:driverCore,state:transitState});
    const diagnostics=freeze({transitState,transitMetrics,sourceQuality,observationHistory,predictionAccuracy,learning,operationalState,derivedEvents});
    return freeze({capabilities:capabilitiesFor(source),state,map,journey,driver,diagnostics});
  }

  global.UVTransitReadAPI=freeze({
    create,
    _test:freeze({stateView,derivedView,driverView,capabilitiesFor})
  });
})(window);
