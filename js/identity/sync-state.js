/* M10.3C — account-scoped local sync metadata. Stores hashes/revisions, never profile payloads. */
(function(g){'use strict';
const VERSION=1,BASE_KEY='uv.profile.sync-state.v1';
function freeze(x){return Object.freeze(x)}
function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function fingerprint(value){
 const s=canonical(value);let h=1469598103934665603n;
 for(let i=0;i<s.length;i++){h^=BigInt(s.charCodeAt(i));h=BigInt.asUintN(64,h*1099511628211n)}
 return 'fnv64:'+h.toString(16).padStart(16,'0');
}
function create(options={}){
 const storage=options.storage||g.UVIdentityStores?.defaults?.().adapter;
 const scope=String(options.scope||'default').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'default';
 const KEY=BASE_KEY+'.'+scope;
 if(!storage||typeof storage.read!=='function'||typeof storage.write!=='function')throw new TypeError('Sync state requires storage');
 function fresh(){return {version:VERSION,lastPullAt:null,importAccepted:false,resources:{}}}
 function load(){
  const raw=storage.read(KEY,null);
  if(!raw||raw.version!==VERSION||!raw.resources||typeof raw.resources!=='object')return fresh();
  return raw;
 }
 function save(state){storage.write(KEY,state);return state}
 function get(type,id){const row=load().resources?.[type]?.[String(id)];return row&&typeof row==='object'?{...row}:null}
 function set(type,id,row={}){
  const revision=Number(row.revision);
  if(!Number.isInteger(revision)||revision<1)throw new TypeError('Invalid sync revision');
  const state=load();if(!state.resources[type])state.resources[type]={};
  state.resources[type][String(id)]={revision,hash:row.deleted?null:String(row.hash||''),deleted:row.deleted===true,updatedAt:row.updatedAt||null};
  save(state);return {...state.resources[type][String(id)]};
 }
 function remove(type,id){const state=load();if(state.resources[type])delete state.resources[type][String(id)];save(state);return true}
 function markPull(at=Date.now()){const state=load();state.lastPullAt=Number(at)||Date.now();save(state);return state.lastPullAt}
 function importAccepted(){return load().importAccepted===true}
 function acceptImport(value=true){const state=load();state.importAccepted=value===true;save(state);return state.importAccepted}
 function clear(){storage.remove?.(KEY);return true}
 return freeze({KEY,load,get,set,remove,markPull,importAccepted,acceptImport,clear,fingerprint,canonical});
}
g.UVSyncState=freeze({VERSION,BASE_KEY,canonical,fingerprint,create});
})(typeof window!=='undefined'?window:globalThis);
