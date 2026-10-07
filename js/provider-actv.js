/* U.Venice Transport — official ACTV data provider.
   Static GTFS and GTFS-Realtime come from ACTV/AVM official open-data feeds.
   The browser consumes same-origin proxy endpoints for reliability/CORS and
   reconciles realtime identifiers against the current static runtime index. */
(function(global){
  'use strict';

  const NETWORKS=Object.freeze({
    aut:Object.freeze({
      staticOfficial:'https://actv.avmspa.it/sites/default/files/attachments/opendata/automobilistico/actv_aut.zip',
      vehiclePositionsOfficial:'https://tpl.actv.it/aut/GTFSRT/vehiclePositions',
      tripUpdatesOfficial:'https://tpl.actv.it/aut/GTFSRT/tripUpdates'
    }),
    nav:Object.freeze({
      staticOfficial:'https://actv.avmspa.it/sites/default/files/attachments/opendata/navigazione/actv_nav.zip',
      vehiclePositionsOfficial:'https://tpl.actv.it/nav/GTFSRT/vehiclePositions',
      tripUpdatesOfficial:'https://tpl.actv.it/nav/GTFSRT/tripUpdates'
    })
  });
  const RUNTIME_BASE=new URL('runtime-data/',document.baseURI).href;
  const REALTIME_PROXY=new URL('api/actv-realtime.php',document.baseURI).href;
  const STATIC_PROXY=new URL('api/actv-static.php',document.baseURI).href;
  const PAIR_CACHE_MS=1200;

  const manifestState={promise:null,value:null};
  const coreCache=new Map();
  const shapesCache=new Map();
  const scheduleIndexCache=new Map();
  const matcherCache=new Map();
  const servicePlanCache=new Map();
  const expectedModelCache=new Map();
  const identityResolverCache=new Map();
  const vehicleContinuityCache=new Map();
  const vehicleRegistryCache=new Map();
  const delayPositionCache=new Map();
  const motionStateCache=new Map();
  const transitStateEngineCache=new Map();
  const driverStateAdapterCache=new Map();
  const derivedEventEngineCache=new Map();
  const predictionAccuracyCache=new Map();
  const learningLayerCache=new Map();
  const learningModelBundleCache=new Map();
  const operationalModelCache=new Map();
  const rawPairState=new Map();
  const pairState=new Map();
  const observationStores=new Map();
  const observationHistoryStores=new Map();
  const lastStats=new Map();

  function normalizeNetwork(network){
    network=network||'aut';
    if(!Object.prototype.hasOwnProperty.call(NETWORKS,network))
      throw new Error(`Rete ACTV realtime non supportata: ${network}`);
    return network;
  }
  function normalizeRuntimeNetwork(network){
    network=String(network||'').trim();
    if(!network)throw new Error('Rete runtime non specificata');
    return network;
  }

  function endpointsFor(network){
    network=normalizeNetwork(network);
    const official=NETWORKS[network];
    return Object.freeze({
      network,
      staticOfficial:official.staticOfficial,
      vehiclePositionsOfficial:official.vehiclePositionsOfficial,
      tripUpdatesOfficial:official.tripUpdatesOfficial,
      gtfs:STATIC_PROXY+'?network='+encodeURIComponent(network),
      vehiclePositions:REALTIME_PROXY+'?network='+encodeURIComponent(network)+'&feed=vehiclePositions',
      tripUpdates:REALTIME_PROXY+'?network='+encodeURIComponent(network)+'&feed=tripUpdates',
      runtimeManifest:RUNTIME_BASE+'manifest.json'
    });
  }
  const endpoints=endpointsFor('aut');

  async function checked(url,options){
    const res=await fetch(url,options||{});
    if(!res.ok)throw new Error(`HTTP ${res.status} su ${url}`);
    return res;
  }
  async function fetchJson(url,options){return (await checked(url,options)).json()}
  async function fetchBlob(url,options){return (await checked(url,options)).blob()}
  async function fetchArrayBuffer(url,options){return (await checked(url,options)).arrayBuffer()}

  function runtimeEntry(manifest,network){
    network=normalizeRuntimeNetwork(network);
    const entry=manifest?.networks?.[network];
    if(!entry?.core?.file)throw new Error(`Runtime index ${network} non disponibile`);
    return entry;
  }

  async function loadRuntimeManifest(){
    if(manifestState.value)return manifestState.value;
    if(manifestState.promise)return manifestState.promise;
    manifestState.promise=fetchJson(endpoints.runtimeManifest+'?_='+Date.now(),{cache:'no-cache'})
      .then(manifest=>{
        if(Number(manifest?.schema)!==1)throw new Error('Manifest runtime non compatibile');
        manifestState.value=manifest;return manifest;
      }).finally(()=>{manifestState.promise=null});
    return manifestState.promise;
  }

  function snapshotForDay(entry,serviceDate){
    const resolver=global.UVTransitServiceDateResolver;
    if(resolver&&Array.isArray(entry?.snapshots)){
      const resolved=resolver.resolve(entry,serviceDate,{allowLegacyFallback:false});
      if(!resolved.snapshot)throw new Error(`Nessuno snapshot statico copre la serviceDate ${serviceDate}`);
      return resolved.snapshot;
    }
    return entry;
  }

  function snapshotId(snapshot){
    return snapshot?.id||snapshot?.sourceZipSha256||snapshot?.schedule?.file||'legacy-current';
  }

  async function loadRuntimeCore(network,manifest,snapshot){
    network=normalizeRuntimeNetwork(network);
    manifest=manifest||await loadRuntimeManifest();
    const entry=runtimeEntry(manifest,network),selected=snapshot||(Array.isArray(entry.snapshots)&&global.UVTransitServiceDateResolver?snapshotForDay(entry,veniceDay(0)):entry),key=network+':'+selected.core?.file;
    if(!selected.core?.file)throw new Error(`Core runtime ${network} non disponibile`);
    if(coreCache.has(key))return {manifest,entry,snapshot:selected,data:coreCache.get(key)};
    const data=await fetchJson(new URL(selected.core.file,RUNTIME_BASE).href,{cache:'force-cache'});
    if(Number(data?.schema)!==1||data?.network!==network)throw new Error(`Core runtime ${network} non compatibile`);
    coreCache.set(key,data);return {manifest,entry,snapshot:selected,data};
  }

  async function loadRuntimeShapes(network,manifest,snapshot){
    network=normalizeRuntimeNetwork(network);
    manifest=manifest||await loadRuntimeManifest();
    const entry=runtimeEntry(manifest,network),selected=snapshot||(Array.isArray(entry.snapshots)&&global.UVTransitServiceDateResolver?snapshotForDay(entry,veniceDay(0)):entry);
    if(!selected.shapes?.file)return {manifest,entry,snapshot:selected,data:{schema:1,network,shapes:{}}};
    const key=network+':'+selected.shapes.file;
    if(shapesCache.has(key))return {manifest,entry,snapshot:selected,data:shapesCache.get(key)};
    const data=await fetchJson(new URL(selected.shapes.file,RUNTIME_BASE).href,{cache:'force-cache'});
    if(Number(data?.schema)!==1||data?.network!==network||!data?.shapes)
      throw new Error(`Shapes runtime ${network} non compatibili`);
    shapesCache.set(key,data);return {manifest,entry,snapshot:selected,data};
  }

  async function loadScheduleIndex(network,manifest,snapshot){
    network=normalizeRuntimeNetwork(network);
    manifest=manifest||await loadRuntimeManifest();
    const entry=runtimeEntry(manifest,network),selected=snapshot||entry;
    if(!selected.schedule?.file)throw new Error(`Schedule runtime ${network} non disponibile`);
    const key=network+':'+selected.schedule.file;
    if(scheduleIndexCache.has(key))return {manifest,entry,snapshot:selected,index:scheduleIndexCache.get(key)};
    const index=await fetchJson(new URL(selected.schedule.file,RUNTIME_BASE).href,{cache:'force-cache'});
    if(Number(index?.schema)!==2||index?.network!==network||!index?.chunks||!Array.isArray(index?.days))
      throw new Error(`Schedule runtime ${network} non compatibile`);
    scheduleIndexCache.set(key,index);return {manifest,entry,snapshot:selected,index};
  }

  function veniceDay(offsetDays,nowMs){
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date(nowMs==null?Date.now():nowMs));
    const p={};for(const x of parts)if(x.type!=='literal')p[x.type]=Number(x.value);
    const d=new Date(Date.UTC(p.year,p.month-1,p.day+Number(offsetDays||0)));
    return String(d.getUTCFullYear())+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0');
  }

  function mergeRows(parts,keyIndex){
    const out=new Map();
    for(const rows of parts)for(const row of rows||[]){
      if(!Array.isArray(row))continue;
      const key=String(row[keyIndex]??'');if(key&&!out.has(key))out.set(key,row);
    }
    return [...out.values()];
  }

  async function loadResolvedSchedule(network,manifest,wantedDays){
    network=normalizeRuntimeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    const entry=runtimeEntry(manifest,network);
    if(!Array.isArray(entry.snapshots)||!global.UVTransitServiceDateResolver){
      const {index,snapshot}=await loadScheduleIndex(network,manifest,entry);
      const days=(wantedDays?.length?wantedDays:index.days).filter(day=>index.chunks?.[day]?.file),chunksData={};
      await Promise.all(days.map(async day=>{
        const meta=index.chunks[day],chunk=await fetchJson(new URL(meta.file,RUNTIME_BASE).href,{cache:'force-cache'});
        if(Number(chunk?.schema)!==2||chunk?.network!==network||chunk?.day!==day||!Array.isArray(chunk?.trips))
          throw new Error(`Schedule runtime ${network}/${day} non compatibile`);
        chunksData[day]=chunk;
      }));
      return {entry,snapshots:[snapshot],data:{...index,days,chunksData,snapshotByDay:Object.fromEntries(days.map(d=>[d,snapshotId(snapshot)]))}};
    }

    const resolved=[];
    for(const day of wantedDays||[]){
      try{resolved.push({day,snapshot:snapshotForDay(entry,day)})}catch(_e){}
    }
    if(!resolved.length)throw new Error(`Nessuno snapshot statico disponibile per ${network}`);

    const grouped=new Map();
    for(const row of resolved){
      const key=snapshotId(row.snapshot);
      if(!grouped.has(key))grouped.set(key,{snapshot:row.snapshot,days:[]});
      grouped.get(key).days.push(row.day);
    }

    const parts=[],chunksData={},snapshotByDay={},usedSnapshots=[];
    for(const group of grouped.values()){
      const {index}=await loadScheduleIndex(network,manifest,group.snapshot);
      usedSnapshots.push(group.snapshot);parts.push(index);
      await Promise.all(group.days.map(async day=>{
        const meta=index.chunks?.[day];
        if(!meta?.file)return;
        const chunk=await fetchJson(new URL(meta.file,RUNTIME_BASE).href,{cache:'force-cache'});
        if(Number(chunk?.schema)!==2||chunk?.network!==network||chunk?.day!==day||!Array.isArray(chunk?.trips))
          throw new Error(`Schedule runtime ${network}/${day} non compatibile`);
        chunksData[day]=chunk;snapshotByDay[day]=snapshotId(group.snapshot);
      }));
    }

    const days=Object.keys(chunksData).sort();
    if(!days.length)throw new Error(`Nessun chunk orario risolto per ${network}`);
    return {entry,snapshots:usedSnapshots,data:{
      schema:2,network,timezone:parts[0]?.timezone||'Europe/Rome',buildDay:veniceDay(0),days,
      routes:mergeRows(parts.map(x=>x.routes),0),stops:mergeRows(parts.map(x=>x.stops),0),
      transfers:mergeRows(parts.map(x=>x.transfers),0),
      transferRules:parts.flatMap(x=>Array.isArray(x.transferRules)?x.transferRules:[]),
      chunksData,snapshotByDay,sourceSnapshots:usedSnapshots.map(snapshotId)
    }};
  }

  async function loadRuntimeSchedule(network,manifest){
    manifest=manifest||await loadRuntimeManifest();const entry=runtimeEntry(manifest,network);
    if(!Array.isArray(entry.snapshots)||!global.UVTransitServiceDateResolver)
      return loadResolvedSchedule(network,manifest,null);
    const wanted=Array.from({length:8},(_,i)=>veniceDay(i-1));
    return loadResolvedSchedule(network,manifest,wanted);
  }

  async function loadRealtimeSchedule(network,manifest){
    manifest=manifest||await loadRuntimeManifest();
    const entry=runtimeEntry(manifest,network);
    if(Array.isArray(entry.snapshots)&&global.UVTransitServiceDateResolver)
      snapshotForDay(entry,veniceDay(0)); // current service date is mandatory; never fall through to an unrelated publication.
    return loadResolvedSchedule(network,manifest,[veniceDay(0),veniceDay(-1)]);
  }

  function mergeCoreData(network,parts){
    const unique=(rows,key)=>{const out=new Map();for(const list of rows)for(const row of list||[]){const id=String(row?.[key]||'');if(id&&!out.has(id))out.set(id,row)}return [...out.values()]};
    const routeShapes={};
    for(const core of parts)for(const [rid,ids] of Object.entries(core?.routeShapes||{})){
      const set=new Set(routeShapes[rid]||[]);for(const id of ids||[])set.add(id);routeShapes[rid]=[...set];
    }
    return {schema:1,network,
      agencies:unique(parts.map(x=>x.agencies),'id'),
      routes:unique(parts.map(x=>x.routes),'id'),
      trips:unique(parts.map(x=>x.trips),'id'),
      stops:unique(parts.map(x=>x.stops),'id'),
      routeShapes
    };
  }

  function mergeShapeData(parts){
    const shapes={};for(const part of parts)for(const [id,points] of Object.entries(part?.shapes||{}))if(!shapes[id])shapes[id]=points;
    return shapes;
  }

  async function loadServicePlan(network,manifest,wantedDays){
    network=normalizeNetwork(network);
    manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitServicePlan)throw new Error('ServicePlan core non disponibile');
    const days=Array.isArray(wantedDays)&&wantedDays.length?wantedDays:Array.from({length:8},(_,i)=>veniceDay(i-1));
    const schedule=await loadResolvedSchedule(network,manifest,days);
    const snapshots=schedule.snapshots?.length?schedule.snapshots:[runtimeEntry(manifest,network)];
    const cacheKey=[
      network,
      days.join(','),
      snapshots.map(x=>[x.core?.file||'',x.schedule?.file||''].join('|')).join('::')
    ].join('||');
    if(servicePlanCache.has(cacheKey))return {manifest,entry:schedule.entry,snapshots,plan:servicePlanCache.get(cacheKey),schedule:schedule.data};

    const coreRows=await Promise.all(snapshots.map(async snapshot=>({
      snapshotId:snapshotId(snapshot),
      core:(await loadRuntimeCore(network,manifest,snapshot)).data
    })));
    const coreParts=coreRows.map(x=>x.core),core=mergeCoreData(network,coreParts);
    const coreBySnapshot=Object.fromEntries(coreRows.map(x=>[x.snapshotId,x.core]));
    const plan=global.UVTransitServicePlan.createServicePlan({
      provider:'actv-official',network,core,schedule:schedule.data,coreBySnapshot
    });
    servicePlanCache.set(cacheKey,plan);
    return {manifest,entry:schedule.entry,snapshots,plan,schedule:schedule.data};
  }

  async function loadExpectedPositionModel(network,manifest,wantedDays){
    network=normalizeNetwork(network);
    manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitExpectedPosition)throw new Error('Expected Position core non disponibile');
    const service=await loadServicePlan(network,manifest,wantedDays);
    const snapshots=service.snapshots;
    const cacheKey=[
      network,
      service.plan.serviceDates().join(','),
      snapshots.map(x=>[x.core?.file||'',x.shapes?.file||'',x.schedule?.file||''].join('|')).join('::')
    ].join('||');
    if(expectedModelCache.has(cacheKey))
      return {...service,expectedPosition:expectedModelCache.get(cacheKey)};

    const shapeRows=await Promise.all(snapshots.map(async snapshot=>({
      snapshotId:snapshotId(snapshot),
      shapes:(await loadRuntimeShapes(network,manifest,snapshot)).data
    })));
    const shapesBySnapshot=Object.fromEntries(shapeRows.map(x=>[x.snapshotId,x.shapes]));
    const expectedPosition=global.UVTransitExpectedPosition.createExpectedPositionModel({
      servicePlan:service.plan,shapesBySnapshot
    });
    expectedModelCache.set(cacheKey,expectedPosition);
    return {...service,expectedPosition};
  }

  function actvTripKeys(value){
    value=String(value??'').trim();if(!value)return [];
    const out=[value],parts=value.split('_');
    if(parts.length>=4&&String(parts[1]||'').toUpperCase()==='ACTV'&&/^\d+$/.test(parts[2])){
      const tail=parts.slice(3).join('_');if(tail&&!out.includes(tail))out.push(tail);
    }
    return out;
  }

  function loadVehicleContinuity(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitVehicleContinuity)return null;
    if(!vehicleContinuityCache.has(network))vehicleContinuityCache.set(network,global.UVTransitVehicleContinuity.createVehicleContinuityStore());
    return vehicleContinuityCache.get(network);
  }

  async function loadIdentityResolver(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitIdentityResolver)throw new Error('Identity Resolver core non disponibile');
    const expected=await loadExpectedPositionModel(network,manifest,wantedDays);
    const vehicleContinuity=loadVehicleContinuity(network);
    const cached=identityResolverCache.get(network);
    if(cached?.expectedPosition===expected.expectedPosition&&cached?.vehicleContinuity===vehicleContinuity)
      return {...expected,vehicleContinuity,identityResolver:cached.resolver};
    const resolver=global.UVTransitIdentityResolver.createIdentityResolver({
      servicePlan:expected.plan,
      expectedPosition:expected.expectedPosition,
      tripKeys:actvTripKeys,
      continuityStore:vehicleContinuity
    });
    identityResolverCache.set(network,{expectedPosition:expected.expectedPosition,vehicleContinuity,resolver});
    return {...expected,vehicleContinuity,identityResolver:resolver};
  }

  function loadVehicleRegistry(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitVehicleRegistry)return null;
    if(!vehicleRegistryCache.has(network))vehicleRegistryCache.set(network,global.UVTransitVehicleRegistry.createVehicleRegistry());
    return vehicleRegistryCache.get(network);
  }

  async function resolveObservations(network,manifest,wantedDays){
    network=normalizeNetwork(network);
    const [identity,observed]=await Promise.all([
      loadIdentityResolver(network,manifest,wantedDays),
      loadObservations(network)
    ]);
    const resolutions=identity.identityResolver.resolveBatch(observed.observations);
    return {
      provider:'actv-official',network,receivedAt:observed.receivedAt,
      observations:observed.observations,resolutions,
      identityResolver:identity.identityResolver,
      stats:identity.identityResolver.summary(resolutions)
    };
  }

  function delayPositionForExpected(network,expected){
    const cached=delayPositionCache.get(network);
    if(cached?.expectedPosition===expected.expectedPosition)return cached.model;
    const model=global.UVTransitDelayPosition.createDelayPositionModel({
      servicePlan:expected.plan,
      expectedPosition:expected.expectedPosition
    });
    delayPositionCache.set(network,{expectedPosition:expected.expectedPosition,model});
    return model;
  }

  async function loadDelayPositionModel(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitDelayPosition)throw new Error('Delay/Position core non disponibile');
    const expected=await loadExpectedPositionModel(network,manifest,wantedDays);
    return {...expected,delayPosition:delayPositionForExpected(network,expected)};
  }

  function motionStateForExpected(network,expected,delayPosition){
    const cached=motionStateCache.get(network);
    if(cached?.expectedPosition===expected.expectedPosition&&cached?.delayPosition===delayPosition)
      return cached.model;
    if(!global.UVTransitMotionState)throw new Error('Motion State core non disponibile');
    if(!global.UVTransitPrediction)throw new Error('Prediction core non disponibile');
    const predictionOptions=network==='nav'
      ?global.UVTransitPrediction.PROFILES?.water
      :global.UVTransitPrediction.PROFILES?.land;
    const model=global.UVTransitMotionState.createMotionStateModel({
      servicePlan:expected.plan,
      expectedPosition:expected.expectedPosition,
      delayPosition,
      predictionOptions
    });
    motionStateCache.set(network,{
      expectedPosition:expected.expectedPosition,delayPosition,model
    });
    return model;
  }

  async function loadMotionStateModel(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    const identity=await loadIdentityResolver(network,manifest,wantedDays);
    const delayPosition=delayPositionForExpected(network,identity);
    return {...identity,delayPosition,motionState:motionStateForExpected(network,identity,delayPosition)};
  }

  async function loadTransitStateEngine(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitState)throw new Error('Transit State Engine core non disponibile');
    if(!global.UVTransitDelayPosition)throw new Error('Delay/Position core non disponibile');
    const identity=await loadIdentityResolver(network,manifest,wantedDays);
    const delayPosition=delayPositionForExpected(network,identity);
    const motionState=motionStateForExpected(network,identity,delayPosition);
    const vehicleRegistry=loadVehicleRegistry(network);
    const vehicleContinuity=identity.vehicleContinuity||loadVehicleContinuity(network);
    const cached=transitStateEngineCache.get(network);
    if(cached?.identityResolver===identity.identityResolver&&
       cached?.delayPosition===delayPosition&&cached?.motionState===motionState&&cached?.vehicleRegistry===vehicleRegistry&&cached?.vehicleContinuity===vehicleContinuity)
      return {...identity,delayPosition,motionState,vehicleRegistry,vehicleContinuity,transitStateEngine:cached.engine};
    const engine=global.UVTransitState.createTransitStateEngine({
      servicePlan:identity.plan,
      expectedPosition:identity.expectedPosition,
      identityResolver:identity.identityResolver,
      delayPosition,
      motionState,
      vehicleRegistry,
      vehicleContinuity
    });
    transitStateEngineCache.set(network,{identityResolver:identity.identityResolver,delayPosition,motionState,vehicleRegistry,vehicleContinuity,engine});
    return {...identity,delayPosition,motionState,vehicleRegistry,vehicleContinuity,transitStateEngine:engine};
  }

  function loadPredictionAccuracyEngine(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitPredictionAccuracy)
      throw new Error('Prediction Accuracy core non disponibile');
    if(!predictionAccuracyCache.has(network))
      predictionAccuracyCache.set(network,global.UVTransitPredictionAccuracy.createPredictionAccuracyEngine());
    return predictionAccuracyCache.get(network);
  }

  function loadPredictionAccuracy(network){
    return loadPredictionAccuracyEngine(network).snapshot();
  }

  function loadLearningLayer(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitLearning)return null;
    if(!learningLayerCache.has(network))
      learningLayerCache.set(network,global.UVTransitLearning.createLearningLayer());
    return learningLayerCache.get(network);
  }

  function loadLearningModelBundle(network,learning){
    network=normalizeNetwork(network);
    if(!learning||!global.UVTransitLearningModels)return null;
    const cached=learningModelBundleCache.get(network);
    if(cached?.learning===learning)return cached.bundle;
    const bundle=global.UVTransitLearningModels.createFirstLearningBundle({learningLayer:learning});
    learningModelBundleCache.set(network,{learning,bundle});
    return bundle;
  }

  async function loadOperationalModel(network,manifest,wantedDays,tods){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitOperations)throw new Error('Operational Model core non disponibile');
    const planState=await loadServicePlan(network,manifest,wantedDays);
    const key=[network,planState.plan,tods||null];
    const cached=operationalModelCache.get(network);
    if(cached?.plan===planState.plan&&cached?.tods===tods)return {...planState,operationalModel:cached.model};
    const model=global.UVTransitOperations.createOperationalModel({servicePlan:planState.plan,tods:tods||{}});
    operationalModelCache.set(network,{plan:planState.plan,tods,model});
    return {...planState,operationalModel:model};
  }

  async function loadOperationalState(network,manifest,wantedDays,now,tods){
    const [ops,state]=await Promise.all([
      loadOperationalModel(network,manifest,wantedDays,tods),
      loadTransitState(network,manifest,wantedDays,now)
    ]);
    const operationalSnapshot=ops.operationalModel.snapshot({transitSnapshot:state.snapshot,now:state.snapshot.generatedAt});
    return {
      provider:'actv-official',network:normalizeNetwork(network),
      receivedAt:state.receivedAt,
      snapshot:operationalSnapshot,
      summary:operationalSnapshot.summary()
    };
  }

  async function loadTransitState(network,manifest,wantedDays,now){
    network=normalizeNetwork(network);
    const stateDays=Array.isArray(wantedDays)&&wantedDays.length
      ?wantedDays
      :[veniceDay(0),veniceDay(-1)];
    const [stateCore,observed]=await Promise.all([
      loadTransitStateEngine(network,manifest,stateDays),
      loadObservations(network)
    ]);
    const resolutions=stateCore.identityResolver.resolveBatch(observed.observations);
    const snapshot=stateCore.transitStateEngine.snapshot({
      observations:observed.observations,resolutions,now,persistVehicleRegistry:true
    });
    const predictionAccuracy=loadPredictionAccuracyEngine(network).ingest(snapshot);
    let learning=null,learningSummary=null,learningCandidates=null;
    try{learning=loadLearningLayer(network)}catch(_error){learning=null}
    if(learning){
      try{
        const bundle=loadLearningModelBundle(network,learning);
        learningCandidates=bundle?bundle.observe({
          snapshot,resolutions,observations:observed.observations,
          servicePlan:stateCore.plan,now:snapshot.generatedAt
        }):null;
      }catch(_candidateError){learningCandidates=null}
      try{
        const baseSummary=learning.observeTransitSnapshot(snapshot,{
          observations:observed.observations,resolutions
        });
        learningSummary=learningCandidates
          ?Object.freeze({...baseSummary,candidates:learningCandidates})
          :baseSummary;
      }catch(_learningError){learningSummary=null}
    }
    return {
      provider:'actv-official',network,receivedAt:observed.receivedAt,
      observations:observed.observations,resolutions,snapshot,
      predictionAccuracy,
      predictionAccuracySummary:predictionAccuracy.summary(),
      learning,learningSummary,
      observationHistory:observed.history,
      observationHistorySummary:observed.historySummary,
      vehicleRegistry:snapshot.vehicleRegistrySnapshot,
      vehicleContinuity:snapshot.vehicleContinuitySnapshot,
      transitStateEngine:stateCore.transitStateEngine,
      stats:snapshot.summary()
    };
  }

  async function loadDriverStateAdapter(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitDriverState)throw new Error('Driver State Adapter core non disponibile');
    const days=Array.isArray(wantedDays)&&wantedDays.length
      ?wantedDays
      :[veniceDay(0),veniceDay(-1)];
    const daysKey=days.join(',');
    const cached=driverStateAdapterCache.get(network);
    if(cached?.manifest===manifest&&cached?.daysKey===daysKey)
      return {...cached.stateCore,driverStateAdapter:cached.adapter};

    const stateCore=await loadTransitStateEngine(network,manifest,days);
    if(cached?.transitStateEngine===stateCore.transitStateEngine){
      const refreshed={manifest,daysKey,stateCore,transitStateEngine:stateCore.transitStateEngine,adapter:cached.adapter};
      driverStateAdapterCache.set(network,refreshed);
      return {...stateCore,driverStateAdapter:cached.adapter};
    }
    const adapter=global.UVTransitDriverState.createDriverStateAdapter({
      servicePlan:stateCore.plan,
      expectedPosition:stateCore.expectedPosition,
      identityResolver:stateCore.identityResolver,
      transitStateEngine:stateCore.transitStateEngine
    });
    driverStateAdapterCache.set(network,{
      manifest,daysKey,stateCore,transitStateEngine:stateCore.transitStateEngine,adapter
    });
    return {...stateCore,driverStateAdapter:adapter};
  }

  async function loadDerivedEventEngine(network,manifest,wantedDays){
    network=normalizeNetwork(network);manifest=manifest||await loadRuntimeManifest();
    if(!global.UVTransitDerivedEvents)throw new Error('Derived Event Engine core non disponibile');
    const days=Array.isArray(wantedDays)&&wantedDays.length
      ?wantedDays
      :[veniceDay(0),veniceDay(-1)];
    const daysKey=days.join(',');
    const cached=derivedEventEngineCache.get(network);
    if(cached?.manifest===manifest&&cached?.daysKey===daysKey)
      return {...cached.stateCore,derivedEventEngine:cached.engine};

    const stateCore=await loadTransitStateEngine(network,manifest,days);
    if(cached?.transitStateEngine===stateCore.transitStateEngine){
      const refreshed={manifest,daysKey,stateCore,transitStateEngine:stateCore.transitStateEngine,engine:cached.engine};
      derivedEventEngineCache.set(network,refreshed);
      return {...stateCore,derivedEventEngine:cached.engine};
    }
    const engine=global.UVTransitDerivedEvents.createDerivedEventEngine({
      servicePlan:stateCore.plan,
      expectedPosition:stateCore.expectedPosition
    });
    derivedEventEngineCache.set(network,{
      manifest,daysKey,stateCore,transitStateEngine:stateCore.transitStateEngine,engine
    });
    return {...stateCore,derivedEventEngine:engine};
  }

  async function loadDerivedEvents(network,manifest,wantedDays,now,officialAlerts){
    network=normalizeNetwork(network);
    const derivedCore=await loadDerivedEventEngine(network,manifest,wantedDays);
    const observed=await loadObservations(network);
    const resolutions=derivedCore.identityResolver.resolveBatch(observed.observations);
    const snapshot=derivedCore.transitStateEngine.snapshot({
      observations:observed.observations,resolutions,now,persistVehicleRegistry:true
    });
    const events=derivedCore.derivedEventEngine.analyze(snapshot,{
      officialAlerts:Array.isArray(officialAlerts)?officialAlerts:[]
    });
    return {
      provider:'actv-official',network,receivedAt:observed.receivedAt,
      snapshot,observations:observed.observations,resolutions,
      observationHistory:observed.history,
      observationHistorySummary:observed.historySummary,
      events,derivedEventEngine:derivedCore.derivedEventEngine,
      stats:events.summary()
    };
  }

  async function ensureMatcher(network){
    network=normalizeNetwork(network);
    const manifest=await loadRuntimeManifest(),schedule=await loadRealtimeSchedule(network,manifest);
    const snapshots=schedule.snapshots?.length?schedule.snapshots:[runtimeEntry(manifest,network)];
    const key=snapshots.map(s=>[s.core?.file||'',s.schedule?.file||'',s.shapes?.file||''].join('|')).join('::');
    const cached=matcherCache.get(network);
    if(cached?.key===key)return cached.matcher;
    if(!global.UVTransitACTVNormalizer)throw new Error('Normalizzatore ACTV non disponibile');
    const staticParts=await Promise.all(snapshots.map(async snapshot=>{
      const [core,shapes]=await Promise.all([
        loadRuntimeCore(network,manifest,snapshot),
        loadRuntimeShapes(network,manifest,snapshot)
      ]);
      return {core:core.data,shapes:shapes.data};
    }));
    const matcher=global.UVTransitACTVNormalizer.createMatcher({
      network,
      core:mergeCoreData(network,staticParts.map(x=>x.core)),
      schedule:schedule.data,
      shapes:mergeShapeData(staticParts.map(x=>x.shapes))
    });
    if(!matcher.stats||typeof matcher.stats!=='object')matcher.stats={};
    matcher.stats.serviceDateSnapshots=schedule.data.snapshotByDay||{};
    matcherCache.set(network,{key,matcher});
    return matcher;
  }

  async function loadStaticGtfs(network){
    return fetchBlob(endpointsFor(network).gtfs+'&_='+Date.now(),{cache:'no-store'});
  }

  async function fetchRawRealtimePair(network){
    network=normalizeNetwork(network);
    const now=Date.now(),state=rawPairState.get(network);
    if(state?.value&&now-state.at<PAIR_CACHE_MS)return state.value;
    if(state?.promise)return state.promise;
    if(!global.UVTransitGTFSRT)throw new Error('Decoder GTFS-RT non disponibile');

    const holder=state||{};
    holder.promise=(async()=>{
      const ep=endpointsFor(network),receivedAt=Date.now()/1000;
      const [tuBytes,vpBytes]=await Promise.all([
        fetchArrayBuffer(ep.tripUpdates+'&_='+Date.now(),{cache:'no-store'}),
        fetchArrayBuffer(ep.vehiclePositions+'&_='+Date.now(),{cache:'no-store'})
      ]);
      return {
        tripUpdates:global.UVTransitGTFSRT.decodeFeed(tuBytes),
        vehiclePositions:global.UVTransitGTFSRT.decodeFeed(vpBytes),
        receivedAt
      };
    })().then(value=>{
      holder.value=value;holder.at=Date.now();return value;
    }).finally(()=>{holder.promise=null});
    rawPairState.set(network,holder);
    return holder.promise;
  }

  function observationStore(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitObservations)throw new Error('Observation core non disponibile');
    if(!observationStores.has(network))observationStores.set(network,new global.UVTransitObservations.ObservationStore());
    return observationStores.get(network);
  }

  function observationHistoryStore(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitObservationHistory)throw new Error('Observation History core non disponibile');
    if(!observationHistoryStores.has(network))
      observationHistoryStores.set(network,global.UVTransitObservationHistory.createObservationHistoryStore());
    return observationHistoryStores.get(network);
  }

  function loadObservationHistory(network){
    network=normalizeNetwork(network);
    return observationHistoryStore(network).snapshot(Date.now()/1000);
  }

  async function loadObservations(network){
    network=normalizeNetwork(network);
    if(!global.UVTransitObservations)throw new Error('Observation core non disponibile');
    if(!global.UVTransitObservationHistory)throw new Error('Observation History core non disponibile');
    const raw=await fetchRawRealtimePair(network);
    const batch=global.UVTransitObservations.fromGtfsRealtimeFeeds({
      provider:'actv-official',network,
      tripUpdates:raw.tripUpdates,vehiclePositions:raw.vehiclePositions,
      receivedAt:raw.receivedAt
    });
    const store=observationStore(network),stats=store.ingestGtfsRealtime(batch);
    const historyStore=observationHistoryStore(network);
    historyStore.ingest(batch.observations,{
      provider:'actv-official',network,receivedAt:batch.receivedAt
    });
    const history=historyStore.snapshot(batch.receivedAt);
    return {
      provider:'actv-official',network,receivedAt:batch.receivedAt,
      observations:batch.observations,store,stats,
      history,historySummary:history.summary()
    };
  }

  function peekRawRealtimePair(network,maxAgeMs=20000){
    network=normalizeNetwork(network);
    const holder=rawPairState.get(network);
    if(!holder?.value||!Number.isFinite(Number(holder.at)))return null;
    const ageMs=Math.max(0,Date.now()-Number(holder.at));
    if(ageMs>Math.max(PAIR_CACHE_MS,Number(maxAgeMs)||20000))return null;
    return Object.freeze({...holder.value,cacheAgeMs:ageMs,cacheOnly:true});
  }

  async function peekTransitState(network,manifest,wantedDays,now,maxAgeMs=20000){
    network=normalizeNetwork(network);
    const raw=peekRawRealtimePair(network,maxAgeMs);
    if(!raw)return null;
    if(!global.UVTransitObservations)throw new Error('Observation core non disponibile');
    const batch=global.UVTransitObservations.fromGtfsRealtimeFeeds({
      provider:'actv-official',network,
      tripUpdates:raw.tripUpdates,vehiclePositions:raw.vehiclePositions,
      receivedAt:raw.receivedAt
    });
    const stateCore=await loadTransitStateEngine(network,manifest,wantedDays);
    const resolutions=stateCore.identityResolver.resolveBatch(batch.observations);
    const snapshot=stateCore.transitStateEngine.snapshot({
      observations:batch.observations,resolutions,now,persistVehicleRegistry:false
    });
    return Object.freeze({
      provider:'actv-official',network,receivedAt:raw.receivedAt,
      snapshot,cacheOnly:true,cacheAgeMs:raw.cacheAgeMs
    });
  }

  async function fetchRealtimePair(network){
    network=normalizeNetwork(network);
    const now=Date.now(),state=pairState.get(network);
    if(state?.value&&now-state.at<PAIR_CACHE_MS)return state.value;
    if(state?.promise)return state.promise;
    if(!global.UVTransitACTVNormalizer)throw new Error('Normalizzatore ACTV non disponibile');

    const holder=state||{};
    holder.promise=(async()=>{
      const [matcher,raw]=await Promise.all([ensureMatcher(network),fetchRawRealtimePair(network)]);
      const value=global.UVTransitACTVNormalizer.normalizePair(matcher,raw.tripUpdates,raw.vehiclePositions);
      lastStats.set(network,value.stats);
      holder.value=value;holder.at=Date.now();
      try{
        global.dispatchEvent?.(new CustomEvent('uv:transit-cache',{detail:{
          provider:'actv-official',network,receivedAt:raw.receivedAt,cacheAt:holder.at
        }}));
      }catch(_){}
      return value;
    })().finally(()=>{holder.promise=null});
    pairState.set(network,holder);
    return holder.promise;
  }

  async function loadVehiclePositions(network){
    return (await fetchRealtimePair(network)).vehiclePositions;
  }
  async function loadTripUpdates(network){
    return (await fetchRealtimePair(network)).tripUpdates;
  }
  async function loadStatus(network){
    network=normalizeNetwork(network);
    return {
      provider:'actv-official',network,
      official:NETWORKS[network],
      transport:'polling',
      normalization:lastStats.get(network)||null
    };
  }

  function connect(network,onTick,handlers){
    /* ACTV publishes HTTP GTFS-RT, not a websocket. Existing callers already
       switch to their tested polling fallback when connect() returns null. */
    if(typeof network==='function'){handlers=onTick;onTick=network;network='aut'}
    normalizeNetwork(network);
    return null;
  }

  const provider=Object.freeze({
    id:'actv-official',
    label:'ACTV Open Data ufficiali',
    endpoints,endpointsFor,
    loadRuntimeManifest,loadRuntimeCore,loadRuntimeShapes,loadRuntimeSchedule,loadServicePlan,loadOperationalModel,loadOperationalState,loadExpectedPositionModel,loadVehicleContinuity,loadIdentityResolver,loadVehicleRegistry,loadDelayPositionModel,loadMotionStateModel,loadTransitStateEngine,loadDriverStateAdapter,loadDerivedEventEngine,loadPredictionAccuracyEngine,loadLearningLayer,loadLearningModelBundle,loadOperationalModel,
    loadStaticGtfs,loadObservations,loadObservationHistory,resolveObservations,loadTransitState,peekTransitState,loadPredictionAccuracy,loadDerivedEvents,loadVehiclePositions,loadTripUpdates,loadStatus,connect,
    _test:Object.freeze({normalizeNetwork,normalizeRuntimeNetwork,ensureMatcher,fetchRawRealtimePair,peekRawRealtimePair,peekTransitState,fetchRealtimePair,observationStore,observationHistoryStore,actvTripKeys,delayPositionForExpected,motionStateForExpected,veniceDay,loadRealtimeSchedule,loadResolvedSchedule,snapshotForDay,loadServicePlan,loadExpectedPositionModel,loadVehicleContinuity,loadIdentityResolver,loadVehicleRegistry,loadDelayPositionModel,loadMotionStateModel,loadTransitStateEngine,loadDriverStateAdapter,loadDerivedEventEngine})
  });
  global.UVTransitProvider=provider;

  if(global.UVTransitCapabilities){
    const registry=global.UVTransitSourceRegistry||global.UVTransitCapabilities.createRegistry();
    const common=[
      'static_schedule','realtime_vehicle_positions','realtime_trip_updates',
      'canonical_state','predicted_live','scheduled_simulation',
      'derived_events','operational_state','raw_realtime'
    ];
    const autSource=global.UVTransitCapabilities.createSourceAdapter({
      id:'actv:aut',providerId:'actv-official',network:'aut',mode:'road',
      label:'ACTV autobus e tram',
      capabilities:[...common,'driver_state'],
      delegate:provider,
      metadata:{official:true,operator:'ACTV',area:'Venezia e terraferma'}
    });
    const navSource=global.UVTransitCapabilities.createSourceAdapter({
      id:'actv:nav',providerId:'actv-official',network:'nav',mode:'water',
      label:'ACTV navigazione',
      capabilities:common,
      delegate:provider,
      metadata:{official:true,operator:'ACTV',area:'Laguna di Venezia'}
    });
    if(!registry.get(autSource.id))registry.register(autSource);
    if(!registry.get(navSource.id))registry.register(navSource);
    global.UVTransitSourceRegistry=registry;
    global.UVTransitACTVSources=Object.freeze({aut:autSource,nav:navSource});
    if(global.UVTransitReadAPI){
      global.UVTransitSourceReads=Object.freeze({
        'actv:aut':global.UVTransitReadAPI.create({source:autSource}),
        'actv:nav':global.UVTransitReadAPI.create({source:navSource})
      });
    }
  }

  /* Compatibility aggregate while Map/Journey still consume both ACTV networks
     through one facade. New providers register SourceAdapters instead. */
  if(global.UVTransitReadAPI)global.UVTransitRead=global.UVTransitReadAPI.create({source:provider});
})(window);
