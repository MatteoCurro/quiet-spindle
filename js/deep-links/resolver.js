/* U.Venice 9.0 — operational deep-link parser/resolver.
   Dynamic links are intentionally non-indexable; SEO landing pages are separate. */
(function(g){
'use strict';

const LANGS=new Set(['it','en','fr','de']);
const config=Object.assign({autoApply:true},g.UVTransitDeepLinkConfig||{});
let lastState=null;

function decode(value){try{return decodeURIComponent(String(value||'').replace(/\+/g,' ')).trim()}catch(_){return String(value||'').trim()}}
function normalize(value){return g.UVTransitSearchAggregator?.normalize?.(value)||String(value||'').toLowerCase().trim()}
function target(value){
  const raw=decode(value);if(!raw)return null;
  if(raw.toLowerCase()==='current')return {kind:'current',value:'current',raw};
  if(/^entity:/i.test(raw))return {kind:'entity',value:raw.slice(7),raw};
  if(/^(?:poi|hub|airport):/i.test(raw))return {kind:'entity',value:raw,raw};
  return {kind:'text',value:raw,raw};
}
function stableEntityId(value){
  const raw=decode(value);
  if(!raw)return '';
  if(/^(?:poi|hub|airport):/i.test(raw))return raw;
  return 'poi:'+raw;
}
function parse(input){
  let url;
  try{url=input instanceof URL?input:new URL(String(input||g.location?.href||''),g.location?.href||'https://example.invalid/')}
  catch(_){return {active:false,invalid:true,from:null,to:null,routeId:null,lang:null,ref:null,campaign:null,mode:null,url:null}}
  let from=null,to=null,routeId=null,source='query';
  const parts=url.pathname.split('/').filter(Boolean),go=parts.lastIndexOf('go');
  if(go>=0){
    source='path';
    const tail=parts.slice(go+1),head=(tail[0]||'').toLowerCase();
    if(head==='p'&&tail[1])to={kind:'entity',value:stableEntityId(tail.slice(1).join('/')),raw:decode(tail.slice(1).join('/'))};
    else if(head==='r'&&tail[1])routeId=decode(tail.slice(1).join('/'));
    else if(head==='poi'&&tail[1])to=target(tail.slice(1).join('/'));
    else if(head==='to'&&tail[1])to=target(tail.slice(1).join('/'));
    else if(head==='from'){
      const toIndex=tail.findIndex((part,index)=>index>0&&part.toLowerCase()==='to');
      if(toIndex>1){from=target(tail.slice(1,toIndex).join('/'));to=target(tail.slice(toIndex+1).join('/'))}
    }
  }
  const params=url.searchParams;
  if(params.has('from'))from=target(params.get('from'));
  if(params.has('to'))to=target(params.get('to'));
  const routeParam=decode(params.get('route'));if(routeParam)routeId=routeParam;
  const lang=LANGS.has(String(params.get('lang')||'').toLowerCase())?String(params.get('lang')).toLowerCase():null;
  const ref=decode(params.get('ref')),campaign=decode(params.get('campaign')),mode=decode(params.get('mode'));
  return {active:!!(from||to||routeId),invalid:false,from,to,routeId,lang,ref:ref||null,campaign:campaign||null,mode:mode||null,source,url};
}
function confidence(rows,query){
  if(!rows?.length)return {state:'missing',row:null,score:Infinity,gap:0};
  const top=rows[0],second=rows[1],q=normalize(query),match=normalize(top.raw?.match?.value||''),name=normalize(top.name),gap=second?Number(second.score)-Number(top.score):Infinity;
  const exact=!!q&&(q===name||q===match),exactHouse=!!top.raw?.exactHouse;
  const strong=(exact&&gap>=1)||exactHouse||(Number(top.score)<=0&&gap>=5)||(!second&&Number(top.score)<=12);
  return {state:strong?'resolved':'ambiguous',row:top,score:Number(top.score),gap,rows};
}
function entityPoint(entity,locale){
  if(!entity?.location)return null;
  return {id:entity.id,entityId:entity.id,name:g.UVTransitEntities?.display?.(entity,locale)||entity.names?.[locale]||entity.names?.it||entity.id,lat:Number(entity.location.lat),lon:Number(entity.location.lon),place:true};
}
async function resolveTarget(spec,kind,locale){
  if(!spec)return {state:'empty',point:null};
  if(spec.kind==='current')return {state:'current',point:null};
  if(spec.kind==='entity'){
    const id=stableEntityId(spec.value),entity=await g.UVTransitEntities?.get?.(id);
    const point=entityPoint(entity,locale);
    return point?{state:'resolved',point,entity}:{state:'missing',point:null,query:spec.raw||spec.value};
  }
  const rows=await g.UVTransitJourney?.search?.(spec.value,{kind,locale,limit:6})||[];
  const verdict=confidence(rows,spec.value);
  if(verdict.state==='resolved')return {state:'resolved',point:g.UVTransitJourney?.pointFromSearchResult?.(verdict.row)||verdict.row,rows,query:spec.value};
  return {...verdict,query:spec.value};
}
function canonicalBase(url){
  const u=new URL(url.href),parts=u.pathname.split('/'),go=parts.lastIndexOf('go');
  if(go>=0)u.pathname=parts.slice(0,go).join('/')+'/';
  u.search='';u.hash='';return u.href;
}
function applySeo(parsed){
  if(!parsed?.active||!parsed.url||!g.document)return;
  let robots=document.querySelector('meta[name="robots"][data-uv-deep-link]');
  if(!robots){robots=document.createElement('meta');robots.name='robots';robots.dataset.uvDeepLink='1';document.head.append(robots)}
  robots.content='noindex,follow';
  let canonical=document.querySelector('link[rel="canonical"][data-uv-deep-link]');
  if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';canonical.dataset.uvDeepLink='1';document.head.append(canonical)}
  canonical.href=canonicalBase(parsed.url);
}
function emit(detail){try{g.dispatchEvent?.(new CustomEvent('uv:deep-link',{detail}))}catch(_){}}
function prefill(kind,result){const q=result?.query||'';g.UVTransitJourney?.prefillSearch?.(kind,q)}
async function apply(input){
  const parsed=parse(input);if(!parsed.active){lastState={parsed,state:'inactive'};return lastState}
  applySeo(parsed);
  if(parsed.routeId){
    const route=await g.UVTransitDeepLinkRoutes?.get?.(parsed.routeId);
    if(route){
      if(!parsed.from)parsed.from={kind:'entity',value:route.from,raw:route.from};
      if(!parsed.to)parsed.to={kind:'entity',value:route.to,raw:route.to};
      if(!parsed.mode&&route.mode)parsed.mode=route.mode;
      if(!parsed.lang&&route.lang&&LANGS.has(route.lang))parsed.lang=route.lang;
    }else{
      g.UVTransitJourney?.openSearch?.();
      lastState={parsed,state:'missing-route',routeId:parsed.routeId};
      emit({state:'missing-route',routeId:parsed.routeId,ref:parsed.ref,campaign:parsed.campaign});
      return lastState;
    }
  }
  if(parsed.lang&&g.UVTransitI18n?.setLocale&&g.UVTransitI18n.getLocale?.()!==parsed.lang)await g.UVTransitI18n.setLocale(parsed.lang,{persist:false,updateUrl:false});
  const locale=parsed.lang||g.UVTransitI18n?.getLocale?.()||document.documentElement?.lang||'it';
  g.UVTransitJourney?.openSearch?.();
  if(parsed.mode)g.UVTransitJourney?.setNetworkMode?.(parsed.mode);
  const detail={source:parsed.source,ref:parsed.ref,campaign:parsed.campaign,mode:parsed.mode,lang:locale,routeId:parsed.routeId||null};

  let toResult=await resolveTarget(parsed.to,'destination',locale);
  if(toResult.state==='resolved')g.UVTransitJourney?.choose?.('destination',toResult.point);
  else if(toResult.state==='ambiguous'||toResult.state==='missing')prefill('destination',toResult);

  let fromResult;
  if(parsed.from?.kind==='current'){
    const point=await g.UVTransitJourney?.useCurrentLocation?.();
    fromResult=point?{state:'resolved',point}:{state:'missing',query:'current'};
  }else{
    fromResult=await resolveTarget(parsed.from,'origin',locale);
    if(fromResult.state==='resolved')g.UVTransitJourney?.choose?.('origin',fromResult.point);
    else if(fromResult.state==='ambiguous'||fromResult.state==='missing')prefill('origin',fromResult);
  }

  const ready=fromResult?.state==='resolved'&&toResult?.state==='resolved';
  if(ready)await g.UVTransitJourney?.find?.();
  else if(!parsed.from&&toResult.state==='resolved')document.getElementById('journeyOrigin')?.focus?.({preventScroll:true});

  lastState={parsed,state:ready?'ready':'needs-input',from:fromResult||{state:'empty'},to:toResult,detail};
  emit({...detail,state:lastState.state,from:lastState.from.state,to:lastState.to.state});
  return lastState;
}
function stablePath(entityId){const stable=stableEntityId(entityId),id=stable.startsWith('poi:')?stable.slice(4):stable;return '/go/p/'+encodeURIComponent(id)}
function stableRoutePath(routeId){return '/go/r/'+encodeURIComponent(String(routeId||'').trim())}
function dynamicPathTo(text){return '/go/to/'+encodeURIComponent(String(text||'').trim())}
function last(){return lastState}

g.UVTransitDeepLinks=Object.freeze({parse,target,stableEntityId,confidence,resolveTarget,apply,stablePath,stableRoutePath,dynamicPathTo,last});

if(config.autoApply!==false){
  const parsed=parse();
  if(parsed.active)Promise.resolve(g.__UV_I18N_READY__).catch(()=>null).then(()=>apply(parsed.url||g.location?.href)).catch(error=>{
    lastState={parsed,state:'error',error:String(error?.message||error)};
    emit({state:'error',error:lastState.error,ref:parsed.ref,campaign:parsed.campaign});
  });
}
})(typeof window!=='undefined'?window:globalThis);
