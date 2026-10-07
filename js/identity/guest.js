/* U.Venice 9.0 M9 — pseudonymous local guest identity.
   The identifier is local-only and is never transmitted by this module. */
(function(g){'use strict';

const SCHEMA_VERSION=1;
function freeze(x){return Object.freeze(x)}
function now(){return Date.now()}
function uuid(){
  if(g.crypto?.randomUUID)return g.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(g.crypto?.getRandomValues)g.crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
function valid(row){
  return !!row&&row.schemaVersion===SCHEMA_VERSION&&/^guest:[0-9a-f-]{36}$/i.test(String(row.id||''))&&Number.isFinite(Number(row.createdAt));
}
function create(options={}){
  const store=options.store||g.UVIdentityStores?.defaults?.().identity;
  const clock=typeof options.clock==='function'?options.clock:now;
  if(!store)throw new Error('IdentityStore unavailable');
  function current(){
    const row=store.load(null);
    return valid(row)?freeze({...row}):null;
  }
  function getOrCreate(){
    const existing=current();if(existing)return existing;
    const row=freeze({schemaVersion:SCHEMA_VERSION,id:'guest:'+uuid(),createdAt:Number(clock()),state:'guest'});
    store.save(row);return row;
  }
  function reset(){
    store.clear();
    return getOrCreate();
  }
  return freeze({current,getOrCreate,reset});
}
let singleton=null;
function instance(){return singleton||(singleton=create())}

g.UVGuestIdentity=freeze({SCHEMA_VERSION,create,instance,getOrCreate:()=>instance().getOrCreate(),current:()=>instance().current()});
})(typeof window!=='undefined'?window:globalThis);
