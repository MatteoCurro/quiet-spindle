#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');

const CORE_LOCALES=['it','en','fr','de'];
const ID_RE=/^(?:poi|hub|airport):uv_[a-z0-9_]+$/;
const SLUG_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES=new Set(['poi','transport_hub','airport']);

function fail(errors,message){errors.push(message)}
function validate(doc){
  const errors=[];
  if(!doc||doc.schemaVersion!==1)fail(errors,'schemaVersion must be 1');
  if(JSON.stringify(doc?.locales)!==JSON.stringify(CORE_LOCALES))fail(errors,'locales must be exactly it,en,fr,de');
  if(!Array.isArray(doc?.entities)||!doc.entities.length)fail(errors,'entities must be a non-empty array');

  const ids=new Set(),slugs=Object.fromEntries(CORE_LOCALES.map(l=>[l,new Map()]));
  for(const [index,e] of (doc?.entities||[]).entries()){
    const at='entities['+index+']';
    if(!ID_RE.test(String(e?.id||'')))fail(errors,at+'.id invalid: '+String(e?.id));
    else if(ids.has(e.id))fail(errors,'duplicate id: '+e.id); else ids.add(e.id);
    if(!TYPES.has(e?.type))fail(errors,at+'.type unsupported: '+String(e?.type));
    if(!String(e?.category||'').trim())fail(errors,at+'.category required');
    if(!Number.isFinite(e?.priority)||e.priority<0||e.priority>100)fail(errors,at+'.priority must be 0..100');

    const lat=Number(e?.location?.lat),lon=Number(e?.location?.lon);
    if(!Number.isFinite(lat)||lat<-90||lat>90)fail(errors,at+'.location.lat invalid');
    if(!Number.isFinite(lon)||lon<-180||lon>180)fail(errors,at+'.location.lon invalid');

    for(const locale of CORE_LOCALES){
      const name=String(e?.names?.[locale]||'').trim();
      if(!name)fail(errors,at+'.names.'+locale+' required');

      const aliases=e?.aliases?.[locale];
      if(!Array.isArray(aliases))fail(errors,at+'.aliases.'+locale+' must be an array');
      else if(aliases.some(v=>!String(v||'').trim()))fail(errors,at+'.aliases.'+locale+' contains blank value');

      const slug=String(e?.seo?.slugs?.[locale]||'').trim();
      if(!SLUG_RE.test(slug))fail(errors,at+'.seo.slugs.'+locale+' invalid: '+slug);
      else if(slugs[locale].has(slug))fail(errors,'duplicate '+locale+' slug: '+slug+' ('+e.id+' / '+slugs[locale].get(slug)+')');
      else slugs[locale].set(slug,e.id);

      const queries=e?.editorial?.queries?.[locale];
      if(!Array.isArray(queries)||!queries.length)fail(errors,at+'.editorial.queries.'+locale+' must contain at least one query');
      else if(queries.some(v=>!String(v||'').trim()))fail(errors,at+'.editorial.queries.'+locale+' contains blank value');
    }

    if(!Array.isArray(e?.hubs))fail(errors,at+'.hubs must be an array');
    if(!e?.external||typeof e.external!=='object')fail(errors,at+'.external required');
  }

  // Cross-reference hub relationships only after every ID has been collected.
  for(const e of (doc?.entities||[])){
    for(const ref of e.hubs||[]){
      if(!ids.has(ref))fail(errors,e.id+' references missing hub '+ref);
      else if(doc.entities.find(x=>x.id===ref)?.type!=='transport_hub')fail(errors,e.id+' hub reference is not a transport_hub: '+ref);
    }
  }

  return {ok:errors.length===0,errors,count:(doc?.entities||[]).length};
}

function main(){
  const file=process.argv[2]||path.join(__dirname,'..','data','entities','poi.json');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  const result=validate(doc);
  if(!result.ok){
    for(const error of result.errors)process.stderr.write('ERROR '+error+'\n');
    process.exitCode=1;return;
  }
  process.stdout.write('entities: '+result.count+' valid entities; IT/EN/FR/DE names, aliases, slugs and editorial queries OK\n');
}
if(require.main===module)main();
module.exports={validate,CORE_LOCALES,ID_RE,SLUG_RE};
