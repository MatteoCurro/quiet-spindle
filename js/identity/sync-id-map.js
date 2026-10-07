/* M10.3B — local-only mapping between legacy profile IDs and remote UUIDs. */
(function(g){'use strict';
const VERSION=1,BASE_KEY='uv.profile.remote-id-map.v1';
const TYPES=new Set(['saved_route','saved_stop','saved_place','saved_journey']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function freeze(x){return Object.freeze(x)}
function uuidV4(cryptoApi){
 if(cryptoApi?.randomUUID)return cryptoApi.randomUUID();
 if(!cryptoApi?.getRandomValues)throw new Error('SYNC_UUID_UNAVAILABLE');
 const b=new Uint8Array(16);cryptoApi.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function scopeTag(value){
 const s=String(value||'');let h=1469598103934665603n;
 for(let i=0;i<s.length;i++){h^=BigInt(s.charCodeAt(i));h=BigInt.asUintN(64,h*1099511628211n)}
 return h.toString(16).padStart(16,'0');
}
function create(options={}){
 const storage=options.storage||g.UVIdentityStores?.defaults?.().adapter;
 const scope=String(options.scope||'default').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'default';
 const KEY=BASE_KEY+'.'+scope;
 const cryptoApi=options.crypto||g.crypto;
 const makeUuid=typeof options.uuid==='function'?options.uuid:()=>uuidV4(cryptoApi);
 if(!storage||typeof storage.read!=='function'||typeof storage.write!=='function')throw new TypeError('Sync ID map requires storage');
 function load(){
  const raw=storage.read(KEY,{version:VERSION,entries:{}});
  const entries=raw&&raw.version===VERSION&&raw.entries&&typeof raw.entries==='object'?raw.entries:{};
  return {version:VERSION,entries};
 }
 function save(state){storage.write(KEY,state);return state}
 function bucket(state,type){return state.entries[type]&&typeof state.entries[type]==='object'?state.entries[type]:(state.entries[type]={})}
 function assertType(type){if(!TYPES.has(type))throw new TypeError('Invalid sync resource type')}
 function localKey(value){const v=String(value??'').trim();if(!v)throw new TypeError('Missing local sync ID');return v}
 function getOrCreate(type,localId){
  assertType(type);const key=localKey(localId);
  if(UUID.test(key)&&(type==='saved_place'||type==='saved_journey'))return key.toLowerCase();
  const state=load(),map=bucket(state,type);
  if(map[key]&&UUID.test(map[key]))return String(map[key]).toLowerCase();
  const remote=String(makeUuid()).toLowerCase();if(!UUID.test(remote))throw new Error('SYNC_UUID_INVALID');
  if(Object.values(map).some(x=>String(x).toLowerCase()===remote))throw new Error('SYNC_UUID_COLLISION');
  map[key]=remote;save(state);return remote;
 }
 function adopt(type,localId,remoteId){
  assertType(type);const key=localKey(localId),remote=String(remoteId||'').toLowerCase();
  if(!UUID.test(remote))throw new TypeError('Invalid remote UUID');
  const state=load(),map=bucket(state,type),current=map[key];
  if(current&&String(current).toLowerCase()!==remote)throw new Error('SYNC_ID_MAP_CONFLICT');
  const owner=Object.entries(map).find(([k,v])=>k!==key&&String(v).toLowerCase()===remote);
  if(owner)throw new Error('SYNC_ID_MAP_REMOTE_CONFLICT');
  map[key]=remote;save(state);return remote;
 }
 function rebind(type,localId,currentRemoteId,nextRemoteId){
  assertType(type);const key=localKey(localId),current=String(currentRemoteId||'').toLowerCase(),next=String(nextRemoteId||'').toLowerCase();
  if(!UUID.test(current)||!UUID.test(next))throw new TypeError('Invalid remote UUID');
  const state=load(),map=bucket(state,type);
  if(String(map[key]||'').toLowerCase()!==current)throw new Error('SYNC_ID_MAP_STALE');
  const owner=Object.entries(map).find(([k,v])=>k!==key&&String(v).toLowerCase()===next);
  if(owner)throw new Error('SYNC_ID_MAP_REMOTE_CONFLICT');
  map[key]=next;save(state);return next;
 }
 function remoteFor(type,localId){assertType(type);const key=localKey(localId);if(UUID.test(key)&&(type==='saved_place'||type==='saved_journey'))return key.toLowerCase();const v=load().entries[type]?.[key];return UUID.test(String(v||''))?String(v).toLowerCase():null}
 function localFor(type,remoteId){
  assertType(type);const remote=String(remoteId||'').toLowerCase();if(!UUID.test(remote))return null;
  const pair=Object.entries(load().entries[type]||{}).find(([,v])=>String(v).toLowerCase()===remote);
  return pair?pair[0]:null;
 }
 function clear(){storage.remove?.(KEY);return true}
 return freeze({KEY,getOrCreate,adopt,rebind,remoteFor,localFor,clear});
}
g.UVSyncIdMap=freeze({VERSION,BASE_KEY,scopeTag,create});
})(typeof window!=='undefined'?window:globalThis);
