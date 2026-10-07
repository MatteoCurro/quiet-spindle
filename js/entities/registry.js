/* U.Venice 9.0 — multilingual entity registry runtime.
   Loads stable POI/hub/airport identities. Search aggregation remains owned by M3. */
(function(g){
'use strict';

const config=Object.assign({url:'data/entities/poi.json'},g.UVTransitEntitiesConfig||{});
let promise=null,registry=null,index=null;

function normalize(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[’']/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
function locale(){
  const current=g.UVTransitI18n?.getLocale?.()||document.documentElement?.lang||'it';
  return ['it','en','fr','de'].includes(current)?current:'it';
}
function buildIndex(doc){
  const byId=new Map(),terms=[];
  for(const entity of doc.entities||[]){
    byId.set(entity.id,entity);
    for(const lang of doc.locales||['it','en','fr','de']){
      const name=entity.names?.[lang];
      if(name)terms.push({entity,lang,value:name,key:normalize(name),kind:'name'});
      for(const alias of entity.aliases?.[lang]||[])terms.push({entity,lang,value:alias,key:normalize(alias),kind:'alias'});
      const slug=entity.seo?.slugs?.[lang];
      if(slug)terms.push({entity,lang,value:slug,key:normalize(slug),kind:'slug'});
    }
  }
  return {byId,terms};
}
async function load(){
  if(registry)return registry;
  if(promise)return promise;
  promise=(async()=>{
    const response=await fetch(config.url,{cache:'default'});
    if(!response.ok)throw new Error('Entity registry unavailable ('+response.status+')');
    const doc=await response.json();
    if(doc?.schemaVersion!==1||!Array.isArray(doc.entities))throw new Error('Entity registry invalid');
    registry=Object.freeze(doc);
    index=buildIndex(doc);
    return registry;
  })().catch(error=>{promise=null;throw error});
  return promise;
}
function display(entity,lang=locale()){
  if(!entity)return '';
  return entity.names?.[lang]||entity.names?.it||entity.id;
}
async function get(id){
  await load();
  return index.byId.get(String(id||''))||null;
}
async function hubs(id){
  const entity=await get(id);
  if(!entity)return [];
  return (entity.hubs||[]).map(ref=>index.byId.get(ref)).filter(Boolean);
}
async function resolveSlug(slug,lang=locale()){
  await load();
  const key=normalize(slug);
  const hit=index.terms.find(t=>t.lang===lang&&t.kind==='slug'&&t.key===key)
    ||index.terms.find(t=>t.kind==='slug'&&t.key===key);
  return hit?.entity||null;
}
function scoreTerm(term,q,lang){
  if(!q||!term.key)return 999;
  let score=999;
  if(term.key===q)score=0;
  else if(term.key.startsWith(q))score=8+(term.key.length-q.length)/100;
  else if(term.key.includes(q))score=20+(term.key.length-q.length)/100;
  else{
    const tokens=q.split(' ').filter(Boolean);
    if(tokens.length&&tokens.every(token=>term.key.includes(token)))score=32+tokens.length;
  }
  if(score>=999)return score;
  if(term.lang===lang)score-=3;
  if(term.kind==='name')score-=2;
  return score;
}
async function search(query,options={}){
  await load();
  const q=normalize(query),lang=options.locale||locale();
  if(q.length<2)return [];
  const allowed=options.types?new Set(options.types):null,best=new Map();
  for(const term of index.terms){
    if(allowed&&!allowed.has(term.entity.type))continue;
    const score=scoreTerm(term,q,lang);
    if(score>=999)continue;
    const weighted=score-(Number(term.entity.priority)||0)/100;
    const current=best.get(term.entity.id);
    if(!current||weighted<current.score)best.set(term.entity.id,{entity:term.entity,score:weighted,match:term});
  }
  return [...best.values()]
    .sort((a,b)=>a.score-b.score||(b.entity.priority||0)-(a.entity.priority||0)||display(a.entity,lang).localeCompare(display(b.entity,lang),lang))
    .slice(0,Math.max(1,Number(options.limit)||8))
    .map(row=>({
      id:row.entity.id,
      type:row.entity.type,
      category:row.entity.category,
      name:display(row.entity,lang),
      lat:row.entity.location.lat,
      lon:row.entity.location.lon,
      entity:row.entity,
      source:'uv-entity',
      match:{kind:row.match.kind,lang:row.match.lang,value:row.match.value},
      score:row.score
    }));
}
function resetForTests(){promise=null;registry=null;index=null}

g.UVTransitEntities=Object.freeze({load,get,hubs,search,resolveSlug,display,normalize,resetForTests});
})(window);
