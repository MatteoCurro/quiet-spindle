/* U.Venice 9.0 — unified search aggregation core.
   Pure orchestration/ranking layer. UI and Journey worker adapters are wired in later M3 steps. */
(function(g){
'use strict';

function normalize(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[’']/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
function clampLimit(value,fallback=8){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(1,Math.min(20,Math.round(n))):fallback;
}
function textScore(name,query){
  const n=normalize(name),q=normalize(query);
  if(!n||!q)return 999;
  if(n===q)return 0;
  if(n.startsWith(q))return 8+(n.length-q.length)/100;
  const words=n.split(' '),tokens=q.split(' ').filter(Boolean);
  if(words.some(w=>w===q))return 12;
  if(n.includes(q))return 18+(n.length-q.length)/100;
  if(tokens.length&&tokens.every(t=>n.includes(t)))return 28+tokens.length;
  return 999;
}
const SOURCE_BIAS=Object.freeze({
  'uv-entity':-12,
  stop:-8,
  'comune-venezia':-5,
  photon:0,
  saved:-14
});
const TYPE_BIAS=Object.freeze({
  poi:-6,
  airport:-6,
  transport_hub:-7,
  stop:-5,
  saved_place:-8,
  address:-4,
  street:-2,
  place:0
});
function inferType(row,source){
  if(row.type)return row.type;
  if(source==='stop')return 'stop';
  if(row.kind==='stop')return source==='photon'?'place':'stop';
  if(row.kind==='address'||row.house)return 'address';
  if(row.kind==='street')return 'street';
  if(row.place)return 'place';
  return 'place';
}
function identity(row){
  if(row.id)return 'id:'+row.id;
  const lat=Number(row.lat),lon=Number(row.lon);
  const pos=Number.isFinite(lat)&&Number.isFinite(lon)?lat.toFixed(4)+','+lon.toFixed(4):'';
  return 'soft:'+normalize(row.name)+'|'+pos;
}
function adapt(row,source,query){
  if(!row||!row.name)return null;
  const type=inferType(row,source);
  const provided=Number(row.score);
  let score=Number.isFinite(provided)?provided:textScore(row.name,query);
  /* Adapter sources already perform their own relevance filtering. A weak
     display-name match may still be valid (aliases/local context), so keep it
     with a large penalty instead of deleting it from the blended result set. */
  if(score>=999)score=70;
  score+=(SOURCE_BIAS[source]??0)+(TYPE_BIAS[type]??0);
  if(row.exactHouse)score-=8;
  if(row.match?.kind==='name')score-=3;
  return {
    id:row.id||null,
    type,
    kind:row.kind||type,
    name:row.name,
    lat:Number(row.lat),
    lon:Number(row.lon),
    source,
    score,
    priority:Number(row.entity?.priority||row.priority||0),
    entity:row.entity||null,
    raw:row
  };
}
function dedupe(rows){
  const best=new Map();
  for(const row of rows){
    const key=identity(row);
    const current=best.get(key);
    if(!current||row.score<current.score||(row.score===current.score&&row.priority>current.priority))best.set(key,row);
  }
  return [...best.values()];
}
async function safe(fn,query,context){
  if(typeof fn!=='function')return [];
  try{
    const rows=await fn(query,context);
    return Array.isArray(rows)?rows:[];
  }catch(_){return []}
}
function create(adapters={}){
  async function search(query,options={}){
    query=String(query||'').trim();
    if(query.length<2)return [];
    const limit=clampLimit(options.limit,8);
    const context={...options,query},buckets=new Map();
    const sources=[
      ['uv-entity',adapters.entities],
      ['stop',adapters.stops],
      ['comune-venezia',adapters.local],
      ['photon',adapters.remote],
      ['saved',adapters.saved]
    ];
    const rank=()=>{
      const rows=[];
      for(const [source] of sources)for(const row of buckets.get(source)||[]){
        const adapted=adapt(row,source,query);if(adapted)rows.push(adapted);
      }
      const allowed=options.types?new Set(options.types):null;
      return dedupe(rows)
        .filter(row=>!allowed||allowed.has(row.type))
        .sort((a,b)=>a.score-b.score||b.priority-a.priority||a.name.localeCompare(b.name,options.locale||'it'))
        .slice(0,limit);
    };
    await Promise.all(sources.map(async([source,fn])=>{
      buckets.set(source,await safe(fn,query,context));
      if(typeof options.onPartial==='function')options.onPartial(rank(),{source});
    }));
    return rank();
  }
  return Object.freeze({search});
}
function defaultAdapters(){
  return {
    entities:(q,ctx)=>g.UVTransitEntities?.search?.(q,{locale:ctx.locale,limit:ctx.sourceLimit||8,types:ctx.entityTypes}),
    local:q=>g.UVTransitPlaces?.searchLocal?.(q),
    remote:q=>g.UVTransitPlaces?.searchRemote?.(q)
  };
}
g.UVTransitSearchAggregator=Object.freeze({create,normalize,textScore,dedupe,defaultAdapters});
})(typeof window!=='undefined'?window:globalThis);
