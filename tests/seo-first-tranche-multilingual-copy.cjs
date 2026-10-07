const fs=require('fs'),path=require('path'),assert=require('assert');
const B=require(path.resolve(__dirname,'../scripts/build_seo_landing_preview.cjs'));
const R=require(path.resolve(__dirname,'../scripts/resolve_seo_placeholders.cjs'));

const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const places=read('seo/pages/places.json');
const routes=read('seo/pages/routes.json');
const i18n=read('seo/content/LANDING-I18N.json');
const fares=read('seo/data/tourist-fares.json');
const locales=['it','en','fr','de'];

const bounds={
  it:{place:[320,650],route:[380,760],title:[38,65],meta:[120,165]},
  en:{place:[280,650],route:[330,760],title:[38,65],meta:[120,165]},
  fr:{place:[280,680],route:[330,790],title:[38,68],meta:[120,175]},
  de:{place:[270,700],route:[320,820],title:[38,70],meta:[115,180]}
};
const faqBounds={place:[3,5],route:[4,6]};
const fareGroups=new Set(Object.keys(fares.groups||{}));
const audited=[];

for(const lang of locales){
  assert(i18n.locales?.[lang],'Missing LANDING-I18N locale '+lang);
  for(const [kind,manifest] of [['place',places],['route',routes]]){
    for(const page of manifest.pages){
      assert.equal(page.contentState,'ready','Landing must be ready after M5 final publication gate: '+page.id);
      const file=path.join(root,'seo/content',kind,page.copyKey,lang+'.md');
      assert(fs.existsSync(file),'Missing localized copy '+file);
      const source=fs.readFileSync(file,'utf8');
      const {meta,body}=B.parseFrontmatter(source);
      assert.equal(meta.schemaVersion,1,'Bad schema '+page.id+' '+lang);
      assert.equal(meta.kind,kind,'Kind mismatch '+page.id+' '+lang);
      assert.equal(meta.pageId,page.id,'pageId mismatch '+page.id+' '+lang);
      assert.equal(meta.copyKey,page.copyKey,'copyKey mismatch '+page.id+' '+lang);
      assert.equal(meta.lang,lang,'Language mismatch '+page.id+' '+lang);
      assert.equal(meta.status,'ready','Copy must be ready '+page.id+' '+lang);

      const title=String(meta.seoTitle||''),desc=String(meta.metaDescription||''),h1=String(meta.h1||'');
      const [minTitle,maxTitle]=bounds[lang].title,[minMeta,maxMeta]=bounds[lang].meta;
      assert(title.length>=minTitle&&title.length<=maxTitle,'SEO title guardrail '+page.id+' '+lang+': '+title.length);
      assert(desc.length>=minMeta&&desc.length<=maxMeta,'Meta guardrail '+page.id+' '+lang+': '+desc.length);
      assert(h1.length>10,'H1 too short '+page.id+' '+lang);

      const words=(body.match(/\b[\p{L}\p{N}’'-]+\b/gu)||[]).length;
      const [minWords,maxWords]=bounds[lang][kind];
      assert(words>=minWords&&words<=maxWords,'Word-count guardrail '+page.id+' '+lang+': '+words);

      const strings=i18n.locales[lang];
      const faqPart=(body.split('## '+strings.sections.faq)[1]||'').split('## '+strings.sections.relatedTransport)[0]||'';
      const faqCount=(faqPart.match(/^### /gm)||[]).length;
      const [minFaq,maxFaq]=faqBounds[kind];
      assert(faqCount>=minFaq&&faqCount<=maxFaq,'FAQ guardrail '+page.id+' '+lang+': '+faqCount);

      assert(body.includes('{{journey_cta'),'Journey CTA missing '+page.id+' '+lang);
      const fareMatch=body.match(/\{\{fare_table group="([^"]+)"\}\}/);
      assert(fareMatch&&fareGroups.has(fareMatch[1]),'Fare table missing/invalid '+page.id+' '+lang);
      assert(body.includes('## '+strings.sections.relatedTransport),'Localized related transport heading missing '+page.id+' '+lang);
      assert(body.includes('## '+strings.sections.relatedReading),'Localized related reading heading missing '+page.id+' '+lang);
      assert(body.includes('{{related_transport}}'),'Related transport placeholder missing '+page.id+' '+lang);
      assert(body.includes('{{related_reading}}'),'Related reading placeholder missing '+page.id+' '+lang);
      assert(!/€\s*\d+(?:[.,]\d+)?/.test(body),'Hardcoded euro fare '+page.id+' '+lang);
      assert(!/\b(?:EUR|euro|euros)\s*\d+(?:[.,]\d+)?/i.test(body),'Hardcoded textual fare '+page.id+' '+lang);

      audited.push({lang,kind,pageId:page.id,words,faqCount,titleChars:title.length,metaChars:desc.length,fareGroup:fareMatch[1]});
    }
  }
}
assert.equal(audited.length,76,'Expected 76 localized landing copies');

const ctx=R.loadContext(root);
for(const [lang,pageId,source] of [
  ['it','seo-route-mestre-san-marco','seo/content/route/mestre-san-marco/it.md'],
  ['en','seo-route-mestre-san-marco','seo/content/route/mestre-san-marco/en.md'],
  ['fr','seo-place-san-marco','seo/content/place/san-marco/fr.md'],
  ['de','seo-route-san-marco-rialto','seo/content/route/san-marco-rialto/de.md']
]){
  const out='build/test-multilingual/'+lang+'/'+pageId+'/index.html';
  const result=B.buildPreview({
    root,source,out,assetDir:'build/test-multilingual/assets',
    appBase:'/t-sand',assetBase:'/t-sand/seo-preview/assets',
    now:new Date('2026-09-26T12:00:00Z')
  });
  const html=fs.readFileSync(path.join(root,out),'utf8');
  const strings=i18n.locales[lang];
  assert(html.includes('<html lang="'+lang+'">'),'Wrong html lang '+lang);
  assert(html.includes(strings.previewBar),'Localized preview bar missing '+lang);
  assert(html.includes(strings.nav.about),'Localized nav missing '+lang);
  assert(html.includes(strings.journey.heading),'Localized Journey heading missing '+lang);
  assert(html.includes(strings.fares.heading),'Localized fare heading missing '+lang);
  assert(html.includes(strings.relatedTransport.heading),'Localized related transport heading missing '+lang);
  assert(html.includes(strings.relatedReading.heading),'Localized related reading heading missing '+lang);
  assert(html.includes(strings.pageNote),'Localized page note missing '+lang);
  assert(!html.includes('%%'),'Unresolved template token '+lang);
  assert(!html.includes('{{'),'Unresolved content placeholder '+lang);
  assert.equal(result.lang,lang);
}

const enFare=R.resolveFareTable({group:'mestre-venice'},'seo-route-mestre-san-marco','en',ctx);
const frFare=R.resolveFareTable({group:'mestre-venice'},'seo-route-mestre-san-marco','fr',ctx);
const deFare=R.resolveFareTable({group:'mestre-venice'},'seo-route-mestre-san-marco','de',ctx);
assert(enFare.items.find(x=>x.id==='trenitalia-mestre-santalucia').displayPrice.startsWith('from '));
assert(frFare.items.find(x=>x.id==='trenitalia-mestre-santalucia').displayPrice.startsWith('à partir de '));
assert(deFare.items.find(x=>x.id==='trenitalia-mestre-santalucia').displayPrice.startsWith('ab '));
for(const lang of ['fr','de']){
  const fare=R.resolveFareTable({group:'mestre-venice'},'seo-route-mestre-san-marco',lang,ctx);
  const row=fare.items.find(x=>x.id==='trenitalia-mestre-santalucia');
  assert(row.note&&row.note!==fares.fares.find(x=>x.id===row.id).notes.it,'Localized fare note fallback leaked into '+lang);
}

for(const lang of ['en','fr','de']){
  const related=R.resolveRelatedReading('seo-place-san-marco',lang,ctx,{now:new Date('2026-09-26T12:00:00Z')});
  assert(related.items.length>0,'No related reading '+lang);
  assert(related.items.every(x=>x.url.includes('/'+lang+'/')),'Cross-language related article leaked into '+lang);
}

fs.rmSync(path.join(root,'build/test-multilingual'),{recursive:true,force:true});
console.log('MULTILINGUAL COPY AUDIT',audited);
console.log('RESULT: 76/76 IT/EN/FR/DE landing copies pass localized SEO, FAQ, fare, placeholder and render guards in ready state.');
