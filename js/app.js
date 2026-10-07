(() => {
'use strict';

const PREF_STORE=window.UVTransitPreferences;
if(!PREF_STORE) throw new Error('UVTransitPreferences non disponibile');
const MAX_BUSES=PREF_STORE.MAX_BUSES;

const GTFS_UTIL=window.UVTransitGTFS;
if(!GTFS_UTIL) throw new Error('UVTransitGTFS non disponibile');
const {clamp,parseCSV,distanceM,prepareShape,pointAt,bearingAt,projectToShape,simplify}=GTFS_UTIL;

const PREDICTION=window.UVTransitPrediction;
if(!PREDICTION) throw new Error('UVTransitPrediction non disponibile');

const READ=window.UVTransitRead;
if(!READ) throw new Error('UVTransitRead non disponibile');

const FAVORITES=window.UVTransitFavorites;
if(!FAVORITES) throw new Error('UVTransitFavorites non disponibile');

const DIAGNOSTICS_FACTORY=window.UVTransitDiagnostics;
if(!DIAGNOSTICS_FACTORY) throw new Error('UVTransitDiagnostics non disponibile');

const FALLBACK_POLL_MS=10000;
const MAP_RENDER_MS=100;
const SNAP_MAX_M=100;
const DISPLAY_SIMPLIFY_TRAM_M=13;
const DISPLAY_SIMPLIFY_BUS_M=20;

/* v8.8 step 2: precise, read-only bootstrap timings for performance audits. */
const bootStartedPerf=performance.now();
const bootMetrics={version:'8.13.0',startedAt:new Date().toISOString(),marks:{}};
function bootMark(name){
  if(Object.prototype.hasOwnProperty.call(bootMetrics.marks,name)) return bootMetrics.marks[name];
  const ms=Math.round((performance.now()-bootStartedPerf)*10)/10;
  bootMetrics.marks[name]=ms;
  try{performance.mark('uv-transit:'+name)}catch(_){}
  return ms;
}
window.UVTransitBootMetrics=bootMetrics;
window.UVTransitBootMark=bootMark;
bootMark('scriptStart');

const map=(window.UVTransitMap
  ? UVTransitMap.create('map')
  : L.map('map',{zoomControl:true,preferCanvas:true}).setView([45.493,12.244],12.2));
bootMark('mapReady');

const diagnostics=DIAGNOSTICS_FACTORY.create({
  map,
  rawFixIcon:()=>UVTransitVehiclesLayer.rawFixIcon()
});

/* Carica/normalizza lo store senza modificare la UI in questa release. */
FAVORITES.load();

const $=id=>document.getElementById(id);

const routeById=new Map();
const routeMeta=new Map();
const tripInfo=new Map();
const routeShapeIds=new Map();
const routeDirectionShapeUse=new Map();
const stops=new Map();
const routeStopIds=new Map();
const tripUpdates=new Map();

const geometryCache=new Map();
const routeGeometryLoaded=new Set();
let shapeRowsCache=null;
let shapeRowsPromise=null;
let zipObj=null;
let legacyStaticBlobPromise=null;
let staticMode='unknown';
let runtimeManifest=null;
let runtimeShapesCache=null;
let runtimeShapesPromise=null;
let runtimeShapesFailed=false;
let jsZipLoaderPromise=null;

async function ensureJSZip(){
  if(window.JSZip)return window.JSZip;
  if(jsZipLoaderPromise)return jsZipLoaderPromise;
  jsZipLoaderPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.async=true;
    script.onload=()=>window.JSZip?resolve(window.JSZip):reject(new Error('JSZip non disponibile dopo il caricamento'));
    script.onerror=()=>reject(new Error('Impossibile caricare JSZip per il fallback GTFS'));
    document.head.appendChild(script);
  }).catch(err=>{jsZipLoaderPromise=null;throw err});
  return jsZipLoaderPromise;
}

const vehicles=new Map();
let selectedBuses=new Set();
let busColorMap={};

function selectedTrams(){
  const value=$('tramFilter')?.value||'OFF';
  if(value==='ALL')return new Set(['T1','T2']);
  if(value==='T1'||value==='T2')return new Set([value]);
  return new Set();
}
function setSelectedTrams(next){
  const set=next instanceof Set?next:new Set(next||[]);
  const t1=set.has('T1'),t2=set.has('T2');
  $('tramFilter').value=t1&&t2?'ALL':t1?'T1':t2?'T2':'OFF';
}
function isLandRouteSelected(route){
  return route==='T1'||route==='T2'?selectedTrams().has(route):selectedBuses.has(route);
}

/* Palette limitata alle linee bus ATTIVE: massimo 8 colori molto distinguibili.
   Il colore viene ricordato in localStorage; non serve avere un colore unico
   per tutte le decine di linee del dataset contemporaneamente. */
const BUS_PALETTE=[
  '#b23a48', /* rosso mattone */
  '#6f4aa8', /* viola */
  '#d17a00', /* arancio */
  '#167d8d', /* petrolio */
  '#8a6d1d', /* ocra */
  '#ad4d8c', /* magenta spento */
  '#4f6f2f', /* oliva */
  '#4568a8'  /* blu */
];

function ensureActiveBusColors(){
  const used=new Set();
  const nextMap={...busColorMap};

  /* Prima conserva i colori validi e non duplicati delle linee ancora attive. */
  for(const line of selectedBuses){
    const c=nextMap[line];
    if(c && BUS_PALETTE.includes(c) && !used.has(c)) used.add(c);
    else delete nextMap[line];
  }

  /* Poi assegna il primo colore libero; max 8 linee => sempre disponibile. */
  for(const line of selectedBuses){
    if(nextMap[line]) continue;
    const free=BUS_PALETTE.find(c=>!used.has(c)) || BUS_PALETTE[0];
    nextMap[line]=free;
    used.add(free);
  }

  busColorMap=nextMap;
}

function routeColor(short){
  if(short==='T1') return '#137a59';
  if(short==='T2') return '#396f9d';
  return busColorMap[short] || '#75695e';
}

/* v8.5.5 — same route hue, two luminance levels for the two GTFS directions.
   Route polylines keep routeColor(); only vehicle markers use vehicleColor(). */
function shadeHex(hex,amount){
  const m=String(hex||'').trim().match(/^#([0-9a-f]{6})$/i);
  if(!m)return hex;
  const n=parseInt(m[1],16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const target=amount>=0?255:0;
  const p=Math.min(1,Math.abs(amount));
  r=Math.round(r+(target-r)*p);
  g=Math.round(g+(target-g)*p);
  b=Math.round(b+(target-b)*p);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function vehicleColor(v){
  const base=routeColor(v.route);
  if(String(v.directionId)==='0')return shadeHex(base,.16);
  if(String(v.directionId)==='1')return shadeHex(base,-.16);
  return base;
}

let fetchCounter=0;
let ws=null,fallbackTimer=null;
let lastHeaderTs=0,previousHeaderTs=0;
let userPos=null,userMarker=null,geoWatch=null;
let nearbyState=null;
let lastPhysics=performance.now(),lastMapRender=0;
let didInitialGpsZoom=false;

let prefs=PREF_STORE.load();

function savePrefs(){
  prefs.tramFilter=$('tramFilter').value;
  prefs.buses=[...selectedBuses];
  prefs.busColors={...busColorMap};
  prefs.layers={
    routes:$('layerRoutes').checked,
    stops:$('layerStops').checked,
    next:$('layerNext').checked,
    user:$('layerUser').checked,
    prediction:$('layerPrediction').checked,
    gps:$('layerGPS').checked
  };
  prefs.debug=$('debugMaster').checked;
  prefs=PREF_STORE.save(prefs)
}

function applyPrefsToUI(){
  $('tramFilter').value=prefs.tramFilter;
  selectedBuses=new Set(prefs.buses||[]);
  busColorMap={...(prefs.busColors||{})};
  ensureActiveBusColors();
  $('layerRoutes').checked=!!prefs.layers.routes;
  $('layerStops').checked=!!prefs.layers.stops;
  $('layerNext').checked=!!prefs.layers.next;
  $('layerUser').checked=!!prefs.layers.user;
  $('layerPrediction').checked=!!prefs.layers.prediction;
  $('layerGPS').checked=!!prefs.layers.gps;
  $('debugMaster').checked=!!prefs.debug;
  $('debugWrap').classList.toggle('open',!!prefs.debug);
}

function val(o,...keys){for(const k of keys)if(o&&o[k]!==undefined&&o[k]!==null)return o[k]}
function esc(v){return String(v??'').replace(/[<>&"]/g,'')}
function setStatus(k,t){
  if(window.UVTransitUI) UVTransitUI.setDebugStatus(k,t);
  else {
    const d=document.getElementById('statusDot');
    const s=document.getElementById('status');
    if(d) d.className='dot '+k;
    if(s) s.textContent=t;
  }
}

function refreshFreshnessUI(){
  if(!window.UVTransitHealth) return;
  const h=window.UVTransitHealth.evaluate(lastHeaderTs);

  document.body.classList.toggle('data-stale',h.state==='stale');
  document.body.classList.toggle('data-offline',h.state==='offline');

  if(window.UVTransitNotifications){
    if(h.state==='fresh'){
      UVTransitNotifications.setService({
        level:'success',
        title:'Dati ACTV aggiornati',
        message:`Ultimo aggiornamento circa ${Math.round(h.ageSec)} secondi fa.`,
        visible:true
      });
    }else if(h.state==='stale'){
      UVTransitNotifications.setService({
        level:'warning',
        title:'Dati realtime in ritardo',
        message:`L'ultimo aggiornamento risale a circa ${Math.round(h.ageSec)} secondi fa. Le posizioni potrebbero essere meno precise.`,
        visible:true
      });
    }else if(h.state==='offline'){
      UVTransitNotifications.setService({
        level:'error',
        title:'Dati realtime non aggiornati',
        message:`Nessun nuovo VehiclePositions da circa ${Math.round(h.ageSec)} secondi. I mezzi vengono progressivamente fermati sulla mappa.`,
        visible:true
      });
    }else{
      UVTransitNotifications.setService({
        level:'info',
        title:'In attesa del realtime',
        message:'Sto cercando il primo aggiornamento ACTV.',
        visible:true
      });
    }
  }

  if(h.state==='offline'){
    setStatus('bad','Realtime fermo');
    $('message').innerHTML=
      `<strong>Dati realtime non aggiornati.</strong> L'ultimo VehiclePositions risale a circa ${Math.round(h.ageSec)} secondi fa. `+
      `La predizione viene rallentata e arrestata dal motore: non continuiamo a simulare indefinitamente un mezzo con dati vecchi.`;
  }else if(h.state==='stale'){
    setStatus('warn','Dati in ritardo');
  }
}

function bumpFetch(){fetchCounter++;$('fetchCount').textContent=fetchCounter}
function median(a){
  if(!a.length)return NaN;
  const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

function addRouteMeta(short,type,id){
  if(!routeMeta.has(short))routeMeta.set(short,{type,ids:new Set()});
  routeMeta.get(short).ids.add(id);routeById.set(id,{short,type});
}
function ensureShapeUse(short,dir,shapeId){
  if(!routeDirectionShapeUse.has(short))routeDirectionShapeUse.set(short,new Map());
  const dmap=routeDirectionShapeUse.get(short);
  if(!dmap.has(dir))dmap.set(dir,new Map());
  const smap=dmap.get(dir);smap.set(shapeId,(smap.get(shapeId)||0)+1);
}
function representativeShapeIds(short){
  const dmap=routeDirectionShapeUse.get(short);if(!dmap)return [];
  const out=[];
  for(const smap of dmap.values()){
    let best=null;
    for(const [id,c] of smap)if(!best||c>best.c)best={id,c};
    if(best&&!out.includes(best.id))out.push(best.id);
  }
  return out;
}

function resetStaticIndex(){
  routeById.clear();routeMeta.clear();tripInfo.clear();routeShapeIds.clear();routeDirectionShapeUse.clear();stops.clear();routeStopIds.clear();
}

function indexRuntimeCore(core){
  if(!core||!Array.isArray(core.routes)||!Array.isArray(core.trips)||!Array.isArray(core.stops))
    throw new Error('Core runtime incompleto');
  resetStaticIndex();
  const buses=[];
  for(const r of core.routes){
    const short=String(r.short||'').trim(),type=String(r.type??'');
    if(!short)continue;
    if(type==='0'||type==='3'){
      addRouteMeta(short,type,r.id);
      if(type==='3')buses.push(short);
    }
  }
  for(const [routeId,ids] of Object.entries(core.routeStops||{})){
    const meta=routeById.get(routeId);if(!meta||!Array.isArray(ids))continue;
    if(!routeStopIds.has(meta.short))routeStopIds.set(meta.short,new Set());
    const set=routeStopIds.get(meta.short);
    for(const id of ids)if(id)set.add(String(id));
  }
  for(const t of core.trips){
    const meta=routeById.get(t.routeId);if(!meta)continue;
    const info={
      tripId:t.id,routeId:t.routeId,routeShort:meta.short,routeType:meta.type,
      directionId:t.directionId===null||t.directionId===undefined?'':String(t.directionId),
      headsign:t.headsign||'',shapeId:t.shapeId||''
    };
    tripInfo.set(t.id,info);
    if(info.shapeId){
      if(!routeShapeIds.has(meta.short))routeShapeIds.set(meta.short,new Set());
      routeShapeIds.get(meta.short).add(info.shapeId);
      ensureShapeUse(meta.short,info.directionId,info.shapeId);
    }
  }
  for(const s of core.stops){
    const lat=Number(s.lat),lon=Number(s.lon);
    if(s.id&&Number.isFinite(lat)&&Number.isFinite(lon))
      stops.set(s.id,{id:s.id,name:s.name||s.id,lat,lon});
  }
  renderBusList([...new Set(buses)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})));
}

async function ensureLegacyZip(){
  if(zipObj)return zipObj;
  if(legacyStaticBlobPromise)return legacyStaticBlobPromise;
  legacyStaticBlobPromise=(async()=>{
    bootMark('staticGtfsStart');
    const staticBlob=await READ.map.staticGtfs();
    bootMark('staticGtfsReady');
    window.UVTransitJourney?.setStatic(staticBlob);
    const JSZipLib=await ensureJSZip();
    zipObj=await JSZipLib.loadAsync(staticBlob);
    bootMark('staticZipReady');
    return zipObj;
  })().catch(err=>{legacyStaticBlobPromise=null;throw err});
  return legacyStaticBlobPromise;
}

async function loadLegacyStaticIndex(){
  const zip=await ensureLegacyZip();
  const [routesText,tripsText,stopsText,stopTimesText]=await Promise.all([
    zip.file('routes.txt').async('string'),
    zip.file('trips.txt').async('string'),
    zip.file('stops.txt').async('string'),
    zip.file('stop_times.txt')?zip.file('stop_times.txt').async('string'):Promise.resolve('')
  ]);
  resetStaticIndex();
  const buses=[];
  for(const r of parseCSV(routesText)){
    const short=(r.route_short_name||'').trim(),type=String(r.route_type||'');
    if(!short)continue;
    if(type==='0'||type==='3'){
      addRouteMeta(short,type,r.route_id);
      if(type==='3')buses.push(short);
    }
  }
  for(const t of parseCSV(tripsText)){
    const meta=routeById.get(t.route_id);if(!meta)continue;
    const info={
      tripId:t.trip_id,routeId:t.route_id,routeShort:meta.short,routeType:meta.type,
      directionId:String(t.direction_id||''),headsign:t.trip_headsign||'',shapeId:t.shape_id||''
    };
    tripInfo.set(t.trip_id,info);
    if(t.shape_id){
      if(!routeShapeIds.has(meta.short))routeShapeIds.set(meta.short,new Set());
      routeShapeIds.get(meta.short).add(t.shape_id);
      ensureShapeUse(meta.short,info.directionId,t.shape_id);
    }
  }
  if(stopTimesText){
    for(const row of parseCSV(stopTimesText)){
      const info=tripInfo.get(row.trip_id);if(!info||!row.stop_id)continue;
      if(!routeStopIds.has(info.routeShort))routeStopIds.set(info.routeShort,new Set());
      routeStopIds.get(info.routeShort).add(row.stop_id);
    }
  }
  for(const st of parseCSV(stopsText)){
    const lat=Number(st.stop_lat),lon=Number(st.stop_lon);
    if(st.stop_id&&Number.isFinite(lat)&&Number.isFinite(lon))
      stops.set(st.stop_id,{id:st.stop_id,name:st.stop_name||st.stop_id,lat,lon});
  }
  renderBusList([...new Set(buses)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})));
}

async function loadStaticIndex(){
  setStatus('warn','Dati rete…');bumpFetch();
  try{
    bootMark('runtimeManifestStart');
    const manifest=await READ.map.runtimeManifest();
    bootMark('runtimeManifestReady');
    const result=await READ.map.runtimeCore('aut',manifest);
    bootMark('runtimeCoreReady');
    runtimeManifest=result.manifest;
    indexRuntimeCore(result.data);
    staticMode='runtime';
    bootMetrics.staticSource='runtime-index';
  }catch(err){
    console.warn('Runtime index non disponibile, uso GTFS legacy.',err);
    bootMetrics.runtimeFallback=String(err?.message||err);
    bootMark('runtimeFallback');
    runtimeManifest=null;
    staticMode='legacy';
    await loadLegacyStaticIndex();
    bootMetrics.staticSource='legacy-gtfs';
  }
  bootMark('staticIndexReady');
}

async function ensureRuntimeShapes(){
  if(runtimeShapesCache)return runtimeShapesCache;
  if(runtimeShapesPromise)return runtimeShapesPromise;
  if(runtimeShapesFailed||!runtimeManifest)throw new Error('Shapes runtime non disponibili');
  runtimeShapesPromise=READ.map.runtimeShapes('aut',runtimeManifest)
    .then(result=>{
      runtimeShapesCache=result.data.shapes||{};
      bootMark('runtimeShapesReady');
      return runtimeShapesCache;
    })
    .catch(err=>{runtimeShapesFailed=true;throw err})
    .finally(()=>{runtimeShapesPromise=null});
  return runtimeShapesPromise;
}

async function ensureShapeRows(){
  if(shapeRowsCache)return shapeRowsCache;
  if(shapeRowsPromise)return shapeRowsPromise;
  shapeRowsPromise=(async()=>{
    const zip=await ensureLegacyZip();
    const file=zip.file('shapes.txt');
    if(!file)throw new Error('shapes.txt non disponibile nel GTFS legacy');
    const text=await file.async('string');
    const rows=parseCSV(text);
    shapeRowsCache=rows;
    bootMark('shapeRowsReady');
    return rows;
  })().finally(()=>{shapeRowsPromise=null});
  return shapeRowsPromise;
}

function rehydrateVehiclesForRoute(short){
  let changed=0;
  for(const v of vehicles.values()){
    if(v.route!==short||!v.shapeId||!v.raw)continue;
    const sh=geometryCache.get(v.shapeId);
    if(!sh)continue;
    const pr=projectToShape(sh,v.raw);
    v.shape=sh;
    if(!pr||pr.distance>SNAP_MAX_M)continue;
    v.stateProgress=pr.progress;
    v.measuredProgress=pr.progress;
    v.fixProgress=pr.progress;
    v.fixTimestamp=v.lastDataTs||v.fixTimestamp;
    v.displayLat=pr.point.lat;
    v.displayLon=pr.point.lon;
    v.bearing=bearingAt(sh,pr.progress);
    changed++;
    if(v.marker)UVTransitVehiclesLayer.update(v,vehicleColor);
  }
  if(changed){
    bootMetrics.rehydratedVehicles=(bootMetrics.rehydratedVehicles||0)+changed;
    bootMark('vehiclesRehydrated');
  }
  return changed;
}

async function ensureRouteGeometry(short){
  if(!short||routeGeometryLoaded.has(short))return;
  const needed=routeShapeIds.get(short);if(!needed||!needed.size)return;

  if(staticMode==='runtime'&&!runtimeShapesFailed){
    try{
      const shapes=await ensureRuntimeShapes();
      let found=0;
      for(const id of needed){
        const src=shapes[id];if(!Array.isArray(src)||src.length<2)continue;
        const pts=src.map((p,i)=>({lat:Number(p[0]),lon:Number(p[1]),seq:i})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
        if(pts.length>1){geometryCache.set(id,prepareShape(pts));found++}
      }
      if(found){routeGeometryLoaded.add(short);rehydrateVehiclesForRoute(short);return}
      console.warn(`Nessuna shape runtime trovata per ${short}; fallback GTFS legacy.`);
    }catch(err){
      console.warn('Shapes runtime non disponibili, fallback GTFS legacy.',err);
      bootMetrics.runtimeShapesFallback=String(err?.message||err);
      bootMark('runtimeShapesFallback');
    }
  }

  const rows=await ensureShapeRows();
  const tmp=new Map();
  for(const row of rows){
    if(!needed.has(row.shape_id))continue;
    if(!tmp.has(row.shape_id))tmp.set(row.shape_id,[]);
    tmp.get(row.shape_id).push({lat:Number(row.shape_pt_lat),lon:Number(row.shape_pt_lon),seq:Number(row.shape_pt_sequence)});
  }
  for(const [id,pts] of tmp)geometryCache.set(id,prepareShape(pts));
  routeGeometryLoaded.add(short);
  rehydrateVehiclesForRoute(short);
}

function activeRouteShorts(){
  const out=[];
  const t=$('tramFilter').value;
  if(t==='ALL')out.push('T1','T2');
  else if(t!=='OFF')out.push(t);
  for(const b of selectedBuses)out.push(b);
  return out;
}

function redrawRoutes(){
  UVTransitRoutesLayer.render({
    map,
    visible:$('layerRoutes').checked && !document.body.classList.contains('uv-water-mode'),
    activeRoutes:activeRouteShorts(),
    routeMeta,
    representativeShapeIds,
    geometryCache,
    simplify,
    routeColor,
    tramTolerance:DISPLAY_SIMPLIFY_TRAM_M,
    busTolerance:DISPLAY_SIMPLIFY_BUS_M
  });
}

window.UVTransitRefreshLandRoutes=redrawRoutes;
window.addEventListener('uv:alerts',()=>{
  redrawRoutes();
  for(const v of vehicles.values()){
    UVTransitVehiclesLayer.update(v,vehicleColor);
    updatePopup(v);
  }
});

function renderBusList(busNames){
  const validSaved=[...selectedBuses].filter(x=>busNames.includes(x)).slice(0,MAX_BUSES);
  selectedBuses=new Set(validSaved);
  const landNames=[...['T1','T2'].filter(name=>routeMeta.has(name)),...busNames];

  UVTransitControls.renderBusList({
    busNames:landNames,
    isSelected:isLandRouteSelected,
    color:routeColor,
    onToggle:async(name,checked)=>{
      if(name==='T1'||name==='T2'){
        const next=selectedTrams();
        if(checked)next.add(name);else next.delete(name);
        setSelectedTrams(next);
      }else if(checked){
        if(selectedBuses.size>=MAX_BUSES){
          $('message').innerHTML=`<strong>Limite raggiunto.</strong> Puoi seguire fino a ${MAX_BUSES} linee bus contemporaneamente.`;
          return false;
        }
        selectedBuses.add(name);
      }else{
        selectedBuses.delete(name);
      }

      ensureActiveBusColors();
      updateBusPickerLabel();
      savePrefs();
      await refreshSelection();
      UVTransitRedesign?.syncSelection?.();
      return true;
    },
    afterRender:updateBusPickerLabel
  });
}

function updateBusSwatches(){
  UVTransitControls.updateSwatches(selectedBuses,routeColor);
}

function updateBusPickerLabel(){
  updateBusSwatches();
  UVTransitControls.updateBusLabel(new Set(activeRouteShorts()));
}

UVTransitControls.bindBusPopover();

function normalizeTU(json){
  window.UVTransitJourney?.setRealtime(json);
  tripUpdates.clear();
  for(const e of (json.entity||json.entities||[])){
    const u=val(e,'tripUpdate','trip_update');if(!u)continue;
    const tr=u.trip||{},tripId=String(val(tr,'tripId','trip_id')||'');
    if(!tripId||!tripInfo.has(tripId))continue;
    const updates=(val(u,'stopTimeUpdate','stop_time_update')||[]).map(x=>{
      const a=x.arrival||{},d=x.departure||{};
      return{
        stopId:String(val(x,'stopId','stop_id')||''),
        seq:Number(val(x,'stopSequence','stop_sequence')||0),
        time:Number(val(a,'time')||val(d,'time')||0),
        delay:Number(val(a,'delay')||val(d,'delay')||0)
      };
    }).filter(x=>x.stopId);
    tripUpdates.set(tripId,{updates,timestamp:Number(val(u,'timestamp')||0)});
  }
  for(const v of vehicles.values()){v.nextStop=findNextStop(v);updatePopup(v)}
  rebuildStops();
  updateNearby();
}

function findNextStop(v){
  const tu=tripUpdates.get(v.tripId);if(!tu)return null;
  const now=Math.floor(Date.now()/1000);
  let u=null;
  if(v.currentStopSequence)u=tu.updates.find(x=>x.seq>=v.currentStopSequence);
  if(!u)u=tu.updates.find(x=>x.time>=now-30);
  if(!u)return null;
  const s=stops.get(u.stopId);
  return s?{...s,time:u.time,delay:u.delay}:{id:u.stopId,name:u.stopId,time:u.time,delay:u.delay,lat:null,lon:null};
}

function rebuildStops(){
  UVTransitStopsLayer.render({
    map,
    visible:$('layerStops').checked,
    tripUpdates,
    tripInfo,
    stops,
    routeStopIds,
    selectedByFilters
  });
}

function vehicleIcon(v){
  return UVTransitVehiclesLayer.icon(v,routeColor);
}

function selectedByFilters(route){
  const meta=routeMeta.get(route);
  if(!meta) return false;

  if(meta.type==='0'){
    const t=$('tramFilter').value;
    return t==='ALL' || t===route;
  }

  return meta.type==='3' && selectedBuses.has(route);
}

function assertRuntimeContracts(){
  const missing=[];
  if(typeof selectedByFilters!=='function') missing.push('selectedByFilters');
  if(!window.UVTransitVehiclesLayer?.create) missing.push('UVTransitVehiclesLayer.create');
  if(!window.UVTransitVehiclesLayer?.update) missing.push('UVTransitVehiclesLayer.update');
  if(!window.UVTransitRoutesLayer?.render) missing.push('UVTransitRoutesLayer.render');
  if(!window.UVTransitStopsLayer?.render) missing.push('UVTransitStopsLayer.render');
  if(!window.UVTransitDiagnostics?.create) missing.push('UVTransitDiagnostics.create');
  if(!window.UVTransitFavorites?.load) missing.push('UVTransitFavorites.load');
  if(missing.length){
    throw new Error('Runtime contract non soddisfatto: '+missing.join(', '));
  }
}

assertRuntimeContracts();

function parseVP(json){
  const list=[];
  for(const e of (json.entity||json.entities||[])){
    const vp=e.vehicle||{},rt=vp.trip||{},pos=vp.position||{};
    const tripId=String(val(rt,'tripId','trip_id')||''),trip=tripInfo.get(tripId);
    const routeId=String(val(rt,'routeId','route_id')||''),route=routeById.get(routeId);
    const info=trip||(
      route?{tripId,routeId,routeShort:route.short,routeType:route.type,directionId:'',headsign:'',shapeId:'',routeOnly:true}:null
    );
    if(!info||!selectedByFilters(info.routeShort))continue;
    const lat=Number(val(pos,'latitude','lat')),lon=Number(val(pos,'longitude','lon','lng'));
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const veh=vp.vehicle||{};
    const feedBearing=Number(val(pos,'bearing'));
    const feedSpeed=Number(val(pos,'speed'));
    list.push({
      id:String(val(veh,'id','label')??e.id??tripId),
      route:info.routeShort,routeType:info.routeType,tripId,
      directionId:info.directionId||'',
      headsign:info.headsign||'',shapeId:info.shapeId||'',
      lat,lon,bearing:Number.isFinite(feedBearing)?feedBearing:null,speed:Number.isFinite(feedSpeed)?feedSpeed:null,
      timestamp:Number(val(vp,'timestamp')||val(json.header||{},'timestamp')||Math.floor(Date.now()/1000)),
      currentStopSequence:Number(val(vp,'currentStopSequence','current_stop_sequence')||0),
      currentStatus:String(val(vp,'currentStatus','current_status')||''),
      stopId:String(val(vp,'stopId','stop_id')||'')
    });
  }
  return list;
}

function assimilate(p){
  const sh=geometryCache.get(p.shapeId);
  const pr=sh?projectToShape(sh,{lat:p.lat,lon:p.lon}):null;
  const snapped=pr&&pr.distance<=SNAP_MAX_M,z=snapped?pr.progress:null;
  const receiveSec=performance.now()/1000;
  let v=vehicles.get(p.id);

  if(!v){
    const initial=snapped?pr.point:{lat:p.lat,lon:p.lon};
    const feedSpeed=Number.isFinite(p.speed)?clamp(p.speed,0,24):0;
    v={
      id:p.id,route:p.route,routeType:p.routeType,tripId:p.tripId,directionId:p.directionId,headsign:p.headsign,
      shapeId:p.shapeId,shape:sh,stateProgress:z,measuredProgress:z,fixProgress:z,fixTimestamp:p.timestamp,
      displayLat:initial.lat,displayLon:initial.lon,
      speed:feedSpeed,targetSpeed:feedSpeed,observedSpeed:feedSpeed,fixIntervalEma:null,lastDataTs:p.timestamp,lastReceiveSec:receiveSec,
      raw:{lat:p.lat,lon:p.lon},lastSeen:Date.now(),
      currentStopSequence:p.currentStopSequence,currentStatus:p.currentStatus,stopId:p.stopId,
      nextStop:null,bearing:snapped?bearingAt(sh,z):p.bearing,marker:null
    };
    v.nextStop=findNextStop(v);
    UVTransitVehiclesLayer.create(map,v,vehicleColor);
    bootMark('firstMarkerRendered');
    vehicles.set(v.id,v);
  }else{
    const changedTrip=v.tripId!==p.tripId||v.shapeId!==p.shapeId;
    const previousTs=Number(v.fixTimestamp??v.lastDataTs??0)||0;

    /* Never let an out-of-order response rewind the vehicle. */
    if(!changedTrip&&previousTs&&p.timestamp<previousTs){
      v.lastSeen=Date.now();
      return;
    }

    if(changedTrip){
      v.tripId=p.tripId;v.shapeId=p.shapeId;v.shape=sh;v.speed=0;v.targetSpeed=0;v.observedSpeed=0;v.fixIntervalEma=null;
      if(z!==null){
        v.stateProgress=z;v.measuredProgress=z;v.fixProgress=z;v.fixTimestamp=p.timestamp;
        v.displayLat=pr.point.lat;v.displayLon=pr.point.lon;v.bearing=bearingAt(sh,z);
      }else{
        v.stateProgress=null;v.measuredProgress=null;v.fixProgress=null;v.bearing=null;
      }
      v.lastDataTs=p.timestamp;
    }else if(z!==null){
      /* Source timestamps, not request cadence, govern the speed estimate. */
      PREDICTION.acceptProgressFix(v,z,p.timestamp);
    }else if(p.timestamp>(v.lastDataTs||0)){
      v.lastDataTs=p.timestamp;
    }

    v.route=p.route;v.routeType=p.routeType;v.directionId=p.directionId;v.headsign=p.headsign;
    v.shape=sh||v.shape;
    if(!v.shape&&p.bearing!==null)v.bearing=p.bearing;
    if(Number.isFinite(p.speed)&&(!v.observedSpeed||v.stateProgress===null)){
      const feedSpeed=clamp(p.speed,0,24);v.observedSpeed=feedSpeed;v.targetSpeed=feedSpeed;if(!v.speed)v.speed=feedSpeed;
    }
    if(sh&&z!==null&&v.stateProgress===null){
      v.stateProgress=z;v.measuredProgress=z;v.fixProgress=z;v.fixTimestamp=p.timestamp;
      v.displayLat=pr.point.lat;v.displayLon=pr.point.lon;v.bearing=bearingAt(sh,z);
    }
    v.lastReceiveSec=receiveSec;
    v.raw={lat:p.lat,lon:p.lon};v.currentStopSequence=p.currentStopSequence;
    v.currentStatus=p.currentStatus;v.stopId=p.stopId;v.nextStop=findNextStop(v);v.lastSeen=Date.now();
  }

  updatePopup(v);updateDiagnostics(v);
}

function physicsLoop(nowPerf){
  const rawDt=Math.max(0,(nowPerf-lastPhysics)/1000);
  lastPhysics=nowPerf;
  const nowEpoch=Date.now()/1000;
  const options={enabled:$('layerPrediction').checked};

  if(rawDt>1.25){
    /* RAF may pause in background. Re-anchor instead of accumulating a visual debt. */
    for(const v of vehicles.values())PREDICTION.reanchorVehicle(v,nowEpoch,options);
  }else{
    const dt=clamp(rawDt,.001,1);
    for(const v of vehicles.values())PREDICTION.stepVehicle(v,nowEpoch,dt,options);
  }

  if(nowPerf-lastMapRender>=MAP_RENDER_MS){
    lastMapRender=nowPerf;
    for(const v of vehicles.values()){
      UVTransitVehiclesLayer.update(v,vehicleColor);
      if($('debugMaster').checked&&$('layerGPS').checked)updateDiagnostics(v);
    }
  }
  requestAnimationFrame(physicsLoop);
}

function updateDiagnostics(v){
  diagnostics.update(v,$('debugMaster').checked&&$('layerGPS').checked);
}

function updatePopup(v){
  UVTransitVehiclesLayer.updatePopup(v,{
    routeColor,
    showNext:$('layerNext').checked,
    debug:$('debugMaster').checked
  });
}

function cleanup(seen){
  for(const [id,v] of vehicles){
    if(!seen.has(id)&&Date.now()-v.lastSeen>30000){
      UVTransitVehiclesLayer.remove(map,v);vehicles.delete(id);
      diagnostics.remove(id);
    }
  }
}

async function fetchVP(){
  bumpFetch();
  const json=await READ.map.vehiclePositions();
  bootMark('firstVehiclePositions');

  previousHeaderTs=lastHeaderTs;lastHeaderTs=Number(val(json.header||{},'timestamp')||0);
  $('feedDelta').textContent=previousHeaderTs&&lastHeaderTs>previousHeaderTs
    ?((lastHeaderTs-previousHeaderTs).toFixed(1)+'s'):'—';
  refreshFreshnessUI();

  const list=parseVP(json),seen=new Set();
  for(const p of list){seen.add(p.id);assimilate(p)}
  cleanup(seen);

  $('tramCount').textContent=list.filter(x=>x.routeType==='0').length;
  $('busCount').textContent=list.filter(x=>x.routeType==='3').length;
  setStatus('live','LIVE');

  const busText=selectedBuses.size?` Bus seguiti: ${[...selectedBuses].join(', ')}.`:'';
  $('message').innerHTML=
    `<strong>${list.length} mezzi visualizzati.</strong>${busText} Le tue selezioni vengono salvate localmente.`;
  updateNearby();
}

async function fetchTU(){
  bumpFetch();
  const json=await READ.map.tripUpdates();
  bootMark('firstTripUpdates');
  normalizeTU(json);
}

function debounce(type){
  const k='__d_'+type;clearTimeout(window[k]);
  window[k]=setTimeout(()=>{
    if(type==='vehicle_positions')fetchVP().catch(handleError);
    if(type==='trip_updates')fetchTU().catch(handleError);
  },150);
}
function connectWS(){
  ws=READ.map.subscribe(msg=>{
    try{
      if(msg.type==='vehicle_positions')debounce('vehicle_positions');
      if(msg.type==='trip_updates')debounce('trip_updates');
    }catch(_){}
  },{
    onOpen:()=>{
      $('networkMode').textContent='WS';
      if(fallbackTimer){clearInterval(fallbackTimer);fallbackTimer=null}
      if(window.UVTransitNotifications){
        UVTransitNotifications.setService({
          level:'success',
          title:'Realtime collegato',
          message:'Connessione live attiva. Controllo la freschezza dei dati ACTV.',
          visible:true
        });
      }
    },
    onClose:()=>{
      $('networkMode').textContent='10s';
      if(window.UVTransitNotifications){
        UVTransitNotifications.setService({
          level:'warning',
          title:'Connessione live interrotta',
          message:'Gli aggiornamenti proseguono ogni 10 secondi. Provo a ristabilire la connessione.',
          visible:true
        });
      }
      startFallback();
      setTimeout(connectWS,12000);
    },
    onError:()=>{}
  });

  if(!ws) startFallback();
}
function startFallback(){
  if(fallbackTimer)return;
  $('networkMode').textContent='10s';
  fallbackTimer=setInterval(()=>{
    fetchVP().catch(handleError);fetchTU().catch(handleError)
  },FALLBACK_POLL_MS);
}
function handleError(e){
  console.error(e);setStatus('bad','Errore feed');
  $('message').innerHTML=`<strong>Errore:</strong> ${esc(e.message||e)}`;
  UVTransitNotifications.setService({level:'error',title:'Dati non disponibili',message:'Non riesco ad aggiornare i trasporti. Nuovo tentativo automatico in corso.',visible:true});
}

async function refreshSelection(){
  setStatus('warn','Carico selezione…');
  await Promise.all(activeRouteShorts().map(ensureRouteGeometry));
  redrawRoutes();
  rebuildStops();

  for(const v of vehicles.values())UVTransitVehiclesLayer.remove(map,v);
  vehicles.clear();
  diagnostics.clear();

  await fetchVP();
  setStatus('live','LIVE');
}

function userIcon(){const icon=$('locateHero')?.querySelector('svg')?.outerHTML;return L.divIcon({className:'user-person-marker',iconSize:[38,38],iconAnchor:[19,19],html:icon?'<div class="user-person">'+icon+'</div>':'<div class="user-dot"></div>'})}
function startGeolocation(){
  if(!navigator.geolocation){UVTransitRedesign.locationState('error','La posizione non è supportata da questo browser.');return;}
  if(geoWatch!==null){
    navigator.geolocation.clearWatch(geoWatch);geoWatch=null;userPos=null;didInitialGpsZoom=false;
    if(userMarker){map.removeLayer(userMarker);userMarker=null}
    $('locateBtn').classList.remove('active');$('locateBtn').textContent='La mia posizione';
    UVTransitNearbyPanel.hide();UVTransitRedesign.locationState('off');return;
  }

  UVTransitRedesign.locationState('loading');
  geoWatch=navigator.geolocation.watchPosition(p=>{
    userPos={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};
    window.dispatchEvent(new CustomEvent('uv:position',{detail:userPos}));
    if(!userMarker)userMarker=L.marker([userPos.lat,userPos.lon],{icon:userIcon(),zIndexOffset:1000}).addTo(map);
    else userMarker.setLatLng([userPos.lat,userPos.lon]);

    $('locateBtn').classList.add('active');UVTransitRedesign.locationState('active');

    if(!$('layerUser').checked&&map.hasLayer(userMarker))map.removeLayer(userMarker);
    if($('layerUser').checked&&!map.hasLayer(userMarker))userMarker.addTo(map);

    if(!didInitialGpsZoom){
      map.setView([userPos.lat,userPos.lon],15,{animate:true});
      didInitialGpsZoom=true;
    }
    updateNearby();
  },e=>{
    $('message').innerHTML=`<strong>GPS non disponibile:</strong> ${esc(e.message)}`;
    if(geoWatch!==null)navigator.geolocation.clearWatch(geoWatch);geoWatch=null;userPos=null;if(userMarker){map.removeLayer(userMarker);userMarker=null;}
    UVTransitRedesign.locationState('error',e.code===1?'Accesso alla posizione negato. Puoi abilitarlo nelle impostazioni del browser.':'Posizione non disponibile. Riprova.');
  },{enableHighAccuracy:false,maximumAge:15000,timeout:10000});
}

function updateNearby(){
  if(!userPos){
    nearbyState=null;
    UVTransitNearbyPanel.hide();
    return;
  }

  const now=Math.floor(Date.now()/1000);
  const candidates=new Map();

  /* L'anagrafica statica decide quali paline esistono. Il realtime aggiunge
     gli arrivi, ma la sua assenza non deve far sparire una fermata valida. */
  for(const [route,ids] of routeStopIds){
    if(!selectedByFilters(route))continue;
    for(const id of ids){
      const stop=stops.get(id);if(!stop)continue;
      candidates.set(id,{stop,distance:distanceM(userPos,stop),arrivals:[]});
    }
  }

  /* Sovrapponi gli arrivi realtime alle paline statiche selezionate. */
  for(const [tripId,tu] of tripUpdates){
    const info=tripInfo.get(tripId);
    if(!info||!selectedByFilters(info.routeShort))continue;

    for(const u of tu.updates){
      const stop=stops.get(u.stopId);
      if(!stop)continue;
      const d=distanceM(userPos,stop);
      if(!candidates.has(stop.id)) candidates.set(stop.id,{stop,distance:d,arrivals:[]});
      candidates.get(stop.id).arrivals.push({
        route:info.routeShort,
        headsign:info.headsign||'',
        directionId:info.directionId||'',
        time:u.time,
        delay:u.delay||0,
        tripId
      });
    }
  }

  if(!candidates.size){
    nearbyState=null;
    UVTransitNearbyPanel.renderEmpty(
      'Nessuna fermata disponibile',
      'per le linee selezionate',
      'Prova a selezionare altre linee.'
    );
    return;
  }

  const nearest=[...candidates.values()].sort((a,b)=>a.distance-b.distance)[0];

  /* Le paline opposte spesso hanno stop_id distinti ma stesso nome / sono molto vicine.
     Le uniamo logicamente per mostrare entrambe le direzioni. */
  const cluster=[];
  for(const c of candidates.values()){
    if(c.stop.name===nearest.stop.name || distanceM(c.stop,nearest.stop)<=65) cluster.push(c);
  }

  const arrivals=[];
  for(const c of cluster){
    for(const a of c.arrivals){
      if(!a.time || a.time>=now-30) arrivals.push({...a,stop:c.stop});
    }
  }

  /* Dedupe conservativo: stessa linea/destinazione/orario può comparire su paline quasi coincidenti. */
  const dedupe=new Map();
  for(const a of arrivals){
    const key=[a.route,a.headsign,a.time].join('|');
    if(!dedupe.has(key)) dedupe.set(key,a);
  }
  const next=[...dedupe.values()].sort((a,b)=>(a.time||Infinity)-(b.time||Infinity)).slice(0,5);

  nearbyState={
    stop:nearest.stop,
    distance:nearest.distance,
    clusterStops:cluster.map(c=>c.stop),
    arrivals:next
  };

  UVTransitNearbyPanel.render(nearbyState,routeColor);
}

function centerNearbyStop(){
  if(!nearbyState)return;
  const stop=nearbyState.stop;
  const pts=[[stop.lat,stop.lon]];
  if(userPos)pts.push([userPos.lat,userPos.lon]);

  /* Includi solo i mezzi che stanno servendo questa fermata e sono entro 2,5 km,
     così il viewport resta leggibile. */
  const relevantTrips=new Set(nearbyState.arrivals.map(a=>a.tripId));
  for(const v of vehicles.values()){
    if(relevantTrips.has(v.tripId) && distanceM(stop,{lat:v.displayLat,lon:v.displayLon})<2500){
      pts.push([v.displayLat,v.displayLon]);
    }
  }

  if(pts.length>1) map.fitBounds(L.latLngBounds(pts).pad(.22),{maxZoom:16,animate:true});
  else map.setView([stop.lat,stop.lon],16,{animate:true});
}

function fitAll(){
  if(userPos){
    const pts=[[userPos.lat,userPos.lon]];
    for(const v of vehicles.values()){
      if(distanceM(userPos,{lat:v.displayLat,lon:v.displayLon})<2500)pts.push([v.displayLat,v.displayLon]);
    }
    if(pts.length>1)map.fitBounds(L.latLngBounds(pts).pad(.16),{maxZoom:14,animate:true});
    else map.setView([userPos.lat,userPos.lon],15,{animate:true});
    return;
  }
  const pts=[...vehicles.values()].map(v=>[v.displayLat,v.displayLon]);
  if(pts.length)map.fitBounds(L.latLngBounds(pts).pad(.18),{maxZoom:14,animate:true});
}

function onLayerChange(){
  savePrefs();
  redrawRoutes();
  rebuildStops();

  for(const v of vehicles.values()){
    updatePopup(v);updateDiagnostics(v)
  }
  if(userMarker){
    if($('layerUser').checked&&!map.hasLayer(userMarker))userMarker.addTo(map);
    if(!$('layerUser').checked&&map.hasLayer(userMarker))map.removeLayer(userMarker);
  }
}

$('tramFilter').addEventListener('change',async()=>{savePrefs();UVTransitControls.syncLinePicker?.();try{await refreshSelection()}catch(e){handleError(e)}UVTransitRedesign.syncSelection()});
$('locateBtn').addEventListener('click',startGeolocation);
$('nearbyCenterBtn').addEventListener('click',centerNearbyStop);

for(const id of ['layerRoutes','layerStops','layerNext','layerUser','layerPrediction','layerGPS']){
  $(id).addEventListener('change',onLayerChange);
}
$('debugMaster').addEventListener('change',()=>{
  $('debugWrap').classList.toggle('open',$('debugMaster').checked);
  savePrefs();
  if(!$('debugMaster').checked){
    for(const v of vehicles.values())updateDiagnostics(v);
  }
});


function initNotificationUI(){
  return window.UVTransitUI ? UVTransitUI.initNotificationUI() : null;
}

// v8.5.2: read-only data access plus existing selection commands for the presentation controller.
UVTransitRedesign.init({map,color:routeColor,active:activeRouteShorts,
  locating:()=>geoWatch!==null,vehicle:id=>vehicles.get(id),stop:id=>stops.get(id),
  diagnostics:()=>({vehicleCount:vehicles.size,lastFeedTimestamp:lastHeaderTs,networkMode:$('networkMode')?.textContent||'—'}),
  arrivals:id=>{const now=Date.now()/1000,out=[];for(const [tripId,tu] of tripUpdates){const info=tripInfo.get(tripId);if(!info||!selectedByFilters(info.routeShort))continue;for(const u of tu.updates)if(u.stopId===id&&(!u.time||u.time>=now-30))out.push({...u,route:info.routeShort,headsign:info.headsign,stop:stops.get(id)})}return out.sort((a,b)=>(a.time||Infinity)-(b.time||Infinity)).slice(0,5)},
  selectRoute:async route=>{if(!routeMeta.has(route))throw new Error('Linea non disponibile nei dati attuali');if(route==='T1'||route==='T2'){$('tramFilter').value=route;UVTransitControls.syncLinePicker?.();savePrefs();await refreshSelection();UVTransitRedesign.syncSelection()}else{const cb=[...document.querySelectorAll('#busList input')].find(x=>x.value===route);if(!cb)throw new Error('Linea non disponibile');if(!cb.checked){if(selectedBuses.size>=MAX_BUSES)throw new Error('Puoi selezionare fino a 8 linee bus. Rimuovine una dal pannello Linee.');selectedBuses.add(route);cb.checked=true;ensureActiveBusColors();updateBusPickerLabel();savePrefs();await refreshSelection();UVTransitRedesign.syncSelection()}}}
});

initNotificationUI();
bootMark('uiReady');
setInterval(refreshFreshnessUI,5000);

(async()=>{
  applyPrefsToUI();
  try{
    await loadStaticIndex();
    /* Dopo il caricamento delle linee, scarta eventuali preferenze bus non più valide. */
    selectedBuses=new Set([...selectedBuses].filter(b=>routeMeta.has(b)&&routeMeta.get(b).type==='3').slice(0,MAX_BUSES));
    ensureActiveBusColors();
    updateBusPickerLabel();savePrefs();UVTransitRedesign.syncSelection();

    /* v8.8 step 2: geometry preparation no longer blocks the first realtime request.
       The shared shapes promise also prevents concurrent T1/T2 parsing of shapes.txt. */
    const geometryReady=Promise.all(activeRouteShorts().map(ensureRouteGeometry))
      .then(()=>{
        redrawRoutes();
        bootMark('geometryReady');
      })
      .catch(e=>{
        console.error('Errore caricamento geometrie',e);
      });

    await Promise.all([fetchTU(),fetchVP()]);
    bootMark('realtimeReady');
    connectWS();
    requestAnimationFrame(physicsLoop);
    bootMark('bootstrapReady');
    setTimeout(fitAll,700);

    /* Keep the non-blocking task observed so a rejected geometry promise is never unhandled. */
    void geometryReady;
  }catch(e){
    handleError(e);startFallback();requestAnimationFrame(physicsLoop);
  }
})();
})();
