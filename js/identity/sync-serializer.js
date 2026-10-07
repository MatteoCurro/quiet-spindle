/* M10.3B — explicit allowlist serializer for account sync. No network I/O. */
(function(g){'use strict';
const VERSION=1,NETWORKS=new Set(['aut','nav','all']),ROLES=new Set(['origin','destination','both']);
function freeze(x){return Object.freeze(x)}
function text(v,max,required=true){const s=typeof v==='string'?v.trim():'';if(!s)return required?null:null;return s.slice(0,max)}
function coord(v,min,max){const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
function uniqueIds(values){return [...new Set((Array.isArray(values)?values:[]).map(String).map(x=>x.trim()).filter(Boolean))].slice(0,50)}
function endpoint(p){
 if(!p||typeof p!=='object')return null;
 const label=text(p.name,300);const lat=coord(p.lat,-90,90),lon=coord(p.lon,-180,180);
 if(!label||lat===null||lon===null)return null;
 if(p.place===true)return {label,lat,lon,kind:'place',ids:[]};
 const ids=uniqueIds(p.ids||[p.id]);if(!ids.length)return null;
 return {label,lat,lon,kind:'stop',ids};
}
function create(options={}){
 const idMap=options.idMap||g.UVSyncIdMap?.create?.();
 const providerId=text(options.providerId||'actv',80);
 if(!idMap||!providerId)throw new Error('Sync serializer unavailable');
 function serialize(snapshot,extra={}){
  if(!snapshot||snapshot.schemaVersion!==1||!snapshot.profile||typeof snapshot.profile!=='object')throw new TypeError('Invalid profile snapshot');
  const p=snapshot.profile,out={schemaVersion:VERSION,savedRoutes:[],savedStops:[],savedPlaces:[],savedJourneys:[],preferences:null};
  for(const raw of Array.isArray(p.savedRoutes)?p.savedRoutes:[]){
   const routeId=text(String(raw),200);if(!routeId)continue;
   const localId=providerId+'|'+routeId;
   out.savedRoutes.push({id:idMap.getOrCreate('saved_route',localId),provider_id:providerId,route_id:routeId});
  }
  for(const raw of Array.isArray(p.savedStops)?p.savedStops:[]){
   const stopId=text(String(raw),200);if(!stopId)continue;
   const localId=providerId+'|'+stopId;
   out.savedStops.push({id:idMap.getOrCreate('saved_stop',localId),provider_id:providerId,stop_id:stopId});
  }
  for(const row of Array.isArray(p.savedPlaces)?p.savedPlaces:[]){
   const label=text(row?.name,120),lat=coord(row?.point?.lat,-90,90),lon=coord(row?.point?.lon,-180,180);
   const localId=text(String(row?.id||''),300);if(!label||lat===null||lon===null||!localId)continue;
   const role=ROLES.has(row?.role)?row.role:'both';
   out.savedPlaces.push({id:idMap.getOrCreate('saved_place',localId),label,lat,lon,entity_id:null,role});
  }
  for(const row of Array.isArray(p.savedJourneys)?p.savedJourneys:[]){
   const localId=text(String(row?.id||''),1000),origin=endpoint(row?.origin),destination=endpoint(row?.destination);
   const network=NETWORKS.has(row?.network)?row.network:null;if(!localId||!origin||!destination||!network)continue;
   const label=(origin.label+' → '+destination.label).slice(0,120);
   out.savedJourneys.push({
    id:idMap.getOrCreate('saved_journey',localId),label,network,
    origin_label:origin.label,origin_lat:origin.lat,origin_lon:origin.lon,origin_kind:origin.kind,origin_ids:origin.ids,
    destination_label:destination.label,destination_lat:destination.lat,destination_lon:destination.lon,destination_kind:destination.kind,destination_ids:destination.ids
   });
  }
  const lang=String(extra.language||'').toLowerCase();
  if(['it','en','fr','de'].includes(lang))out.preferences={language:lang};
  return freeze(out);
 }
 function deserialize(remote={}){
  const profile={savedRoutes:[],savedStops:[],savedPlaces:[],savedJourneys:[]};
  for(const row of Array.isArray(remote.savedRoutes)?remote.savedRoutes:[]){
   if(row?.provider_id===providerId&&text(row?.route_id,200)){
    const routeId=String(row.route_id);profile.savedRoutes.push(routeId);
    if(row.id)try{idMap.adopt('saved_route',providerId+'|'+routeId,String(row.id))}catch(_){}
   }
  }
  for(const row of Array.isArray(remote.savedStops)?remote.savedStops:[]){
   if(row?.provider_id===providerId&&text(row?.stop_id,200)){
    const stopId=String(row.stop_id);profile.savedStops.push(stopId);
    if(row.id)try{idMap.adopt('saved_stop',providerId+'|'+stopId,String(row.id))}catch(_){}
   }
  }
  for(const row of Array.isArray(remote.savedPlaces)?remote.savedPlaces:[]){
   const id=String(row?.id||''),label=text(row?.label,120),lat=coord(row?.lat,-90,90),lon=coord(row?.lon,-180,180);
   if(!id||!label||lat===null||lon===null)continue;
   const local=idMap.localFor('saved_place',id)||id;
   profile.savedPlaces.push({id:local,name:label,point:{name:label,lat,lon,place:true},role:ROLES.has(row?.role)?row.role:'both'});
  }
  for(const row of Array.isArray(remote.savedJourneys)?remote.savedJourneys:[]){
   const id=String(row?.id||''),network=NETWORKS.has(row?.network)?row.network:null;
   const o={name:text(row?.origin_label,300),lat:coord(row?.origin_lat,-90,90),lon:coord(row?.origin_lon,-180,180)};
   const d={name:text(row?.destination_label,300),lat:coord(row?.destination_lat,-90,90),lon:coord(row?.destination_lon,-180,180)};
   if(!id||!network||!o.name||o.lat===null||o.lon===null||!d.name||d.lat===null||d.lon===null)continue;
   function localPoint(base,kind,idsRaw){
    if(kind==='place')return {...base,place:true};
    const ids=uniqueIds(idsRaw);if(!ids.length)return null;return {...base,id:ids[0],ids,network,members:[]};
   }
   const origin=localPoint(o,row.origin_kind,row.origin_ids),destination=localPoint(d,row.destination_kind,row.destination_ids);
   if(!origin||!destination)continue;
   const local=idMap.localFor('saved_journey',id)||id;
   profile.savedJourneys.push({id:local,network,origin,destination,savedAt:Date.parse(row.updated_at)||Date.now()});
  }
  return freeze({schemaVersion:1,generatedAt:Date.now(),profile});
 }
 return freeze({VERSION,serialize,deserialize});
}
g.UVAccountSyncSerializer=freeze({VERSION,create});
})(typeof window!=='undefined'?window:globalThis);
