#!/usr/bin/env node
'use strict';

/* U.Venice 9.0 — Unlock Venice editorial content scanner.
   WordPress REST first, then WordPress/Yoast sitemap fallback. */

const fs=require('fs');
const path=require('path');

const DEFAULT_CONFIG={
  schemaVersion:1,
  baseUrl:'https://www.unlockvenice.com/',
  locales:['it','en','fr','de'],
  defaultLocale:'it',
  timeoutMs:15000,
  concurrency:6,
  maxArticles:2000,
  rest:{enabled:true,path:'/wp-json/wp/v2/posts',perPage:100},
  sitemapCandidates:['/wp-sitemap.xml','/sitemap_index.xml','/post-sitemap.xml'],
  excludeUrlPatterns:['/category/','/tag/','/author/','/page/','/feed/']
};

function decodeEntities(value=''){
  return String(value)
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)||32))
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
function compactSpace(value=''){
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ').trim();
}
function unique(values){return [...new Set((values||[]).map(v=>compactSpace(v)).filter(Boolean))]}
function safeUrl(value,base){
  try{
    const u=new URL(value,base);u.hash='';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach(k=>u.searchParams.delete(k));
    if([...u.searchParams.keys()].length===0)u.search='';
    return u;
  }catch(_){return null}
}
function normalizeBase(value){
  const u=safeUrl(value||DEFAULT_CONFIG.baseUrl,DEFAULT_CONFIG.baseUrl);
  if(!u)throw new Error('Invalid baseUrl');
  if(!u.pathname.endsWith('/'))u.pathname+='/';
  return u.href;
}
function localeFromUrl(value,config=DEFAULT_CONFIG){
  const u=safeUrl(value,config.baseUrl);if(!u)return config.defaultLocale;
  const first=u.pathname.split('/').filter(Boolean)[0]?.toLowerCase()||'';
  return config.locales.includes(first)?first:config.defaultLocale;
}
function normalizeLocale(value,config=DEFAULT_CONFIG,url=''){
  const raw=String(value||'').toLowerCase().replace('_','-').split('-')[0];
  return config.locales.includes(raw)?raw:localeFromUrl(url,config);
}
function slugFromUrl(value){
  const u=safeUrl(value,'https://example.invalid/');if(!u)return '';
  const parts=u.pathname.split('/').filter(Boolean);return parts[parts.length-1]||'';
}
function keywordsFor(title,categories,tags){
  const stop=new Set(['the','and','for','with','from','della','degli','delle','dei','del','di','da','una','uno','les','des','pour','avec','die','der','das','und','von','mit']);
  const tokens=compactSpace([title,...(categories||[]),...(tags||[])].join(' '))
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x));
  return unique(tokens).slice(0,24);
}
function embeddedTerms(post,taxonomy){
  const groups=post?._embedded?.['wp:term'];if(!Array.isArray(groups))return [];
  const out=[];
  for(const group of groups)for(const term of (Array.isArray(group)?group:[]))if(String(term?.taxonomy||'')===taxonomy&&term?.name)out.push(term.name);
  return unique(out);
}
function normalizeRestPost(post,config){
  const url=safeUrl(post?.link,config.baseUrl);if(!url)return null;
  const categories=embeddedTerms(post,'category'),tags=embeddedTerms(post,'post_tag');
  const title=compactSpace(post?.title?.rendered||post?.title||''),excerpt=compactSpace(post?.excerpt?.rendered||post?.excerpt||'');
  return {
    url:url.href,
    lang:normalizeLocale(post?.lang||post?.wpml_current_language||post?.locale,config,url.href),
    title,
    slug:String(post?.slug||slugFromUrl(url.href)),
    published:String(post?.date_gmt||post?.date||''),
    categories,tags,entities:[],keywords:keywordsFor(title,categories,tags),excerpt
  };
}
function responseHeader(response,name){try{return response.headers?.get?.(name)||response.headers?.get?.(String(name).toLowerCase())||''}catch(_){return ''}}
function withTimeout(fetchImpl,url,options,timeoutMs){
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  return Promise.resolve(fetchImpl(url,{...(options||{}),signal:controller?.signal})).finally(()=>{if(timer)clearTimeout(timer)});
}
async function fetchJson(fetchImpl,url,config){
  const response=await withTimeout(fetchImpl,url,{headers:{Accept:'application/json','User-Agent':'U.Venice-SEO-Indexer/9.0'}},config.timeoutMs);
  if(!response?.ok)throw new Error('HTTP '+(response?.status||0)+' for '+url);
  return {response,data:await response.json()};
}
async function fetchText(fetchImpl,url,config){
  const response=await withTimeout(fetchImpl,url,{headers:{Accept:'text/html,application/xml;q=0.9,*/*;q=0.8','User-Agent':'U.Venice-SEO-Indexer/9.0'}},config.timeoutMs);
  if(!response?.ok)throw new Error('HTTP '+(response?.status||0)+' for '+url);
  return {response,text:await response.text()};
}
async function scanRest(fetchImpl,config){
  if(config.rest?.enabled===false)return {articles:[],adapter:'wordpress-rest',ok:false,error:'disabled'};
  const byUrl=new Map();let successfulRequests=0,lastError=null;
  for(const locale of config.locales){
    let page=1,totalPages=1;
    do{
      const endpoint=new URL(config.rest.path||'/wp-json/wp/v2/posts',config.baseUrl);
      endpoint.searchParams.set('per_page',String(config.rest.perPage||100));
      endpoint.searchParams.set('page',String(page));
      endpoint.searchParams.set('status','publish');
      endpoint.searchParams.set('_embed','wp:term');
      endpoint.searchParams.set('lang',locale);
      try{
        const {response,data}=await fetchJson(fetchImpl,endpoint.href,config);
        if(!Array.isArray(data))throw new Error('Unexpected REST payload');
        successfulRequests++;
        totalPages=Math.max(1,Math.min(100,Number(responseHeader(response,'x-wp-totalpages'))||1));
        for(const post of data){const row=normalizeRestPost(post,config);if(row)byUrl.set(row.url,row);if(byUrl.size>=config.maxArticles)break}
      }catch(error){lastError=String(error?.message||error);break}
      page++;
    }while(page<=totalPages&&byUrl.size<config.maxArticles);
  }
  return {articles:[...byUrl.values()],adapter:'wordpress-rest',ok:successfulRequests>0,requests:successfulRequests,error:lastError};
}
function xmlLocs(xml=''){
  const out=[],re=/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;let m;
  while((m=re.exec(xml)))out.push(compactSpace(m[1]));
  return unique(out);
}
function isSameHost(value,config){
  const u=safeUrl(value,config.baseUrl),base=safeUrl(config.baseUrl,config.baseUrl);return !!u&&!!base&&u.host===base.host;
}
function looksLikePostSitemap(value){
  const p=(safeUrl(value,'https://example.invalid/')?.pathname||'').toLowerCase();
  return /(?:wp-sitemap-posts-post-\d+|post-sitemap(?:\d+)?|sitemap-posts?)(?:\.xml)?$/.test(p)||/posts-post/.test(p);
}
function excludedUrl(value,config){
  const u=safeUrl(value,config.baseUrl);if(!u)return true;
  return (config.excludeUrlPatterns||[]).some(pattern=>u.pathname.includes(pattern));
}
function escapeRe(value){return String(value).replace(/[|\\{}()[\]^$+*?.-]/g,'\\$&')}
function metaContent(html,key,attr='property'){
  const esc=escapeRe(key),a=escapeRe(attr);
  const patterns=[
    new RegExp('<meta[^>]*'+a+'=["\\\']'+esc+'["\\\'][^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*>','i'),
    new RegExp('<meta[^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*'+a+'=["\\\']'+esc+'["\\\'][^>]*>','i')
  ];
  for(const re of patterns){const m=re.exec(html);if(m)return compactSpace(m[1])}
  return '';
}
function firstMatch(html,re){const m=re.exec(html);return m?compactSpace(m[1]):''}
function htmlLang(html,url,config){
  const m=/<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html);return normalizeLocale(m?.[1],config,url);
}
function termsFromHtml(html,kind){
  const out=[],re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){
    const attrs=m[1],text=compactSpace(m[2]);
    const href=/\bhref=["']([^"']+)["']/i.exec(attrs)?.[1]||'';
    const rel=/\brel=["']([^"']+)["']/i.exec(attrs)?.[1]||'';
    const yes=kind==='tag'?(/\/tag\//i.test(href)||/\btag\b/i.test(rel)):/\/category\//i.test(href);
    if(yes&&text)out.push(text);
  }
  return unique(out);
}
function looksLikeArticleHtml(html){
  return /<article\b/i.test(html)||/article:published_time/i.test(html)||/"@type"\s*:\s*"(?:Article|BlogPosting)"/i.test(html);
}
function normalizeHtmlArticle(html,url,config){
  if(!looksLikeArticleHtml(html))return null;
  const canonical=metaContent(html,'og:url')||firstMatch(html,/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)||url;
  const cleanUrl=safeUrl(canonical,config.baseUrl);if(!cleanUrl||excludedUrl(cleanUrl.href,config))return null;
  const title=metaContent(html,'og:title')||firstMatch(html,/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||firstMatch(html,/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const slug=slugFromUrl(cleanUrl.href);
  const lang=htmlLang(html,cleanUrl.href,config);
  if(!title||!slug||!config.locales.includes(lang))return null;
  const excerpt=metaContent(html,'description','name')||metaContent(html,'og:description')||firstMatch(html,/<article\b[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const published=metaContent(html,'article:published_time')||firstMatch(html,/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i);
  const categories=termsFromHtml(html,'category'),tags=termsFromHtml(html,'tag');
  return {url:cleanUrl.href,lang,title,slug,published,categories,tags,entities:[],keywords:keywordsFor(title,categories,tags),excerpt};
}
async function mapConcurrent(items,limit,worker){
  const queue=items.slice(),out=[],workers=[],n=Math.max(1,Math.min(Number(limit)||1,12));
  for(let i=0;i<n;i++)workers.push((async()=>{while(queue.length){const item=queue.shift();try{out.push(await worker(item))}catch(error){out.push({error:true,item,message:String(error?.message||error)})}}})());
  await Promise.all(workers);return out;
}
async function discoverPostUrls(fetchImpl,config){
  const candidates=(config.sitemapCandidates||[]).map(p=>new URL(p,config.baseUrl).href),postSitemaps=new Set(),pageUrls=new Set(),errors=[];
  for(const sitemapUrl of candidates){
    try{
      const {text}=await fetchText(fetchImpl,sitemapUrl,config),locs=xmlLocs(text);
      if(looksLikePostSitemap(sitemapUrl)){
        for(const loc of locs)if(isSameHost(loc,config)&&!excludedUrl(loc,config))pageUrls.add(safeUrl(loc,config.baseUrl).href);
      }else{
        for(const loc of locs)if(isSameHost(loc,config)&&/\.xml(?:\?|$)/i.test(loc)&&looksLikePostSitemap(loc))postSitemaps.add(loc);
      }
      if(pageUrls.size||postSitemaps.size)break;
    }catch(error){errors.push(String(error?.message||error))}
  }
  for(const sitemapUrl of postSitemaps){
    if(pageUrls.size>=config.maxArticles)break;
    try{
      const {text}=await fetchText(fetchImpl,sitemapUrl,config);
      for(const loc of xmlLocs(text)){if(isSameHost(loc,config)&&!excludedUrl(loc,config))pageUrls.add(safeUrl(loc,config.baseUrl).href);if(pageUrls.size>=config.maxArticles)break}
    }catch(error){errors.push(String(error?.message||error))}
  }
  return {urls:[...pageUrls].slice(0,config.maxArticles),errors};
}
async function scanSitemaps(fetchImpl,config){
  const discovered=await discoverPostUrls(fetchImpl,config);
  if(!discovered.urls.length)return {articles:[],adapter:'sitemap-html',ok:false,error:discovered.errors.join(' | ')||'no post URLs'};
  const rows=await mapConcurrent(discovered.urls,config.concurrency,async url=>normalizeHtmlArticle((await fetchText(fetchImpl,url,config)).text,url,config));
  const articles=rows.filter(row=>row&&!row.error);
  return {articles,adapter:'sitemap-html',ok:articles.length>0,errors:rows.filter(x=>x?.error).length,discovered:discovered.urls.length};
}
function mergeArticles(groups,config){
  const byUrl=new Map();
  for(const group of groups)for(const row of group?.articles||[]){
    if(!row?.url)continue;
    const normalizedRow={...row};
    normalizedRow.lang=normalizeLocale(normalizedRow.lang,config,normalizedRow.url);
    normalizedRow.slug=compactSpace(normalizedRow.slug)||slugFromUrl(normalizedRow.url);
    normalizedRow.title=compactSpace(normalizedRow.title);
    if(!normalizedRow.title||!normalizedRow.slug||!config.locales.includes(normalizedRow.lang))continue;

    const current=byUrl.get(normalizedRow.url);
    if(!current){byUrl.set(normalizedRow.url,normalizedRow);continue}
    const merged={...current};
    for(const key of ['title','slug','published','excerpt'])if(!merged[key]&&normalizedRow[key])merged[key]=normalizedRow[key];
    merged.lang=normalizeLocale(normalizedRow.lang||merged.lang,config,normalizedRow.url);
    merged.categories=unique([...(merged.categories||[]),...(normalizedRow.categories||[])]);
    merged.tags=unique([...(merged.tags||[]),...(normalizedRow.tags||[])]);
    merged.keywords=unique([...(merged.keywords||[]),...(normalizedRow.keywords||[])]);
    merged.entities=unique([...(merged.entities||[]),...(normalizedRow.entities||[])]);
    byUrl.set(normalizedRow.url,merged);
  }
  return [...byUrl.values()].filter(row=>row.url&&row.title&&row.slug&&config.locales.includes(row.lang))
    .sort((a,b)=>a.lang.localeCompare(b.lang)||(b.published||'').localeCompare(a.published||'')||a.url.localeCompare(b.url))
    .slice(0,config.maxArticles);
}
function countsByLanguage(articles,locales){return Object.fromEntries((locales||[]).map(lang=>[lang,articles.filter(a=>a.lang===lang).length]))}
function finalizeIndex(articles,config,adapters,now=new Date()){
  return {schemaVersion:1,generatedAt:now.toISOString(),baseUrl:config.baseUrl,locales:config.locales,sourceAdapters:adapters.filter(a=>a.ok).map(a=>a.adapter),articleCount:articles.length,countsByLanguage:countsByLanguage(articles,config.locales),articles};
}
function configWith(input={}){
  return {...DEFAULT_CONFIG,...input,rest:{...DEFAULT_CONFIG.rest,...(input.rest||{})},baseUrl:normalizeBase(input.baseUrl||DEFAULT_CONFIG.baseUrl),locales:unique(input.locales||DEFAULT_CONFIG.locales).map(x=>x.toLowerCase()),sitemapCandidates:input.sitemapCandidates||DEFAULT_CONFIG.sitemapCandidates,excludeUrlPatterns:input.excludeUrlPatterns||DEFAULT_CONFIG.excludeUrlPatterns};
}
async function scan({fetchImpl=globalThis.fetch,config:input={},now}={}){
  if(typeof fetchImpl!=='function')throw new Error('fetch is required');
  const config=configWith(input),rest=await scanRest(fetchImpl,config),restLangs=new Set(rest.articles.map(a=>a.lang));
  const needFallback=!rest.ok||config.locales.some(lang=>!restLangs.has(lang));
  const sitemap=needFallback?await scanSitemaps(fetchImpl,config):{articles:[],adapter:'sitemap-html',ok:false,error:'not-needed'};
  const articles=mergeArticles([rest,sitemap],config);
  return finalizeIndex(articles,config,[rest,sitemap],now||new Date());
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--config')args.config=argv[++i];else if(a==='--out')args.out=argv[++i];else if(a==='--base-url')args.baseUrl=argv[++i];else if(a==='--no-write')args.noWrite=true}
  return args;
}
async function main(){
  const args=parseArgs(process.argv.slice(2)),configPath=path.resolve(args.config||'seo/content-index/config.json');
  const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
  if(args.baseUrl)config.baseUrl=args.baseUrl;
  const index=await scan({config}),out=path.resolve(args.out||config.output||'seo/content-index/articles.json');
  if(!args.noWrite){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(index,null,2)+'\n','utf8')}
  process.stdout.write(JSON.stringify({articleCount:index.articleCount,countsByLanguage:index.countsByLanguage,sourceAdapters:index.sourceAdapters,out:args.noWrite?null:out})+'\n');
  if(index.articleCount===0)process.exitCode=2;
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1});

module.exports={DEFAULT_CONFIG,compactSpace,localeFromUrl,normalizeLocale,normalizeRestPost,xmlLocs,normalizeHtmlArticle,discoverPostUrls,scanRest,scanSitemaps,mergeArticles,finalizeIndex,configWith,scan};
