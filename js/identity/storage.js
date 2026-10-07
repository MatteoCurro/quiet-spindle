/* U.Venice 9.0 M9 — storage adapter foundation.
   No network, DOM or account dependency. */
(function(g){'use strict';

function freeze(x){return Object.freeze(x)}
function clone(v){
  if(v===undefined)return undefined;
  return JSON.parse(JSON.stringify(v));
}
function createLocal(options={}){
  const storage=options.storage||g.localStorage;
  if(!storage||typeof storage.getItem!=='function')throw new TypeError('Storage adapter requires Web Storage compatible backend');
  function has(key){try{return storage.getItem(String(key))!==null}catch(_){return false}}
  function read(key,fallback=null){
    try{
      const raw=storage.getItem(String(key));
      return raw===null?clone(fallback):JSON.parse(raw);
    }catch(_){return clone(fallback)}
  }
  function write(key,value){
    storage.setItem(String(key),JSON.stringify(value));
    return clone(value);
  }
  function remove(key){try{storage.removeItem(String(key));return true}catch(_){return false}}
  function readRaw(key){try{return storage.getItem(String(key))}catch(_){return null}}
  function writeRaw(key,value){storage.setItem(String(key),String(value));return String(value)}
  return freeze({kind:'localStorage',has,read,write,remove,readRaw,writeRaw});
}
function createMemory(seed={}){
  const map=new Map(Object.entries(seed).map(([k,v])=>[String(k),typeof v==='string'?v:JSON.stringify(v)]));
  const storage={
    getItem:key=>map.has(String(key))?map.get(String(key)):null,
    setItem:(key,value)=>{map.set(String(key),String(value))},
    removeItem:key=>{map.delete(String(key))}
  };
  const adapter=createLocal({storage});
  return freeze({...adapter,kind:'memory',dump:()=>freeze(Object.fromEntries(map))});
}
function createMirror(adapter,options={}){
  const key=String(options.key||'');
  const legacyKeys=(options.legacyKeys||[]).map(String).filter(Boolean);
  if(!key)throw new TypeError('Mirror store requires canonical key');
  function readable(k){
    const raw=adapter.readRaw(k);
    if(raw===null)return false;
    try{JSON.parse(raw);return true}catch(_){return false}
  }
  function source(){
    if(readable(key))return key;
    return legacyKeys.find(readable)||null;
  }
  function load(fallback=null){
    const src=source();
    return src?adapter.read(src,fallback):clone(fallback);
  }
  function save(value){
    adapter.write(key,value);
    for(const legacy of legacyKeys)adapter.write(legacy,value);
    return clone(value);
  }
  function clear(){
    adapter.remove(key);
    for(const legacy of legacyKeys)adapter.remove(legacy);
  }
  function migrate(){
    if(readable(key))return freeze({key,migrated:false,source:key,reason:'canonical-present'});
    const hadCanonical=adapter.has(key);
    const legacy=legacyKeys.find(readable);
    if(!legacy)return freeze({key,migrated:false,source:null,reason:hadCanonical?'canonical-invalid':'empty'});
    const value=adapter.read(legacy,null);
    adapter.write(key,value);
    return freeze({key,migrated:true,source:legacy,reason:hadCanonical?'legacy-repair':'legacy-copy'});
  }
  return freeze({key,legacyKeys:freeze(legacyKeys),load,save,clear,migrate,source});
}

g.UVIdentityStorage=freeze({createLocal,createMemory,createMirror});
})(typeof window!=='undefined'?window:globalThis);
