/* Unlock Venice Transit — normalized transport alert feed.
   Delivery-neutral: the same event topics can be consumed by the web UI today
   and by APNs/FCM registration in a future native wrapper. */
(function(global){
'use strict';
const N=global.UVTransitNotifications,F=global.UVTransitFavorites;
if(!N)return;
const SEEN_KEY='unlockVeniceTransitAlertSeen.v1';
const POLL_MS=60000;
const STALE_AFTER_MS=15*60*1000;
const MAX_SEEN=240;
let current={schemaVersion:1,generatedAt:null,revision:null,sourceHealth:{},alerts:[]};
let timer=null;

function feedUrl(){
  return new URL('api/service-alerts.php',document.baseURI).href;
}
function staticFeedUrl(){
  return new URL('runtime-data/alerts/current.json',document.baseURI).href;
}
function normalizeAlert(a){
  const scope=a&&a.scope&&typeof a.scope==='object'?a.scope:{};
  const source=a&&a.source&&typeof a.source==='object'?a.source:{};
  const audience=a&&a.audience&&typeof a.audience==='object'?a.audience:{};
  return {
    id:String(a?.id||''),
    version:String(a?.version||''),
    provider:String(a?.provider||'AVM/Actv'),
    category:String(a?.category||'general_service_info'),
    cause:String(a?.cause||'unspecified'),
    lifecycle:String(a?.lifecycle||'informational'),
    severity:String(a?.severity||'info'),
    planned:!!a?.planned,
    impact:String(a?.impact||'partial'),
    title:String(a?.title||'Avviso di servizio'),
    body:String(a?.body||''),
    source:{...source,alternates:Array.isArray(source.alternates)?source.alternates.map(x=>({...x})):[]},
    officialDetail:a?.officialDetail?String(a.officialDetail):null,
    scope:{
      networks:Array.isArray(scope.networks)?scope.networks.map(String):[],
      lines:Array.isArray(scope.lines)?scope.lines.map(String):[],
      stops:Array.isArray(scope.stops)?scope.stops:[],
      areas:Array.isArray(scope.areas)?scope.areas.map(String):[],
      directions:Array.isArray(scope.directions)?scope.directions.map(String):[],
      segments:Array.isArray(scope.segments)?scope.segments.map(x=>({...x})):[]
    },
    validity:a?.validity&&typeof a.validity==='object'?{...a.validity}:{startsAt:null,endsAt:null,label:null},
    effects:Array.isArray(a?.effects)?a.effects.map(String):[],
    tags:Array.isArray(a?.tags)?a.tags.map(String):[],
    audience:{
      topics:Array.isArray(audience.topics)?audience.topics.map(String):[],
      pushEligible:!!audience.pushEligible
    },
    resolvedBy:a?.resolvedBy||null
  };
}
function normalizeFeed(payload){
  const p=payload&&typeof payload==='object'?payload:{};
  return {
    schemaVersion:Number(p.schemaVersion||1),
    generatedAt:p.generatedAt||null,
    revision:p.revision||null,
    sourceHealth:p.sourceHealth&&typeof p.sourceHealth==='object'?p.sourceHealth:{},
    alerts:Array.isArray(p.alerts)?p.alerts.map(normalizeAlert).filter(a=>a.id):[]
  };
}
function readSeen(){
  try{
    const v=JSON.parse(global.localStorage?.getItem(SEEN_KEY)||'{}');
    return v&&typeof v==='object'?v:{};
  }catch(_){return {}}
}
function writeSeen(value){
  try{
    const entries=Object.entries(value).sort((a,b)=>(b[1]?.seenAt||0)-(a[1]?.seenAt||0)).slice(0,MAX_SEEN);
    global.localStorage?.setItem(SEEN_KEY,JSON.stringify(Object.fromEntries(entries)));
  }catch(_){}
}
function isUnread(a){
  if(!a||!a.id)return false;
  const seen=readSeen()[a.id];
  return !seen||seen.version!==a.version;
}
function feedAgeMs(now=Date.now()){
  const generated=Date.parse(current.generatedAt||'');
  if(!Number.isFinite(generated))return Infinity;
  return Math.max(0,now-generated);
}
function feedFresh(now=Date.now()){return feedAgeMs(now)<=STALE_AFTER_MS}
function feedStatus(now=Date.now()){return feedFresh(now)?'ready':'stale'}
function markSeen(ids){
  const wanted=new Set((ids||[]).map(String)),seen=readSeen(),now=Date.now();
  for(const a of current.alerts){
    if(!wanted.size||wanted.has(a.id))seen[a.id]={version:a.version,seenAt:now};
  }
  writeSeen(seen);publish(feedStatus(now));
}
function markAllSeen(){markSeen(current.alerts.map(a=>a.id))}
function normRoute(value){return String(value||'').trim().toUpperCase()}
function favoriteRoutes(){return F?.load?.().routes?.map(String)||[]}
function matchesFavorites(a){
  const routes=new Set(favoriteRoutes().map(normRoute));
  return !!a?.scope?.lines?.some(line=>routes.has(normRoute(line)));
}
function pushTopics(){
  return ['alerts:all',...favoriteRoutes().map(line=>'line:'+line)];
}
function unreadCount(){
  return current.alerts.filter(a=>a.lifecycle!=='resolved'&&isUnread(a)).length;
}
function isActiveProblem(a){
  return feedFresh()&&!!a&&a.lifecycle==='active'&&!['service_restored','service_enhancement','general_service_info'].includes(a.category);
}
function activeProblems(){return current.alerts.filter(isActiveProblem)}
function activeProblemCount(){return activeProblems().length}
function routeAlerts(route,{includePlanned=false}={}){
  const key=normRoute(route);
  if(!key)return[];
  return current.alerts.filter(a=>{
    if(!a?.scope?.lines?.some(line=>normRoute(line)===key))return false;
    if(isActiveProblem(a))return true;
    return includePlanned&&a.lifecycle==='planned';
  });
}
function routeProblemState(route){
  const rank={critical:4,major:3,minor:2,info:1};
  const alerts=routeAlerts(route).sort((a,b)=>(rank[b.severity]||0)-(rank[a.severity]||0));
  return {active:!!alerts.length,count:alerts.length,severity:alerts[0]?.severity||null,primary:alerts[0]||null,alerts};
}
const SHORT_LABELS={
  service_interruption:'servizio interrotto',
  service_restriction:'servizio limitato',
  replacement_service:'servizio sostitutivo',
  route_diversion:'percorso deviato',
  stop_change:'fermata o approdo modificato',
  schedule_change:'orari modificati',
  planned_service_change:'servizio modificato'
};
function conciseLabel(a,route=''){
  if(!a)return'Problema di servizio';
  const subject=route?'Linea '+route:(a.scope?.lines?.length===1?'Linea '+a.scope.lines[0]:'Servizio');
  return subject+' · '+(SHORT_LABELS[a.category]||'problema di servizio');
}
function alertsForRoutes(routes){
  const seen=new Set(),out=[];
  for(const route of routes||[])for(const a of routeAlerts(route)||[]){
    if(!seen.has(a.id)){seen.add(a.id);out.push(a)}
  }
  return out;
}
function openAlert(id){
  const alert=current.alerts.find(a=>a.id===id)||null,targetId=alert?.id||id||null;
  global.UVTransitRedesign?.open?.('alerts',document.getElementById('alertsBtn'));
  const focus=()=>{
    if(global.UVTransitAlertsPanel?.focus){
      global.UVTransitAlertsPanel.focus(targetId);
      global.UVTransitAlertsPanel.render?.();
    }else try{global.dispatchEvent(new CustomEvent('uv:alert-focus',{detail:{id:targetId}}))}catch(_){}
  };
  focus();
  if(global.requestAnimationFrame)global.requestAnimationFrame(focus);
  return alert;
}
function publish(status,error){
  N.setAlerts({
    status,
    generatedAt:current.generatedAt,
    revision:current.revision,
    sourceHealth:current.sourceHealth,
    items:current.alerts,
    error:error||null
  });
  try{global.dispatchEvent(new CustomEvent('uv:alerts',{detail:{revision:current.revision,unread:unreadCount(),active:activeProblemCount()}}))}catch(_){}
}
function accept(payload){
  current=normalizeFeed(payload);
  const status=feedStatus();
  publish(status,status==='stale'?'Feed avvisi non aggiornato entro la finestra prevista.':null);
  return current;
}
async function refresh(){
  if(typeof global.fetch!=='function'){publish('unavailable','Fetch non disponibile');return current}
  N.setAlerts({status:'loading',generatedAt:current.generatedAt,revision:current.revision,sourceHealth:current.sourceHealth,items:current.alerts});
  let endpointError=null;
  try{
    const response=await global.fetch(feedUrl(),{cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('HTTP '+response.status);
    return accept(await response.json());
  }catch(error){
    endpointError=error;
  }
  try{
    const fallback=await global.fetch(staticFeedUrl(),{cache:'no-store',headers:{Accept:'application/json'}});
    if(!fallback.ok)throw new Error('HTTP '+fallback.status);
    return accept(await fallback.json());
  }catch(error){
    publish(current.alerts.length?'stale':'unavailable',(endpointError?.message||String(endpointError||error))+' · fallback '+(error?.message||String(error)));
    return current;
  }
}
function start(){
  if(typeof global.fetch!=='function')return;
  void refresh();
  if(!timer)timer=global.setInterval(()=>void refresh(),POLL_MS);
}
function stop(){if(timer){global.clearInterval(timer);timer=null}}

global.addEventListener?.('uv:favorites',()=>publish(feedStatus()));
document.addEventListener?.('click',event=>{
  const target=event.target?.closest?.('[data-alert-open]');
  if(!target)return;
  event.preventDefault();event.stopPropagation();
  openAlert(target.dataset.alertOpen||null);
});
global.UVTransitAlerts=Object.freeze({
  SEEN_KEY,
  STALE_AFTER_MS,
  feedUrl,
  staticFeedUrl,
  feedAgeMs,
  feedFresh,
  refresh,
  start,
  stop,
  accept,
  current:()=>JSON.parse(JSON.stringify(current)),
  isUnread,
  unreadCount,
  isActiveProblem,
  activeProblems,
  activeProblemCount,
  routeAlerts,
  routeProblemState,
  conciseLabel,
  alertsForRoutes,
  openAlert,
  markSeen,
  markAllSeen,
  matchesFavorites,
  pushTopics
});
start();
})(window);
