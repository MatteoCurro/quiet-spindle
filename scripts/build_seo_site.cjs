#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const Resolver=require('./resolve_seo_placeholders.cjs');
const Landing=require('./build_seo_landing_preview.cjs');
const Sitemaps=require('./build_seo_sitemaps.cjs');

function allContexts(ctx){
  return [
    ...ctx.places.pages.map(page=>({kind:'place',page,manifest:ctx.places})),
    ...ctx.routes.pages.map(page=>({kind:'route',page,manifest:ctx.routes}))
  ];
}
function copySource(root,context,lang){
  return path.join(root,'seo','content',context.kind,context.page.copyKey,lang+'.md');
}
function outputFile(root,outDir,context,lang,ctx){
  const href=Resolver.landingHref(context,lang,ctx);
  const rel=href.replace(/^\/+|\/+$/g,'');
  return path.join(root,outDir,rel,'index.html');
}
function buildSeoSite(options={}){
  const root=path.resolve(options.root||process.cwd());
  const outDir=options.outDir||'build/seo-site';
  const includePlanned=!!options.includePlanned;
  const ctx=options.ctx||Resolver.loadContext(root);
  const results=[],skipped=[];
  fs.rmSync(path.join(root,outDir),{recursive:true,force:true});
  fs.mkdirSync(path.join(root,outDir),{recursive:true});

  for(const context of allContexts(ctx)){
    const status=Sitemaps.pageClusterStatus(root,context,includePlanned);
    if(!status.ok){
      skipped.push({pageId:context.page.id,kind:context.kind,reason:status.reason});
      continue;
    }
    for(const lang of context.page.languages){
      const source=copySource(root,context,lang);
      const out=outputFile(root,outDir,context,lang,ctx);
      const common={
        root,source,out,
        assetBase:options.assetBase||'/trasporti/seo-assets',
        assetDir:path.join(outDir,'trasporti/seo-assets'),
        appBase:options.appBase||'/trasporti',
        siteOrigin:options.siteOrigin||'https://www.unlockvenice.com',
        now:options.now||new Date(),
        ctx
      };
      const result=includePlanned?Landing.buildPreview(common):Landing.buildPublic(common);
      results.push(result);
    }
  }

  const sitemaps=Sitemaps.buildSitemaps({
    root,
    outDir:path.join(root,outDir),
    siteOrigin:options.siteOrigin||'https://www.unlockvenice.com',
    includePlanned,
    ctx
  });

  return {
    outDir:path.join(root,outDir),
    mode:includePlanned?'candidate':'public',
    pages:results.length,
    placePages:results.filter(x=>x.kind==='place').length,
    routePages:results.filter(x=>x.kind==='route').length,
    skipped,
    sitemaps,
    results
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--out-dir')args.outDir=argv[++i];
    else if(a==='--site-origin')args.siteOrigin=argv[++i];
    else if(a==='--asset-base')args.assetBase=argv[++i];
    else if(a==='--app-base')args.appBase=argv[++i];
    else if(a==='--include-planned')args.includePlanned=true;
  }
  return args;
}
function main(){
  const result=buildSeoSite(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({
    outDir:result.outDir,mode:result.mode,pages:result.pages,
    placePages:result.placePages,routePages:result.routePages,
    skipped:result.skipped,sitemaps:{
      placeUrls:result.sitemaps.placeUrls,
      routeUrls:result.sitemaps.routeUrls,
      totalUrls:result.sitemaps.totalUrls
    }
  },null,2)+'\n');
}
if(require.main===module){
  try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}
}

module.exports={allContexts,copySource,outputFile,buildSeoSite};
