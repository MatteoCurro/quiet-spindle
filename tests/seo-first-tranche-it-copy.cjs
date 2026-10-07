const fs=require('fs'),path=require('path'),assert=require('assert');
const B=require(path.resolve(__dirname,'../scripts/build_seo_landing_preview.cjs'));

const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const places=read('seo/pages/places.json');
const routes=read('seo/pages/routes.json');
const fares=read('seo/data/tourist-fares.json');

assert.equal(places.pages.length,11,'transport SEO must keep 11 place pages');
assert.equal(routes.pages.length,8,'transport SEO must keep 8 route pages');
assert.equal(fares.audience,'visitor','fare registry must remain visitor-focused');

const fareGroups=new Set(Object.keys(fares.groups||{}));
const rows=[];

for(const [kind,manifest,minWords,maxWords,minFaq,maxFaq] of [
  ['place',places,320,650,3,5],
  ['route',routes,380,760,4,6]
]){
  for(const page of manifest.pages){
    assert.equal(page.contentState,'ready','IT tranche must be publication-ready after M5 final gate: '+page.id);
    const file=path.join(root,'seo/content',kind,page.copyKey,'it.md');
    assert(fs.existsSync(file),'Missing IT copy '+file);
    const source=fs.readFileSync(file,'utf8');
    const {meta,body}=B.parseFrontmatter(source);

    assert.equal(meta.schemaVersion,1,'Bad copy schema '+page.id);
    assert.equal(meta.kind,kind,'Copy kind mismatch '+page.id);
    assert.equal(meta.pageId,page.id,'Copy pageId mismatch '+page.id);
    assert.equal(meta.copyKey,page.copyKey,'Copy copyKey mismatch '+page.id);
    assert.equal(meta.lang,'it','First tranche copy must be Italian '+page.id);
    assert.equal(meta.status,'ready','First tranche copy must be ready '+page.id);

    const title=String(meta.seoTitle||'');
    const description=String(meta.metaDescription||'');
    const h1=String(meta.h1||'');
    assert(title.length>=38&&title.length<=65,'SEO title outside guardrail '+page.id+': '+title.length);
    assert(description.length>=120&&description.length<=165,'Meta description outside guardrail '+page.id+': '+description.length);
    assert(h1.length>12,'H1 too short '+page.id);

    const words=(body.match(/\b[\p{L}\p{N}’'-]+\b/gu)||[]).length;
    assert(words>=minWords&&words<=maxWords,'Body word count outside '+kind+' guardrail '+page.id+': '+words);

    const faqPart=(body.split('## Domande frequenti')[1]||'').split('## Pagine trasporti collegate')[0]||'';
    const faqCount=(faqPart.match(/^### /gm)||[]).length;
    assert(faqCount>=minFaq&&faqCount<=maxFaq,'FAQ count outside guardrail '+page.id+': '+faqCount);

    assert(body.includes('{{journey_cta'),'Journey CTA missing '+page.id);
    assert(body.includes('## Prezzi indicativi'),'Prices heading missing '+page.id);
    const fareMatch=body.match(/\{\{fare_table group="([^"]+)"\}\}/);
    assert(fareMatch,'Fare table missing '+page.id);
    assert(fareGroups.has(fareMatch[1]),'Unknown fare group '+fareMatch[1]+' in '+page.id);
    assert(body.includes('{{related_transport}}'),'Related transport missing '+page.id);
    assert(body.includes('{{related_reading}}'),'Related reading missing '+page.id);
    assert(!/€\s*\d+(?:[.,]\d+)?/.test(body),'Hardcoded numeric fare found in Markdown '+page.id);
    assert(!/\b(?:EUR|euro)\s*\d+(?:[.,]\d+)?/i.test(body),'Hardcoded textual fare found in Markdown '+page.id);

    rows.push({pageId:page.id,kind,words,faqCount,titleChars:title.length,metaChars:description.length,fareGroup:fareMatch[1]});
  }
}

assert.equal(rows.length,19,'Expected 19 IT landing copies');
console.log('IT COPY AUDIT',rows);
console.log('RESULT: all 19 Italian transport landing copies satisfy SEO/copy/fare/internal-link guardrails and are ready for controlled publication.');
