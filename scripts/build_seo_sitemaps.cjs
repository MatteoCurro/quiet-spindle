#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const Resolver=require('./resolve_seo_placeholders.cjs');
const Landing=require('./build_seo_landing_preview.cjs');

function xml(value=''){
  return String(value).replace(/[<>&"']/g,ch=>({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'
  })[ch]);
}
function clampPriority(value){
  const n=Number(value);
  if(!Number.isFinite(n))return 0.5;
  return Math.max(0,Math.min(1,n));
}
function manifestAllowed(state,includePlanned=false){
  return includePlanned
    ?['planned','draft','ready'].includes(String(state||''))
    :String(state||'')==='ready';
}
function copyAllowed(status,includePlanned=false){
  return includePlanned
    ?['draft','ready'].includes(String(status||''))
    :String(status||'')==='ready';
}
function copyPath(root,context,lang){
  const key=context.page.copyKey;
  if(!key)throw new Error('Missing copyKey for '+context.page.id);
  return path.join(root,'seo','content',context.kind,key,lang+'.md');
}
function validateCopy(root,context,lang,includePlanned=false){
  const file=copyPath(root,context,lang);
  if(!fs.existsSync(file))return {ok:false,reason:'missing-copy',file};
  const parsed=Landing.parseFrontmatter(fs.readFileSync(file,'utf8'));
  const meta=parsed.meta;
  if(meta.pageId!==context.page.id)return {ok:false,reason:'page-id-mismatch',file};
  if(meta.kind!==context.kind)return {ok:false,reason:'kind-mismatch',file};
  if(meta.lang!==lang)return {ok:false,reason:'lang-mismatch',file};
  if(!copyAllowed(meta.status,includePlanned))return {ok:false,reason:'copy-not-ready',file,status:meta.status};
  if(context.kind==='route'&&meta.routeId&&meta.routeId!==context.page.route)return {ok:false,reason:'route-id-mismatch',file};
  if(context.kind==='place'&&meta.entityId&&meta.entityId!==context.page.entity)return {ok:false,reason:'entity-id-mismatch',file};
  return {ok:true,file,status:meta.status};
}
function pageClusterStatus(root,context,includePlanned=false){
  if(!context.page.enabled)return {ok:false,reason:'disabled',copies:[]};
  if(!manifestAllowed(context.page.contentState,includePlanned)){
    return {ok:false,reason:'manifest-not-ready',state:context.page.contentState,copies:[]};
  }
  const languages=context.page.languages||[];
  if(!languages.length)return {ok:false,reason:'no-languages',copies:[]};
  const copies=languages.map(lang=>({lang,...validateCopy(root,context,lang,includePlanned)}));
  const failed=copies.find(item=>!item.ok);
  if(failed)return {ok:false,reason:failed.reason,copies};
  return {ok:true,copies};
}
function allContexts(ctx){
  return [
    ...ctx.places.pages.map(page=>({kind:'place',page,manifest:ctx.places})),
    ...ctx.routes.pages.map(page=>({kind:'route',page,manifest:ctx.routes}))
  ];
}
function renderUrl(url,alternates,priority){
  const links=alternates.map(item=>
    '    <xhtml:link rel="alternate" hreflang="'+xml(item.lang)+'" href="'+xml(item.href)+'" />'
  ).join('\n');
  return [
    '  <url>',
    '    <loc>'+xml(url)+'</loc>',
    links,
    '    <priority>'+clampPriority(priority).toFixed(2)+'</priority>',
    '  </url>'
  ].join('\n');
}
function renderUrlset(entries){
  const body=entries.map(entry=>renderUrl(entry.loc,entry.alternates,entry.priority)).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    body,
    '</urlset>',
    ''
  ].join('\n');
}
function renderSitemapIndex(siteOrigin){
  const origin=Landing.normalizeOrigin(siteOrigin);
  const names=['sitemap-transport-places.xml','sitemap-transport-routes.xml'];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...names.map(name=>'  <sitemap><loc>'+xml(origin+'/'+name)+'</loc></sitemap>'),
    '</sitemapindex>',
    ''
  ].join('\n');
}
function buildSitemaps(options={}){
  const root=path.resolve(options.root||process.cwd());
  const outDir=path.resolve(root,options.outDir||'build/seo-sitemaps');
  const includePlanned=!!options.includePlanned;
  const siteOrigin=Landing.normalizeOrigin(options.siteOrigin);
  const ctx=options.ctx||Resolver.loadContext(root);
  const buckets={place:[],route:[]};
  const skipped=[];

  for(const context of allContexts(ctx)){
    const status=pageClusterStatus(root,context,includePlanned);
    if(!status.ok){
      skipped.push({pageId:context.page.id,kind:context.kind,reason:status.reason,state:context.page.contentState});
      continue;
    }
    for(const lang of context.page.languages){
      const links=Landing.buildSeoLinks(context.page.id,lang,ctx,{siteOrigin});
      buckets[context.kind].push({
        pageId:context.page.id,
        lang,
        loc:links.canonical,
        alternates:links.alternates,
        priority:context.page.priority
      });
    }
  }

  fs.mkdirSync(outDir,{recursive:true});
  const files={
    places:path.join(outDir,'sitemap-transport-places.xml'),
    routes:path.join(outDir,'sitemap-transport-routes.xml'),
    index:path.join(outDir,'sitemap-transport.xml')
  };
  fs.writeFileSync(files.places,renderUrlset(buckets.place));
  fs.writeFileSync(files.routes,renderUrlset(buckets.route));
  fs.writeFileSync(files.index,renderSitemapIndex(siteOrigin));

  return {
    includePlanned,
    siteOrigin,
    files,
    placeUrls:buckets.place.length,
    routeUrls:buckets.route.length,
    totalUrls:buckets.place.length+buckets.route.length,
    skipped
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--include-planned')args.includePlanned=true;
    else if(a==='--out-dir')args.outDir=argv[++i];
    else if(a==='--site-origin')args.siteOrigin=argv[++i];
  }
  return args;
}
function main(){
  const result=buildSitemaps(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module){
  try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}
}

module.exports={
  xml,clampPriority,manifestAllowed,copyAllowed,copyPath,validateCopy,pageClusterStatus,
  allContexts,renderUrl,renderUrlset,renderSitemapIndex,buildSitemaps
};
