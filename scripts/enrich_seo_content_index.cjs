#!/usr/bin/env node
'use strict';

/* U.Venice 9.0 — deterministic entity/topic enrichment for editorial content. */

const fs=require('fs');
const path=require('path');

const DEFAULTS={minScore:6,maxEntitiesPerArticle:8,maxTopics:20};

function compact(value=''){return String(value||'').replace(/\s+/g,' ').trim()}
function normalize(value=''){
  return compact(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[’'‘´]/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function slug(value=''){
  return normalize(value).replace(/\s+/g,'-');
}
function unique(values){
  return [...new Set((values||[]).filter(Boolean))];
}
function entityTerms(entity,lang){
  const values=[];
  const name=entity?.names?.[lang]||entity?.names?.it;
  if(name)values.push({value:name,kind:'name',weight:1});
  for(const a of entity?.aliases?.[lang]||[])values.push({value:a,kind:'alias',weight:.9});
  for(const q of entity?.editorial?.queries?.[lang]||[])values.push({value:q,kind:'query',weight:.8});
  const seo=entity?.seo?.slugs?.[lang];
  if(seo)values.push({value:String(seo).replace(/-/g,' '),kind:'slug',weight:.75});
  const seen=new Set(),out=[];
  for(const item of values){
    const n=normalize(item.value);
    if(!n||n.length<4||seen.has(n))continue;
    seen.add(n);out.push({...item,normalized:n});
  }
  return out;
}
function containsPhrase(haystack,needle){
  if(!haystack||!needle)return false;
  return (' '+haystack+' ').includes(' '+needle+' ');
}
function taxonomy(article){
  return [...(article.categories||[]),...(article.tags||[])].map(normalize).filter(Boolean);
}
function termSpecificity(term){
  const tokens=term.normalized.split(' ').filter(Boolean);
  return {
    tokens:tokens.length,
    bonus:Math.min(3,Math.max(0,tokens.length-1)*1.5),
    singleDistinctive:tokens.length===1&&term.normalized.length>=5
  };
}
const ALIAS_CONTEXT=Object.freeze({
  bridge:['ponte','bridge','pont','brucke'],
  square:['piazza','square','place','platz'],
  airport:['aeroporto','airport','aeroport','flughafen','vce','tessera'],
  rail_station:['stazione','station','gare','bahnhof','ferrovia','fs','treno','train','rail','zug'],
  water_stop_group:['fermata','stop','arret','haltestelle','vaporetto','imbarcadero','pier'],
  interchange:['terminal','fermata','stop','station','stazione','vaporetto','sme']
});
function aliasAnchorAllowed(entity,term,title){
  const context=ALIAS_CONTEXT[entity?.category]||[];
  if(context.length){
    return context.some(word=>containsPhrase(title,word)||containsPhrase(term.normalized,word));
  }
  const spec=termSpecificity(term);
  return spec.tokens>=2||spec.singleDistinctive;
}
function scoreEntity(article,entity){
  const lang=article.lang||'it',terms=entityTerms(entity,lang);
  if(!terms.length)return {score:0,signals:[],anchor:false};
  const title=normalize(article.title),excerpt=normalize(article.excerpt);
  const taxes=taxonomy(article),keywords=(article.keywords||[]).map(normalize);
  let titleScore=0,taxonomyScore=0,excerptScore=0,keywordScore=0,anchor=false;
  let titleSignal='',taxonomySignal='',excerptSignal='',keywordSignal='';

  for(const term of terms){
    const spec=termSpecificity(term);
    const kindBase=term.kind==='name'?10:term.kind==='alias'?9:term.kind==='query'?8:7;

    const titleCanAnchor=term.kind==='name'||term.kind==='slug'||(term.kind==='alias'&&aliasAnchorAllowed(entity,term,title));
    if(titleCanAnchor&&containsPhrase(title,term.normalized)){
      let value=kindBase+spec.bonus;
      if(title===term.normalized)value+=4;
      if(value>titleScore){titleScore=value;titleSignal='title:'+term.kind}
      anchor=true;
    }

    if(term.kind==='name'||term.kind==='slug'){
      for(const tax of taxes){
        let value=0,signal='';
        if(tax===term.normalized){value=10+spec.bonus;signal='taxonomy:exact'}
        else if(containsPhrase(tax,term.normalized)){value=6+spec.bonus;signal='taxonomy:contains'}
        if(value>taxonomyScore){taxonomyScore=value;taxonomySignal=signal}
        if(value>0)anchor=true;
      }
    }

    if((spec.tokens>=2||spec.singleDistinctive)&&containsPhrase(excerpt,term.normalized)){
      const value=(term.kind==='query'?1:2)+Math.min(2,spec.bonus);
      if(value>excerptScore){excerptScore=value;excerptSignal='excerpt:'+term.kind}
    }

    if(spec.singleDistinctive&&keywords.some(k=>k===term.normalized)){
      const value=term.kind==='query'?.5:1;
      if(value>keywordScore){keywordScore=value;keywordSignal='keyword:exact'}
    }
  }

  if(!anchor)return {score:0,signals:[],anchor:false};
  const score=titleScore+taxonomyScore+excerptScore+keywordScore;
  const signals=unique([titleSignal,taxonomySignal,excerptSignal,keywordSignal]);
  return {score:Number(score.toFixed(2)),signals,anchor:true};
}
function topicsFor(article,matchedEntities,maxTopics=DEFAULTS.maxTopics){
  const out=[];
  for(const c of article.categories||[]){const s=slug(c);if(s)out.push('category:'+s)}
  for(const t of article.tags||[]){const s=slug(t);if(s)out.push('tag:'+s)}
  for(const e of matchedEntities){
    if(e.category)out.push('entity-category:'+slug(e.category));
    if(e.type)out.push('entity-type:'+slug(e.type));
  }
  return unique(out).slice(0,maxTopics);
}
function enrichArticle(article,registry,options=DEFAULTS){
  const opts={...DEFAULTS,...options},ranked=[];
  for(const entity of registry.entities||[]){
    const result=scoreEntity(article,entity);
    if(result.score>=opts.minScore)ranked.push({entity,score:result.score});
  }
  ranked.sort((a,b)=>(b.score-a.score)||(Number(b.entity.priority||0)-Number(a.entity.priority||0))||String(a.entity.id).localeCompare(String(b.entity.id)));
  const matched=ranked.slice(0,opts.maxEntitiesPerArticle).map(x=>x.entity);
  return {...article,entities:matched.map(e=>e.id),topics:topicsFor(article,matched,opts.maxTopics)};
}
function enrichIndex(index,registry,options={}){
  if(index?.schemaVersion!==1||!Array.isArray(index.articles))throw new Error('Invalid content index');
  if(registry?.schemaVersion!==1||!Array.isArray(registry.entities))throw new Error('Invalid entity registry');
  const opts={...DEFAULTS,...options};
  const articles=index.articles.map(row=>enrichArticle(row,registry,opts));
  const matchedArticles=articles.filter(a=>a.entities.length).length;
  const entityLinks=articles.reduce((n,a)=>n+a.entities.length,0);
  return {
    ...index,
    enrichment:{
      schemaVersion:1,
      strategy:'deterministic-registry-match',
      minScore:opts.minScore,
      maxEntitiesPerArticle:opts.maxEntitiesPerArticle,
      matchedArticles,
      entityLinks
    },
    articles
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--index')args.index=argv[++i];
    else if(a==='--entities')args.entities=argv[++i];
    else if(a==='--out')args.out=argv[++i];
    else if(a==='--min-score')args.minScore=Number(argv[++i]);
    else if(a==='--no-write')args.noWrite=true;
  }
  return args;
}
function main(){
  const args=parseArgs(process.argv.slice(2));
  const indexPath=path.resolve(args.index||'seo/content-index/articles.json');
  const entityPath=path.resolve(args.entities||'data/entities/poi.json');
  const outPath=path.resolve(args.out||indexPath);
  const index=JSON.parse(fs.readFileSync(indexPath,'utf8'));
  const registry=JSON.parse(fs.readFileSync(entityPath,'utf8'));
  const enriched=enrichIndex(index,registry,{minScore:Number.isFinite(args.minScore)?args.minScore:DEFAULTS.minScore});
  if(!args.noWrite)fs.writeFileSync(outPath,JSON.stringify(enriched,null,2)+'\n','utf8');
  process.stdout.write(JSON.stringify({articleCount:enriched.articleCount,matchedArticles:enriched.enrichment.matchedArticles,entityLinks:enriched.enrichment.entityLinks,out:args.noWrite?null:outPath})+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={DEFAULTS,normalize,slug,entityTerms,termSpecificity,aliasAnchorAllowed,scoreEntity,topicsFor,enrichArticle,enrichIndex};
