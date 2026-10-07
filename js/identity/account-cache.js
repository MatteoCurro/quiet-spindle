/* M10.3E — manifest for ephemeral account-owned saved cache.
   Stores identifiers only. Account cache is purged on reload/logout; legacy local saves survive. */
(function(g){'use strict';
const VERSION=1,KEY='uv.account.saved-cache.v1';
function freeze(x){return Object.freeze(x)}
function create(options={}){
 const stores=options.stores||g.UVIdentityStores?.defaults?.();
 const storage=options.storage||stores?.adapter;
 if(!stores||!storage)throw new TypeError('Account cache dependencies missing');
 function empty(){return {version:VERSION,routes:[],stops:[],places:[],journeys:[]}}
 function load(){
  const raw=storage.read(KEY,null);
  if(!raw||raw.version!==VERSION)return empty();
  return {
   version:VERSION,
   routes:[...new Set(Array.isArray(raw.routes)?raw.routes.map(String):[])],
   stops:[...new Set(Array.isArray(raw.stops)?raw.stops.map(String):[])],
   places:[...new Set(Array.isArray(raw.places)?raw.places.map(String):[])],
   journeys:[...new Set(Array.isArray(raw.journeys)?raw.journeys.map(String):[])]
  };
 }
 function save(m){storage.write(KEY,m);return m}
 function identity(type,row){
  if(type==='saved_route')return String(typeof row==='string'?row:row?.route_id||'');
  if(type==='saved_stop')return String(typeof row==='string'?row:row?.stop_id||'');
  return String(typeof row==='string'?row:row?.id||'');
 }
 function key(type){return {saved_route:'routes',saved_stop:'stops',saved_place:'places',saved_journey:'journeys'}[type]||null}
 function add(type,row){
  const k=key(type),id=identity(type,row);if(!k||!id)return false;
  const m=load();if(!m[k].includes(id))m[k].push(id);save(m);return true;
 }
 function remove(type,row){
  const k=key(type),id=identity(type,row);if(!k||!id)return false;
  const m=load();m[k]=m[k].filter(x=>x!==id);save(m);return true;
 }
 function replace(profile={}){
  save({
   version:VERSION,
   routes:[...new Set((profile.savedRoutes||[]).map(String))],
   stops:[...new Set((profile.savedStops||[]).map(String))],
   places:[...new Set((profile.savedPlaces||[]).map(x=>String(x?.id||'')).filter(Boolean))],
   journeys:[...new Set((profile.savedJourneys||[]).map(x=>String(x?.id||'')).filter(Boolean))]
  });
  return load();
 }
 function purge(){
  const m=load();
  if(m.routes.length)stores.savedRoutes.save(stores.savedRoutes.load().filter(x=>!m.routes.includes(String(x))));
  if(m.stops.length)stores.savedStops.save(stores.savedStops.load().filter(x=>!m.stops.includes(String(x))));
  if(m.places.length)stores.savedPlaces.save((stores.savedPlaces.load([])||[]).filter(x=>!m.places.includes(String(x?.id||''))));
  if(m.journeys.length)stores.savedJourneys.save((stores.savedJourneys.load([])||[]).filter(x=>!m.journeys.includes(String(x?.id||''))));
  storage.remove(KEY);
  return m;
 }
 return freeze({KEY,load,add,remove,replace,purge,clear:()=>storage.remove(KEY)});
}
let defaultCache=null;
function defaults(){if(defaultCache)return defaultCache;defaultCache=create();return defaultCache}
g.UVAccountCache=freeze({VERSION,KEY,create,defaults});
if(typeof document!=='undefined'){try{defaults().purge()}catch(_){}}
})(typeof window!=='undefined'?window:globalThis);
