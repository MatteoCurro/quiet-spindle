/* M10.3B — Supabase remote store. Does not auto-sync or expose the raw client. */
(function(g){'use strict';
function err(code,cause){const e=new Error(code);e.code=code;if(cause)e.cause=cause;return e}
function cleanError(error){
 const message=String(error?.message||'');
 const known=['SYNC_DISABLED','SYNC_SIGNIN_REQUIRED','SYNC_INPUT_INVALID','SYNC_NOTICE_REQUIRED','SYNC_REVISION_CONFLICT','SYNC_RESOURCE_DELETED','SYNC_RESOURCE_MISSING','SYNC_OPERATION_REUSED'];
 const code=known.find(x=>message.includes(x));return err(code||'ACCOUNT_SYNC_UNAVAILABLE',error);
}
function one(data){return Array.isArray(data)?(data[0]||null):(data||null)}
function create(options={}){
 const getClient=options.getClient,getUserId=options.getUserId;
 if(typeof getClient!=='function'||typeof getUserId!=='function')throw new TypeError('Supabase sync store requires client and user accessors');
 async function ready(){await getUserId();return getClient()}
 async function table(c,name,fields){const r=await c.from(name).select(fields);if(r.error)throw cleanError(r.error);return Array.isArray(r.data)?r.data:[]}
 async function pull(){
  const c=await ready();
  const [settings,preferences,savedRoutes,savedStops,savedPlaces,savedJourneys,tombs]=await Promise.all([
   table(c,'account_settings','sync_enabled,revision,updated_at'),
   table(c,'account_preferences','language,revision,updated_at'),
   table(c,'saved_routes','id,provider_id,route_id,revision,updated_at'),
   table(c,'saved_stops','id,provider_id,stop_id,revision,updated_at'),
   table(c,'saved_places','id,label,lat,lon,entity_id,role,revision,updated_at'),
   table(c,'saved_journeys','id,label,network,origin_label,origin_lat,origin_lon,origin_kind,origin_ids,destination_label,destination_lat,destination_lon,destination_kind,destination_ids,revision,updated_at'),
   tombstones(null)
  ]);
  return Object.freeze({syncEnabled:settings[0]?.sync_enabled===true,settings:settings[0]||null,preferences:preferences[0]||null,savedRoutes,savedStops,savedPlaces,savedJourneys,tombstones:tombs});
 }
 async function rpc(name,args){
  const c=await ready(),r=await c.rpc(name,args);if(r.error)throw cleanError(r.error);return one(r.data);
 }
 function meta(meta){
  const operationId=String(meta.operationId||''),expectedRevision=Number(meta.expectedRevision);
  if(!operationId||!Number.isInteger(expectedRevision)||expectedRevision<0)throw err('SYNC_INPUT_INVALID');
  return {operationId,expectedRevision};
 }
 async function write(type,payload,info={}){
  const m=meta(info),base={p_operation_id:m.operationId,p_expected_revision:m.expectedRevision,p_id:payload.id};
  switch(type){
   case 'preferences': return rpc('sync_account_preferences',{p_operation_id:m.operationId,p_expected_revision:m.expectedRevision,p_language:payload.language??null});
   case 'saved_route': return rpc('sync_saved_route',{...base,p_provider_id:payload.provider_id,p_route_id:payload.route_id});
   case 'saved_stop': return rpc('sync_saved_stop',{...base,p_provider_id:payload.provider_id,p_stop_id:payload.stop_id});
   case 'saved_place': return rpc('sync_saved_place',{...base,p_label:payload.label,p_lat:payload.lat,p_lon:payload.lon,p_entity_id:payload.entity_id??null,p_role:payload.role||'both'});
   case 'saved_journey': return rpc('sync_saved_journey',{...base,
    p_label:payload.label,p_network:payload.network,
    p_origin_label:payload.origin_label,p_origin_lat:payload.origin_lat,p_origin_lon:payload.origin_lon,p_origin_kind:payload.origin_kind,p_origin_ids:payload.origin_ids||[],
    p_destination_label:payload.destination_label,p_destination_lat:payload.destination_lat,p_destination_lon:payload.destination_lon,p_destination_kind:payload.destination_kind,p_destination_ids:payload.destination_ids||[]
   });
   default: throw err('SYNC_INPUT_INVALID');
  }
 }
 async function remove(type,id,info={}){
  const m=meta(info),map={saved_route:'saved_route',saved_stop:'saved_stop',saved_place:'saved_place',saved_journey:'saved_journey'};
  if(!map[type]||!id)throw err('SYNC_INPUT_INVALID');
  return rpc('sync_delete_saved',{p_operation_id:m.operationId,p_resource_type:map[type],p_id:id,p_expected_revision:m.expectedRevision});
 }
 async function tombstones(since=null){
  const c=await ready(),r=await c.rpc('account_sync_tombstones',{p_since:since||null});if(r.error)throw cleanError(r.error);return Array.isArray(r.data)?r.data:[];
 }
 async function configure(enabled,noticeVersion,info={}){
  const m=meta(info);
  return rpc('set_account_sync',{p_operation_id:m.operationId,p_expected_revision:m.expectedRevision,p_enabled:!!enabled,p_notice_version:noticeVersion||null});
 }
 return Object.freeze({kind:'supabase',pull,write,remove,tombstones,configure});
}
g.UVSupabaseSyncStore=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
