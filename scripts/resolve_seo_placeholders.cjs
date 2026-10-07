#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const Related=require('./score_seo_related_content.cjs');

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function assert(condition,message){if(!condition)throw new Error(message)}
function compact(value=''){return String(value||'').replace(/\s+/g,' ').trim()}
function unique(values){return [...new Set((values||[]).filter(Boolean))]}
function normalizeBase(value){
  let v=compact(value||'/trasporti');
  if(!v.startsWith('/'))v='/'+v;
  return v.replace(/\/+$/,'')||'';
}
function joinPath(...parts){
  const body=parts.map((p,i)=>String(p||'').replace(i===0?/\/+$/g:/^\/+|\/+$/g,'')).filter(Boolean).join('/');
  return (body.startsWith('/')?'':'/')+body;
}
function parsePlaceholder(token){
  const match=String(token||'').trim().match(/^\{\{([a-z_]+)([\s\S]*?)\}\}$/);
  if(!match)throw new Error('Invalid placeholder syntax: '+token);
  const name=match[1],rest=match[2]||'',attrs={},consumed=[];
  const re=/([a-z_]+)="([^"]*)"/g;let m;
  while((m=re.exec(rest))){
    if(Object.prototype.hasOwnProperty.call(attrs,m[1]))throw new Error('Duplicate placeholder attribute '+m[1]);
    attrs[m[1]]=m[2];consumed.push(m[0]);
  }
  let leftover=rest;
  for(const part of consumed)leftover=leftover.replace(part,'');
  if(leftover.trim())throw new Error('Invalid placeholder attributes: '+leftover.trim());
  return {name,attrs};
}
function validateAttrs(name,attrs,contract){
  const spec=contract.placeholders?.[name];
  if(!spec)throw new Error('Unknown placeholder '+name);
  const allowed=new Set(spec.allowedAttributes||[]);
  for(const key of Object.keys(attrs))if(!allowed.has(key))throw new Error('Unsupported '+name+' attribute '+key);
}
function pageContext(pageId,ctx){
  const place=ctx.places.pages.find(p=>p.id===pageId);
  if(place)return {kind:'place',page:place,manifest:ctx.places};
  const route=ctx.routes.pages.find(p=>p.id===pageId);
  if(route)return {kind:'route',page:route,manifest:ctx.routes};
  throw new Error('Unknown landing page '+pageId);
}
function entityMap(ctx){return new Map(ctx.registry.entities.map(e=>[e.id,e]))}
function routeMap(ctx){return new Map(ctx.routeCatalog.routes.map(r=>[r.id,r]))}
function landingSlug(context,lang,ctx){
  if(context.kind==='route')return context.page.slugs?.[lang]||'';
  return entityMap(ctx).get(context.page.entity)?.seo?.slugs?.[lang]||'';
}
function landingLabel(context,lang,ctx){
  if(context.kind==='route')return routeMap(ctx).get(context.page.route)?.names?.[lang]||context.page.id;
  return entityMap(ctx).get(context.page.entity)?.names?.[lang]||context.page.id;
}
function landingHref(context,lang,ctx,options={}){
  assert(context.page.languages?.includes(lang),'Landing '+context.page.id+' does not support '+lang);
  const prefix=ctx.placeholderContract.localePrefixes?.[lang];
  assert(prefix!==undefined,'Unsupported locale '+lang);
  const slug=landingSlug(context,lang,ctx);
  assert(slug,'Missing localized landing slug for '+context.page.id+' '+lang);
  const root=compact(options.transportRoot||ctx.placeholderContract.transportRoot||'trasporti');
  const segment=context.manifest.pathSegments?.[lang];
  assert(segment,'Missing localized path segment for '+context.page.id+' '+lang);
  return joinPath(prefix,root,segment,slug)+'/';
}
function stableEntityPath(entityId){
  const raw=compact(entityId);
  assert(/^(?:poi|hub|airport):/.test(raw),'Invalid stable entity '+raw);
  const token=raw.startsWith('poi:')?raw.slice(4):raw;
  return '/go/p/'+encodeURIComponent(token);
}
function withQuery(base,params){
  const q=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{}))if(v!==null&&v!==undefined&&String(v)!=='')q.set(k,String(v));
  return base+(q.toString()?'?'+q.toString():'');
}
function fallbackJourneyLabel(targetName,lang){
  const labels={
    it:'Calcola il percorso per ',
    en:'Plan a route to ',
    fr:'Calculer l’itinéraire vers ',
    de:'Route berechnen nach '
  };
  return (labels[lang]||labels.it)+targetName;
}
function resolveJourney(attrs,pageId,lang,ctx,options={}){
  const context=pageContext(pageId,ctx),routes=routeMap(ctx),entities=entityMap(ctx);
  validateAttrs('journey_cta',attrs,ctx.placeholderContract);
  if(attrs.route&&attrs.to)throw new Error('journey_cta cannot combine route and to');
  if(attrs.route&&attrs.from)throw new Error('journey_cta cannot combine route and from');

  let routeId=attrs.route||'',to=attrs.to||'',from=attrs.from||'';
  if(!routeId&&!to){
    if(context.kind==='route')routeId=context.page.route;
    else{to=context.page.entity;from='current'}
  }

  let href,label,targetName;
  const appBase=normalizeBase(options.appBase||'/trasporti');
  const attribution={
    ref:ctx.placeholderContract.attribution?.ref||'seo_landing',
    campaign:pageId
  };

  if(routeId){
    const route=routes.get(routeId);assert(route,'Unknown stable route '+routeId);
    href=withQuery(appBase+'/go/r/'+encodeURIComponent(routeId),{lang,ref:attribution.ref,campaign:attribution.campaign});
    targetName=route.names?.[lang]||routeId;
    label=compact(attrs.label)||targetName;
    return {type:'journey_cta',pageId,lang,routeId,href,label,attribution};
  }

  assert(entities.has(to),'Unknown journey destination '+to);
  if(!from)from='current';
  if(from!=='current')assert(entities.has(from),'Unknown journey origin '+from);
  targetName=entities.get(to).names?.[lang]||to;
  href=withQuery(appBase+stableEntityPath(to),{
    from,
    lang,
    ref:attribution.ref,
    campaign:attribution.campaign
  });
  label=compact(attrs.label)||fallbackJourneyLabel(targetName,lang);
  return {type:'journey_cta',pageId,lang,to,from,href,label,attribution};
}
function eligibleContext(context,lang,options={}){
  if(!context.page.enabled||!context.page.languages?.includes(lang))return false;
  if(options.includePlanned)return ['planned','draft','ready'].includes(context.page.contentState);
  return context.page.contentState==='ready';
}
function allContexts(ctx){
  return [
    ...ctx.places.pages.map(page=>({kind:'place',page,manifest:ctx.places})),
    ...ctx.routes.pages.map(page=>({kind:'route',page,manifest:ctx.routes}))
  ];
}
function haversineKm(a,b){
  if(!a||!b)return Infinity;
  const R=6371,toRad=x=>Number(x)*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon),lat1=toRad(a.lat),lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function addCandidate(map,context,score,reason,lang,ctx,options){
  if(!context||!eligibleContext(context,lang,options))return;
  const previous=map.get(context.page.id);
  if(previous&&previous.score>=score)return;
  map.set(context.page.id,{
    pageId:context.page.id,
    kind:context.kind,
    href:landingHref(context,lang,ctx,options),
    label:landingLabel(context,lang,ctx),
    reason,
    score:Number(score.toFixed(3)),
    priority:Number(context.page.priority||0)
  });
}
function resolveRelatedTransport(pageId,lang,ctx,options={}){
  const current=pageContext(pageId,ctx),contexts=allContexts(ctx),routes=routeMap(ctx),entities=entityMap(ctx);
  const byPage=new Map(contexts.map(c=>[c.page.id,c]));
  const placeByEntity=new Map(contexts.filter(c=>c.kind==='place').map(c=>[c.page.entity,c]));
  const routeByRoute=new Map(contexts.filter(c=>c.kind==='route').map(c=>[c.page.route,c]));
  const candidates=new Map();

  if(current.kind==='route'){
    const route=routes.get(current.page.route);assert(route,'Unknown route '+current.page.route);
    addCandidate(candidates,placeByEntity.get(route.from),120,'route-origin',lang,ctx,options);
    addCandidate(candidates,placeByEntity.get(route.to),119,'route-destination',lang,ctx,options);
    for(const [routeId,other] of routes){
      if(routeId===route.id)continue;
      const shared=unique([route.from,route.to].filter(id=>id===other.from||id===other.to));
      if(!shared.length)continue;
      addCandidate(candidates,routeByRoute.get(routeId),90+shared.length*5,'shared-endpoint-route',lang,ctx,options);
      for(const id of [other.from,other.to])if(!shared.includes(id))addCandidate(candidates,placeByEntity.get(id),72,'connected-place',lang,ctx,options);
    }
  }else{
    const entityId=current.page.entity,entity=entities.get(entityId);assert(entity,'Unknown entity '+entityId);
    const connected=new Set();
    for(const [routeId,route] of routes){
      if(route.from!==entityId&&route.to!==entityId)continue;
      addCandidate(candidates,routeByRoute.get(routeId),115,'entity-route',lang,ctx,options);
      const other=route.from===entityId?route.to:route.from;connected.add(other);
      addCandidate(candidates,placeByEntity.get(other),88,'connected-place',lang,ctx,options);
    }
    const min=Number(current.manifest.internalLinking?.min||2);
    if(candidates.size<min&&entity.location){
      for(const candidate of contexts.filter(c=>c.kind==='place'&&c.page.id!==pageId)){
        const other=entities.get(candidate.page.entity);
        const km=haversineKm(entity.location,other?.location);
        if(!Number.isFinite(km))continue;
        addCandidate(candidates,candidate,Math.max(10,60-Math.min(km,25)),'nearby-place',lang,ctx,options);
      }
    }
  }

  candidates.delete(pageId);
  const max=Math.min(
    Number(current.manifest.internalLinking?.max||4),
    Number(ctx.placeholderContract.placeholders.related_transport.max||4)
  );
  const items=[...candidates.values()].sort((a,b)=>
    (b.score-a.score)||(b.priority-a.priority)||a.label.localeCompare(b.label,lang)
  ).slice(0,max).map(({score,priority,...item})=>item);
  return {type:'related_transport',pageId,lang,items};
}
function mergeRouteReading(a,b,limit){
  const map=new Map();
  for(const [entityId,ranked] of [[a.entityId,a],[b.entityId,b]]){
    for(const row of ranked.results){
      const current=map.get(row.url)||{
        url:row.url,title:row.title,published:row.published||'',score:0,
        exactEntity:false,manualInclude:false,sourceEntities:[],signals:[]
      };
      current.score=Math.max(current.score,Number(row.score||0));
      current.exactEntity=current.exactEntity||!!row.exactEntity;
      current.manualInclude=current.manualInclude||!!row.manualInclude;
      current.sourceEntities=unique([...current.sourceEntities,entityId]);
      current.signals=[...current.signals,...(row.signals||[])];
      map.set(row.url,current);
    }
  }
  for(const row of map.values())if(row.sourceEntities.length>1)row.score=Number((row.score+5).toFixed(2));

  const ranked=[...map.values()].sort((x,y)=>
    (Number(y.manualInclude)-Number(x.manualInclude))||
    (y.score-x.score)||
    String(y.published||'').localeCompare(String(x.published||''))||
    x.url.localeCompare(y.url)
  );

  const selected=[],seen=new Set();
  const add=row=>{if(!row||seen.has(row.url)||selected.length>=limit)return false;selected.push(row);seen.add(row.url);return true};

  for(const row of ranked.filter(x=>x.manualInclude))add(row);

  const quota=Math.max(1,Math.floor(limit/3));
  for(const entityId of [a.entityId,b.entityId]){
    let have=selected.filter(x=>x.sourceEntities.includes(entityId)).length;
    for(const row of ranked){
      if(have>=quota||selected.length>=limit)break;
      if(row.sourceEntities.includes(entityId)&&add(row))have++;
    }
  }

  for(const row of ranked){if(selected.length>=limit)break;add(row)}

  return selected.map(row=>({
    url:row.url,title:row.title,published:row.published,score:row.score,
    exactEntity:row.exactEntity,manualInclude:row.manualInclude,
    sourceEntities:row.sourceEntities,
    reason:row.sourceEntities.length>1?'both-route-endpoints':'route-endpoint-ranking'
  }));
}
function formatFarePrice(fare,lang='it'){
  const amount=Number(fare.price);
  const locales={it:'it-IT',en:'en-IE',fr:'fr-FR',de:'de-DE'};
  const prefixes={it:'da ',en:'from ',fr:'à partir de ',de:'ab '};
  const formatted=new Intl.NumberFormat(locales[lang]||'en-IE',{
    style:'currency',currency:'EUR',minimumFractionDigits:amount%1?2:0
  }).format(amount);
  return fare.priceType==='from'?((prefixes[lang]||'from ')+formatted):formatted;
}
function resolveFareTable(attrs,pageId,lang,ctx){
  validateAttrs('fare_table',attrs,ctx.placeholderContract);
  const group=compact(attrs.group);
  assert(group,'fare_table requires group');
  const registry=ctx.fares;
  assert(registry?.schemaVersion===1&&registry.audience==='visitor','Invalid tourist fare registry');
  const ids=registry.groups?.[group];
  assert(Array.isArray(ids)&&ids.length,'Unknown fare group '+group);
  const byId=new Map((registry.fares||[]).map(f=>[f.id,f]));
  const items=ids.map(id=>{
    const fare=byId.get(id);assert(fare,'Unknown fare '+id+' in group '+group);
    const label=fare.labels?.[lang]||fare.labels?.it||fare.id;
    const note=fare.notes?.[lang]||fare.notes?.it||'';
    assert(fare.lastVerified,'Fare '+id+' is missing lastVerified');
    assert(fare.sourceUrl,'Fare '+id+' is missing sourceUrl');
    return {
      id:fare.id,operator:fare.operator,mode:fare.mode,
      label,note,price:Number(fare.price),priceType:fare.priceType||'fixed',
      displayPrice:formatFarePrice(fare,lang),
      lastVerified:fare.lastVerified,sourceType:fare.sourceType,sourceUrl:fare.sourceUrl
    };
  });
  const dates=items.map(i=>i.lastVerified).sort();
  return {
    type:'fare_table',pageId,lang,group,
    lastReviewed:dates[dates.length-1]||registry.lastReviewed||'',
    items
  };
}
function resolveRelatedReading(pageId,lang,ctx,options={}){
  const current=pageContext(pageId,ctx),routes=routeMap(ctx);
  const limit=Math.min(Number(current.page.related?.limit||6),Number(ctx.placeholderContract.placeholders.related_reading.max||6));
  const rankOptions={
    limit:Math.max(limit*2,6),
    minScore:Number(options.minScore||Related.DEFAULTS.minScore),
    overrides:ctx.overrides,
    now:options.now||new Date()
  };
  let items;
  if(current.kind==='place'){
    const entity=entityMap(ctx).get(current.page.entity);
    const primary=Related.rankRelated(ctx.index,ctx.registry,current.page.entity,lang,rankOptions);
    const merged=new Map(primary.results.map(row=>[row.url,{
      url:row.url,title:row.title,published:row.published||'',score:row.score,
      exactEntity:row.exactEntity,manualInclude:row.manualInclude,
      sourceEntities:[current.page.entity],reason:'entity-ranking'
    }]));
    if(merged.size<limit){
      for(const hubId of entity?.hubs||[]){
        const hubRanked=Related.rankRelated(ctx.index,ctx.registry,hubId,lang,rankOptions);
        for(const row of hubRanked.results){
          if(merged.size>=limit)break;
          if(merged.has(row.url))continue;
          merged.set(row.url,{
            url:row.url,title:row.title,published:row.published||'',score:row.score,
            exactEntity:row.exactEntity,manualInclude:row.manualInclude,
            sourceEntities:[hubId],reason:'connected-hub-ranking'
          });
        }
        if(merged.size>=limit)break;
      }
    }
    items=[...merged.values()].slice(0,limit);
  }else{
    const route=routes.get(current.page.route);assert(route,'Unknown route '+current.page.route);
    const a=Related.rankRelated(ctx.index,ctx.registry,route.from,lang,rankOptions);
    const b=Related.rankRelated(ctx.index,ctx.registry,route.to,lang,rankOptions);
    items=mergeRouteReading({...a,entityId:route.from},{...b,entityId:route.to},limit);
  }
  return {type:'related_reading',pageId,lang,items};
}
function resolvePlaceholder(token,pageId,lang,ctx,options={}){
  assert(ctx.registry.locales?.includes(lang),'Unsupported locale '+lang);
  pageContext(pageId,ctx);
  const parsed=parsePlaceholder(token);validateAttrs(parsed.name,parsed.attrs,ctx.placeholderContract);
  if(parsed.name==='journey_cta')return resolveJourney(parsed.attrs,pageId,lang,ctx,options);
  if(parsed.name==='fare_table')return resolveFareTable(parsed.attrs,pageId,lang,ctx);
  if(parsed.name==='related_transport')return resolveRelatedTransport(pageId,lang,ctx,options);
  if(parsed.name==='related_reading')return resolveRelatedReading(pageId,lang,ctx,options);
  throw new Error('Unknown placeholder '+parsed.name);
}
function loadContext(root=process.cwd()){
  return {
    places:readJson(path.join(root,'seo/pages/places.json')),
    routes:readJson(path.join(root,'seo/pages/routes.json')),
    registry:readJson(path.join(root,'data/entities/poi.json')),
    routeCatalog:readJson(path.join(root,'data/deep-links/routes.json')),
    index:readJson(path.join(root,'seo/content-index/articles.json')),
    overrides:readJson(path.join(root,'seo/content-index/related-overrides.json')),
    fares:readJson(path.join(root,'seo/data/tourist-fares.json')),
    placeholderContract:readJson(path.join(root,'seo/content/PLACEHOLDER-CONTRACT.json')),
    landingI18n:readJson(path.join(root,'seo/content/LANDING-I18N.json'))
  };
}
function resolvePageBlocks(pageId,lang,ctx,options={}){
  const current=pageContext(pageId,ctx);
  const journey=current.kind==='route'
    ?resolveJourney({route:current.page.route},pageId,lang,ctx,options)
    :resolveJourney({to:current.page.entity,from:'current'},pageId,lang,ctx,options);
  return {
    pageId,lang,preview:!!options.includePlanned,
    journey_cta:journey,
    related_transport:resolveRelatedTransport(pageId,lang,ctx,options),
    related_reading:resolveRelatedReading(pageId,lang,ctx,options)
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--page')args.page=argv[++i];
    else if(a==='--lang')args.lang=argv[++i];
    else if(a==='--app-base')args.appBase=argv[++i];
    else if(a==='--transport-root')args.transportRoot=argv[++i];
    else if(a==='--include-planned')args.includePlanned=true;
  }
  return args;
}
function main(){
  const args=parseArgs(process.argv.slice(2));
  assert(args.page,'--page is required');assert(args.lang,'--lang is required');
  const ctx=loadContext();
  const result=resolvePageBlocks(args.page,args.lang,ctx,{
    appBase:args.appBase||'/trasporti',
    transportRoot:args.transportRoot,
    includePlanned:!!args.includePlanned
  });
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={
  compact,normalizeBase,joinPath,parsePlaceholder,validateAttrs,pageContext,
  landingSlug,landingLabel,landingHref,stableEntityPath,withQuery,
  fallbackJourneyLabel,resolveJourney,eligibleContext,haversineKm,
  formatFarePrice,resolveFareTable,
  resolveRelatedTransport,mergeRouteReading,resolveRelatedReading,
  resolvePlaceholder,loadContext,resolvePageBlocks
};
