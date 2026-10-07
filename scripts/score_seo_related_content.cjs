#!/usr/bin/env node
'use strict';

/* U.Venice 9.0 — editorial related-content scoring.
   This layer intentionally differs from entity extraction:
   extraction answers "is this article about this exact entity?";
   scoring answers "is this article useful on this entity's landing page?". */

const fs=require('fs');
const path=require('path');

const DEFAULTS={
  limit:6,
  minScore:12,
  freshnessDays:{fresh:180,recent:365,evergreen:730}
};

const GENERIC_TOKENS=new Set([
  'venezia','venice','venise','venedig',
  'italia','italy','italie','italien',
  'ponte','bridge','pont','brucke',
  'piazza','square','place','platz',
  'stazione','station','gare','bahnhof','ferrovia','fs',
  'aeroporto','airport','aeroport','flughafen',
  'trasporto','trasporti','transport','transports','verkehr',
  'treno','train','rail','zug',
  'fermata','stop','arret','haltestelle',
  'vaporetto','bus','tram','ferry',
  'come','arrivare','raggiungere','getting','reach','reaching',
  'aller','rejoindre','anreise','erreichen',
  'guida','guide','visita','visit','visiter','besuch'
]);

const STOPWORDS=new Set([
  'a','al','alla','alle','allo','ai','agli','da','dal','dalla','dalle','dello','degli','dei','del','di','e','ed','il','la','le','lo','i','gli','un','una','uno','per','con','su','tra','fra',
  'a','an','and','at','by','for','from','in','of','on','the','to','with',
  'a','au','aux','avec','dans','de','des','du','en','et','la','le','les','pour','sur',
  'am','an','auf','aus','bei','der','die','das','den','dem','des','ein','eine','im','in','mit','und','von','zu','zum','zur'
]);

function compact(value=''){return String(value||'').replace(/\s+/g,' ').trim()}
function normalize(value=''){
  return compact(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[’'‘´]/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function unique(values){return [...new Set((values||[]).filter(Boolean))]}
function containsPhrase(haystack,needle){
  if(!haystack||!needle)return false;
  return (' '+haystack+' ').includes(' '+needle+' ');
}
function phraseTokens(value){
  return normalize(value).split(' ').filter(Boolean);
}
function distinctiveTokens(value){
  return unique(phraseTokens(value).filter(t=>t.length>=3&&!STOPWORDS.has(t)&&!GENERIC_TOKENS.has(t)));
}
function allTokensPresent(haystack,tokens){
  return tokens.length>0&&tokens.every(t=>containsPhrase(haystack,t));
}
function articleFields(article){
  const categories=(article.categories||[]).map(normalize).filter(Boolean);
  const tags=(article.tags||[]).map(normalize).filter(Boolean);
  const taxonomy=[...categories,...tags];
  return {
    title:normalize(article.title),
    excerpt:normalize(article.excerpt),
    slug:normalize(String(article.slug||'').replace(/-/g,' ')),
    taxonomy,
    taxonomyText:taxonomy.join(' '),
    keywords:(article.keywords||[]).map(normalize).filter(Boolean),
    keywordText:(article.keywords||[]).map(normalize).filter(Boolean).join(' ')
  };
}
function localizedTerms(entity,lang){
  const canonical=normalize(entity?.names?.[lang]||entity?.names?.it||'');
  const aliases=unique((entity?.aliases?.[lang]||[]).map(normalize).filter(Boolean));
  const queries=unique((entity?.editorial?.queries?.[lang]||[]).map(normalize).filter(Boolean));
  const seoSlug=normalize(String(entity?.seo?.slugs?.[lang]||'').replace(/-/g,' '));
  return {canonical,aliases,queries,seoSlug};
}
function phraseScore(fields,phrase,weights){
  if(!phrase)return {score:0,signal:null};
  let best=0,signal=null;
  if(containsPhrase(fields.title,phrase)&&weights.title>best){best=weights.title;signal='title'}
  if(fields.taxonomy.some(t=>containsPhrase(t,phrase))&&weights.taxonomy>best){best=weights.taxonomy;signal='taxonomy'}
  if(containsPhrase(fields.excerpt,phrase)&&weights.excerpt>best){best=weights.excerpt;signal='excerpt'}
  if(fields.keywords.some(k=>k===phrase||containsPhrase(k,phrase))&&weights.keyword>best){best=weights.keyword;signal='keyword'}
  return {score:best,signal};
}
function queryCoverageScore(fields,query){
  const tokens=distinctiveTokens(query);
  if(!tokens.length)return {score:0,signal:null,tokens:[]};
  if(allTokensPresent(fields.title,tokens))return {score:tokens.length===1?16:20,signal:'query-title-coverage',tokens};
  if(allTokensPresent(fields.taxonomyText,tokens))return {score:tokens.length===1?14:18,signal:'query-taxonomy-coverage',tokens};
  if(allTokensPresent(fields.excerpt,tokens))return {score:tokens.length===1?5:8,signal:'query-excerpt-coverage',tokens};
  if(allTokensPresent(fields.keywordText,tokens))return {score:tokens.length===1?4:6,signal:'query-keyword-coverage',tokens};
  return {score:0,signal:null,tokens};
}
function freshnessScore(published,now=new Date(),thresholds=DEFAULTS.freshnessDays){
  if(!published)return {score:0,signal:null};
  const date=new Date(published);
  if(Number.isNaN(date.getTime()))return {score:0,signal:null};
  const ageDays=Math.max(0,(now.getTime()-date.getTime())/86400000);
  if(ageDays<=thresholds.fresh)return {score:4,signal:'freshness:<180d'};
  if(ageDays<=thresholds.recent)return {score:3,signal:'freshness:<365d'};
  if(ageDays<=thresholds.evergreen)return {score:1.5,signal:'freshness:<730d'};
  return {score:0,signal:null};
}
function normalizeUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    u.hash='';
    return u.href.replace(/\/$/,'');
  }catch(_){return ''}
}
function articleMatchesRef(article,ref){
  const value=compact(ref);
  if(!value)return false;
  if(/^https?:\/\//i.test(value)){
    return normalizeUrl(article?.url)===normalizeUrl(value);
  }
  return compact(article?.slug)===value;
}
function overrideSpec(overrides,entityId,lang){
  return overrides?.entities?.[entityId]?.[lang]||{include:[],exclude:[]};
}
function validateOverrides(overrides,index,registry){
  if(overrides==null)return true;
  if(overrides.schemaVersion!==1||!overrides.entities||typeof overrides.entities!=='object'||Array.isArray(overrides.entities))throw new Error('Invalid related-content overrides schema');
  const entityIds=new Set((registry.entities||[]).map(e=>e.id));
  const locales=new Set(registry.locales||[]);
  for(const [entityId,langs] of Object.entries(overrides.entities)){
    if(!entityIds.has(entityId))throw new Error('Override references unknown entity '+entityId);
    if(!langs||typeof langs!=='object'||Array.isArray(langs))throw new Error('Invalid override locale map for '+entityId);
    for(const [lang,spec] of Object.entries(langs)){
      if(!locales.has(lang))throw new Error('Override uses unsupported locale '+lang+' for '+entityId);
      if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('Invalid override spec for '+entityId+' '+lang);
      for(const key of ['include','exclude']){
        if(spec[key]!=null&&!Array.isArray(spec[key]))throw new Error('Override '+key+' must be an array for '+entityId+' '+lang);
        const refs=spec[key]||[];
        const seen=new Set();
        for(const ref of refs){
          if(typeof ref!=='string'||!compact(ref))throw new Error('Override '+key+' contains an invalid article ref for '+entityId+' '+lang);
          const k=compact(ref);
          if(seen.has(k))throw new Error('Duplicate override '+key+' ref '+k+' for '+entityId+' '+lang);
          seen.add(k);
          const matches=index.articles.filter(a=>a.lang===lang&&articleMatchesRef(a,k));
          if(matches.length!==1)throw new Error('Override '+key+' ref must resolve to exactly one '+lang+' article: '+k+' ('+matches.length+' matches)');
        }
      }
    }
  }
  return true;
}
function scoreArticle(article,entity,lang,options={}){
  const opts={...DEFAULTS,...options};
  if(!article||!entity||article.lang!==lang)return {score:0,baseScore:0,signals:[]};

  const fields=articleFields(article),terms=localizedTerms(entity,lang);
  const signals=[];
  let baseScore=0;

  if((article.entities||[]).includes(entity.id)){
    baseScore+=100;
    signals.push({type:'entity-exact',score:100});
  }

  let bestIdentity={score:0,signal:null,label:null};
  const canonical=phraseScore(fields,terms.canonical,{title:60,taxonomy:46,excerpt:20,keyword:12});
  if(canonical.score>bestIdentity.score)bestIdentity={...canonical,label:'canonical'};

  for(const alias of terms.aliases){
    const hit=phraseScore(fields,alias,{title:44,taxonomy:34,excerpt:14,keyword:8});
    if(hit.score>bestIdentity.score)bestIdentity={...hit,label:'alias'};
  }
  if(terms.seoSlug){
    const hit=phraseScore(fields,terms.seoSlug,{title:48,taxonomy:36,excerpt:14,keyword:8});
    if(fields.slug===terms.seoSlug&&55>hit.score){hit.score=55;hit.signal='slug'}
    if(hit.score>bestIdentity.score)bestIdentity={...hit,label:'seo-slug'};
  }
  let bestQuery={score:0,signal:null,query:null};
  for(const query of terms.queries){
    const phrase=phraseScore(fields,query,{title:30,taxonomy:24,excerpt:12,keyword:8});
    if(phrase.score>bestQuery.score)bestQuery={score:phrase.score,signal:'query-'+phrase.signal,query};
    const coverage=queryCoverageScore(fields,query);
    if(coverage.score>bestQuery.score)bestQuery={score:coverage.score,signal:coverage.signal,query,tokens:coverage.tokens};
  }
  if(bestIdentity.score>=bestQuery.score&&bestIdentity.score){
    baseScore+=bestIdentity.score;
    signals.push({type:'identity-phrase',source:bestIdentity.label,field:bestIdentity.signal,score:bestIdentity.score});
  }else if(bestQuery.score){
    baseScore+=bestQuery.score;
    signals.push({type:'editorial-query',query:bestQuery.query,field:bestQuery.signal,score:bestQuery.score});
  }

  const entityCategory='entity-category:'+normalize(entity.category).replace(/\s+/g,'-');
  if((article.topics||[]).includes(entityCategory)){
    baseScore+=3;
    signals.push({type:'topic-category',score:3});
  }

  if(baseScore<opts.minScore)return {score:0,baseScore,signals:[]};

  const freshness=freshnessScore(article.published,options.now||new Date(),opts.freshnessDays);
  const score=Number((baseScore+freshness.score).toFixed(2));
  if(freshness.score)signals.push({type:'freshness',field:freshness.signal,score:freshness.score});

  return {score,baseScore:Number(baseScore.toFixed(2)),signals};
}
function rankRelated(index,registry,entityId,lang,options={}){
  const opts={...DEFAULTS,...options};
  if(index?.schemaVersion!==1||!Array.isArray(index.articles))throw new Error('Invalid content index');
  if(registry?.schemaVersion!==1||!Array.isArray(registry.entities))throw new Error('Invalid entity registry');
  const entity=registry.entities.find(e=>e.id===entityId);
  if(!entity)throw new Error('Unknown entity '+entityId);
  const locale=String(lang||'').toLowerCase();
  if(!registry.locales?.includes(locale))throw new Error('Unsupported locale '+locale);

  const overrides=opts.overrides||null;
  if(overrides)validateOverrides(overrides,index,registry);
  const spec=overrideSpec(overrides,entityId,locale);
  const includeRefs=spec.include||[],excludeRefs=spec.exclude||[];
  const includeOrder=new Map();
  includeRefs.forEach((ref,i)=>{
    const article=index.articles.find(a=>a.lang===locale&&articleMatchesRef(a,ref));
    if(article)includeOrder.set(article.url,i);
  });
  const excluded=new Set();
  for(const ref of excludeRefs){
    const article=index.articles.find(a=>a.lang===locale&&articleMatchesRef(a,ref));
    if(article)excluded.add(article.url);
  }

  const results=[];
  for(const article of index.articles){
    if(article.lang!==locale||excluded.has(article.url))continue;
    const manualInclude=includeOrder.has(article.url);
    const scored=scoreArticle(article,entity,locale,opts);
    if(!manualInclude&&scored.score<opts.minScore)continue;
    const signals=scored.signals.slice();
    if(manualInclude)signals.unshift({type:'manual-include',score:0,order:includeOrder.get(article.url)});
    results.push({
      url:article.url,
      lang:article.lang,
      title:article.title,
      slug:article.slug,
      published:article.published||'',
      score:scored.score,
      baseScore:scored.baseScore,
      signals,
      exactEntity:(article.entities||[]).includes(entityId),
      manualInclude,
      manualOrder:manualInclude?includeOrder.get(article.url):null
    });
  }
  results.sort((a,b)=>
    (Number(b.manualInclude)-Number(a.manualInclude))||
    ((a.manualInclude&&b.manualInclude)?a.manualOrder-b.manualOrder:0)||
    (b.score-a.score)||
    (Number(b.exactEntity)-Number(a.exactEntity))||
    String(b.published||'').localeCompare(String(a.published||''))||
    String(a.url).localeCompare(String(b.url))
  );
  return {
    entityId,
    lang:locale,
    limit:opts.limit,
    minScore:opts.minScore,
    totalCandidates:results.length,
    overridesApplied:{include:includeOrder.size,exclude:excluded.size},
    results:results.slice(0,opts.limit)
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--index')args.index=argv[++i];
    else if(a==='--entities')args.entities=argv[++i];
    else if(a==='--entity')args.entity=argv[++i];
    else if(a==='--lang')args.lang=argv[++i];
    else if(a==='--limit')args.limit=Number(argv[++i]);
    else if(a==='--min-score')args.minScore=Number(argv[++i]);
    else if(a==='--overrides')args.overrides=argv[++i];
    else if(a==='--now')args.now=argv[++i];
  }
  return args;
}
function main(){
  const args=parseArgs(process.argv.slice(2));
  if(!args.entity)throw new Error('--entity is required');
  if(!args.lang)throw new Error('--lang is required');
  const index=JSON.parse(fs.readFileSync(path.resolve(args.index||'seo/content-index/articles.json'),'utf8'));
  const registry=JSON.parse(fs.readFileSync(path.resolve(args.entities||'data/entities/poi.json'),'utf8'));
  const overridesPath=path.resolve(args.overrides||'seo/content-index/related-overrides.json');
  const overrides=fs.existsSync(overridesPath)?JSON.parse(fs.readFileSync(overridesPath,'utf8')):null;
  const ranked=rankRelated(index,registry,args.entity,args.lang,{
    limit:Number.isFinite(args.limit)?Math.max(1,Math.min(20,args.limit)):DEFAULTS.limit,
    minScore:Number.isFinite(args.minScore)?args.minScore:DEFAULTS.minScore,
    overrides,
    now:args.now?new Date(args.now):new Date()
  });
  process.stdout.write(JSON.stringify(ranked,null,2)+'\n');
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={
  DEFAULTS,GENERIC_TOKENS,STOPWORDS,compact,normalize,distinctiveTokens,
  articleFields,localizedTerms,phraseScore,queryCoverageScore,freshnessScore,
  normalizeUrl,articleMatchesRef,overrideSpec,validateOverrides,
  scoreArticle,rankRelated
};
