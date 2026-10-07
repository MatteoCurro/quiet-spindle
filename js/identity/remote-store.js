/* M10.3B — provider-neutral remote profile store boundary. */
(function(g){'use strict';
function freeze(x){return Object.freeze(x)}
function create(adapter){
 if(!adapter||typeof adapter!=='object')throw new TypeError('Remote store adapter required');
 for(const name of ['pull','write','remove','tombstones','configure'])if(typeof adapter[name]!=='function')throw new TypeError('Remote store missing '+name+'()');
 return freeze({
  kind:String(adapter.kind||'custom'),
  pull:opts=>adapter.pull(opts||{}),
  write:(type,payload,meta)=>adapter.write(type,payload||{},meta||{}),
  remove:(type,id,meta)=>adapter.remove(type,id,meta||{}),
  tombstones:since=>adapter.tombstones(since||null),
  configure:(enabled,noticeVersion,meta)=>adapter.configure(!!enabled,noticeVersion||null,meta||{})
 });
}
g.UVRemoteProfileStore=freeze({create});
})(typeof window!=='undefined'?window:globalThis);
