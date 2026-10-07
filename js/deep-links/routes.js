/* U.Venice 9.0 — curated stable deep-link route catalog. */
(function(g){
'use strict';
const config=Object.assign({url:'data/deep-links/routes.json'},g.UVTransitDeepLinkRoutesConfig||{});
let promise=null,doc=null,byId=null;
async function load(){
 if(doc)return doc;if(promise)return promise;
 promise=(async()=>{
  const response=await fetch(config.url,{cache:'default'});
  if(!response.ok)throw new Error('Stable route catalog unavailable ('+response.status+')');
  const data=await response.json();
  if(data?.schemaVersion!==1||!Array.isArray(data.routes))throw new Error('Stable route catalog invalid');
  const seen=new Set();
  for(const route of data.routes){
   if(!route?.id||!route.from||!route.to||seen.has(route.id))throw new Error('Stable route catalog contains invalid or duplicate IDs');
   seen.add(route.id);
  }
  doc=Object.freeze(data);byId=new Map(data.routes.map(route=>[route.id,Object.freeze(route)]));return doc;
 })().catch(error=>{promise=null;throw error});
 return promise;
}
async function get(id){await load();return byId.get(String(id||''))||null}
async function resolve(id){
 const route=await get(id);if(!route)return null;
 const [from,to]=await Promise.all([g.UVTransitEntities?.get?.(route.from),g.UVTransitEntities?.get?.(route.to)]);
 return from&&to?{...route,fromEntity:from,toEntity:to}:null;
}
function display(route,lang=g.UVTransitI18n?.getLocale?.()||document.documentElement?.lang||'it'){
 return route?.names?.[lang]||route?.names?.it||route?.id||'';
}
function resetForTests(){promise=null;doc=null;byId=null}
g.UVTransitDeepLinkRoutes=Object.freeze({load,get,resolve,display,resetForTests});
})(typeof window!=='undefined'?window:globalThis);
