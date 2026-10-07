/* M10.3E — saved-data facade: local fallback before Account rollout, cloud-first once signed in. */
(function(g){'use strict';
function accountRequired(kind){
  g.UVAccountSaveGate?.request?.(kind);
  const e=new Error(g.UVTransitI18n?.t?.('account.saveRequiresAccount')||'Accedi o crea un account per salvare.');
  e.code='ACCOUNT_REQUIRED_TO_SAVE';e.kind=kind;return e;
}
async function mode(kind){
  if(!g.UVAccountRuntime?.available?.())return {local:true};
  const session=await g.UVAccountRuntime.session();
  if(!session?.user)throw accountRequired(kind);
  return {local:false,controller:await g.UVAccountRuntime.controller()};
}
async function toggleRoute(route){
  const id=String(route||'');if(!id)return false;
  const m=await mode('route');
  if(m.local){g.UVTransitFavorites.toggleRoute(id);return g.UVTransitFavorites.hasRoute(id)}
  if(g.UVTransitFavorites.hasRoute(id)){await m.controller.removeOwned('saved_route',id);return false}
  await m.controller.saveOwned('saved_route',id);return true;
}
async function toggleStop(stop){
  const id=String(stop||'');if(!id)return false;
  const m=await mode('stop');
  if(m.local){g.UVTransitFavorites.toggleStop(id);return g.UVTransitFavorites.hasStop(id)}
  if(g.UVTransitFavorites.hasStop(id)){await m.controller.removeOwned('saved_stop',id);return false}
  await m.controller.saveOwned('saved_stop',id);return true;
}
async function savePlace(row){
  const m=await mode('place');
  if(m.local)return g.UVTransitSavedPlaces.save(row);
  if(row?.id&&!m.controller.owned('saved_place',row.id))return g.UVTransitSavedPlaces.save(row);
  const result=await m.controller.saveOwned('saved_place',row);
  return result.local;
}
async function removePlace(row){
  const id=String(row?.id||row||'');if(!id)return false;
  if(!g.UVAccountRuntime?.available?.()){g.UVTransitSavedPlaces.remove(id);return true}
  const session=await g.UVAccountRuntime.session();
  if(!session?.user){g.UVTransitSavedPlaces.remove(id);return true}
  const controller=await g.UVAccountRuntime.controller();
  if(!controller.owned('saved_place',id)){g.UVTransitSavedPlaces.remove(id);return true}
  await controller.removeOwned('saved_place',typeof row==='object'?row:{id});return true;
}
async function saveJourney(row){
  const m=await mode('journey');
  if(m.local)return g.UVTransitSavedJourneys.save(row);
  if(row?.id&&!m.controller.owned('saved_journey',row.id))return g.UVTransitSavedJourneys.save(row);
  const result=await m.controller.saveOwned('saved_journey',row);
  return result.local;
}
async function removeJourney(row){
  const id=String(row?.id||row||'');if(!id)return false;
  if(!g.UVAccountRuntime?.available?.()){g.UVTransitSavedJourneys.remove(id);return true}
  const session=await g.UVAccountRuntime.session();
  if(!session?.user){g.UVTransitSavedJourneys.remove(id);return true}
  const controller=await g.UVAccountRuntime.controller();
  if(!controller.owned('saved_journey',id)){g.UVTransitSavedJourneys.remove(id);return true}
  await controller.removeOwned('saved_journey',typeof row==='object'?row:{id});return true;
}
g.UVAccountSaved=Object.freeze({toggleRoute,toggleStop,savePlace,removePlace,saveJourney,removeJourney});
})(typeof window!=='undefined'?window:globalThis);
