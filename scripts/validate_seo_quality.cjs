#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const Landing=require('./build_seo_landing_preview.cjs');
const Resolver=require('./resolve_seo_placeholders.cjs');
const Site=require('./build_seo_site.cjs');

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function words(value=''){return String(value).match(/[\p{L}\p{N}’'-]+/gu)||[]}
function normalize(value=''){
  return words(String(value).toLowerCase()).join(' ');
}
function shingles(value,size=5){
  const tokens=words(String(value).toLowerCase());
  const out=new Set();
  if(tokens.length<size)return out;
  for(let i=0;i<=tokens.length-size;i++)out.add(tokens.slice(i,i+size).join(' '));
  return out;
}
function jaccard(a,b){
  if(!a.size&&!b.size)return 1;
  let inter=0;
  for(const x of a)if(b.has(x))inter++;
  return inter/(a.size+b.size-inter||1);
}
function proseParagraphs(body){
  return String(body).split(/\n\s*\n/)
    .map(block=>block.split('\n').map(x=>x.trim()).filter(Boolean))
    .filter(lines=>lines.length)
    .filter(lines=>!lines.every(line=>/^(?:#{1,6}\s|[-*]\s|\{\{)/.test(line)))
    .map(lines=>lines.filter(line=>!/^(?:#{1,6}\s|\{\{)/.test(line)).join(' '))
    .map(x=>x.trim()).filter(Boolean);
}
function allContexts(ctx){
  return [
    ...ctx.places.pages.map(page=>({kind:'place',page,manifest:ctx.places})),
    ...ctx.routes.pages.map(page=>({kind:'route',page,manifest:ctx.routes}))
  ];
}
function auditQuality(options={}){
  const root=path.resolve(options.root||process.cwd());
  const contract=readJson(path.join(root,'seo/content/QUALITY-CONTRACT.json'));
  const ctx=Resolver.loadContext(root);
  const docs=[];
  const errors=[];
  const fieldSeen=new Map();
  const paragraphSeen=new Map();

  for(const context of allContexts(ctx)){
    for(const lang of context.page.languages||[]){
      const file=path.join(root,'seo/content',context.kind,context.page.copyKey,lang+'.md');
      if(!fs.existsSync(file)){errors.push('Missing copy '+file);continue}
      const {meta,body}=Landing.parseFrontmatter(fs.readFileSync(file,'utf8'));
      const doc={context,lang,file,meta,body,pageId:context.page.id,kind:context.kind};
      docs.push(doc);

      const minWords=contract.thinContent.minWords?.[lang]?.[context.kind];
      const wordCount=words(body).length;
      if(!Number.isFinite(minWords)||wordCount<minWords)errors.push('Thin content '+context.page.id+' '+lang+': '+wordCount+' < '+minWords);

      const strings=ctx.landingI18n.locales[lang];
      const faqBody=(body.split('## '+strings.sections.faq)[1]||'').split('## '+strings.sections.relatedTransport)[0]||'';
      const faqCount=(faqBody.match(/^###\s+/gm)||[]).length;
      const minFaq=contract.thinContent.minFaq?.[context.kind]||0;
      if(faqCount<minFaq)errors.push('Too few FAQ '+context.page.id+' '+lang+': '+faqCount+' < '+minFaq);

      for(const field of contract.uniqueness.exactUniqueFields||[]){
        const value=normalize(meta[field]||'');
        if(!value){errors.push('Missing '+field+' '+context.page.id+' '+lang);continue}
        const key=lang+'|'+field+'|'+value;
        const previous=fieldSeen.get(key);
        if(previous&&previous!==context.page.id)errors.push('Duplicate '+field+' '+lang+': '+previous+' / '+context.page.id);
        else fieldSeen.set(key,context.page.id);
      }

      const faqQuestions=(faqBody.match(/^###\s+(.+)$/gm)||[]).map(x=>normalize(x.replace(/^###\s+/,'')));
      if(new Set(faqQuestions).size!==faqQuestions.length)errors.push('Duplicate FAQ question within '+context.page.id+' '+lang);

      for(const paragraph of proseParagraphs(body)){
        if(words(paragraph).length<(contract.uniqueness.repeatedParagraph?.minWords||20))continue;
        const key=lang+'|'+normalize(paragraph);
        const previous=paragraphSeen.get(key);
        if(previous&&previous!==context.page.id&&contract.uniqueness.repeatedParagraph?.failAcrossDifferentPages){
          errors.push('Repeated long paragraph '+lang+': '+previous+' / '+context.page.id);
        }else paragraphSeen.set(key,context.page.id);
      }

      const relatedTransport=Resolver.resolveRelatedTransport(context.page.id,lang,ctx,{includePlanned:true,now:options.now||new Date('2026-09-26T12:00:00Z')});
      const relatedReading=Resolver.resolveRelatedReading(context.page.id,lang,ctx,{now:options.now||new Date('2026-09-26T12:00:00Z')});
      if(relatedTransport.items.length<(contract.thinContent.minRelatedTransport||2))errors.push('Too few related transport '+context.page.id+' '+lang);
      if(relatedReading.items.length<(contract.thinContent.minRelatedReading||3))errors.push('Too few related reading '+context.page.id+' '+lang);
      doc.wordCount=wordCount;doc.faqCount=faqCount;
    }
  }

  const near=contract.uniqueness.nearDuplicate||{};
  const shingleSize=near.shingleSize||5;
  const threshold=Number(near.maxJaccard||0.55);
  for(let i=0;i<docs.length;i++){
    for(let j=i+1;j<docs.length;j++){
      const a=docs[i],b=docs[j];
      if(near.sameLanguageOnly&&a.lang!==b.lang)continue;
      if(near.sameKindOnly&&a.kind!==b.kind)continue;
      const score=jaccard(shingles(a.body,shingleSize),shingles(b.body,shingleSize));
      if(score>threshold)errors.push('Near-duplicate '+a.lang+' '+a.pageId+' / '+b.pageId+': '+score.toFixed(3)+' > '+threshold);
    }
  }

  const candidateDir='build/seo-quality-candidate';
  const candidate=Site.buildSeoSite({
    root,outDir:candidateDir,includePlanned:true,
    siteOrigin:'https://www.unlockvenice.com',
    now:options.now||new Date('2026-09-26T12:00:00Z')
  });
  if(candidate.pages!==docs.length)errors.push('Candidate page count '+candidate.pages+' != '+docs.length);
  for(const result of candidate.results){
    const html=fs.readFileSync(result.out,'utf8');
    if(contract.render.candidateMustRemainNoindex&&!html.includes('<meta name="robots" content="noindex,nofollow">'))errors.push('Candidate lost noindex '+result.pageId+' '+result.lang);
    if((html.match(/<h1>/g)||[]).length!==1)errors.push('H1 count invalid '+result.pageId+' '+result.lang);
    if(!html.includes('<link rel="canonical" href="'+result.canonical+'">'))errors.push('Canonical missing '+result.pageId+' '+result.lang);
    for(const lang of contract.render.hreflangLocales||[]){
      if(!html.includes('hreflang="'+lang+'"'))errors.push('hreflang '+lang+' missing '+result.pageId+' '+result.lang);
    }
    if(/%%[A-Z0-9_]+%%|\{\{/.test(html))errors.push('Unresolved token '+result.pageId+' '+result.lang);
    if(contract.render.publicJavascriptRequired===false&&/<script\b/i.test(html))errors.push('Unexpected JS in static landing '+result.pageId+' '+result.lang);
  }

  fs.rmSync(path.join(root,candidateDir),{recursive:true,force:true});
  return {
    ok:errors.length===0,
    documents:docs.length,
    languages:[...new Set(docs.map(x=>x.lang))],
    placeDocuments:docs.filter(x=>x.kind==='place').length,
    routeDocuments:docs.filter(x=>x.kind==='route').length,
    errors,
    threshold
  };
}
function main(){
  const report=auditQuality();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.ok)process.exitCode=1;
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exitCode=1}}

module.exports={words,normalize,shingles,jaccard,proseParagraphs,auditQuality};
