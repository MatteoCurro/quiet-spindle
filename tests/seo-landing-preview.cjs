const fs=require('fs'),path=require('path'),assert=require('assert');
const B=require(path.resolve(__dirname,'../scripts/build_seo_landing_preview.cjs'));

const root=path.resolve(__dirname,'..');
const out='build/test-seo-preview/percorsi/stazione-mestre-piazza-san-marco/index.html';
const assetDir='build/test-seo-preview/assets';
const result=B.buildPreview({
  root,
  out,
  assetDir,
  appBase:'/t-sand',
  assetBase:'/t-sand/seo-preview/assets',
  now:new Date('2026-09-26T12:00:00Z')
});

assert.equal(result.pageId,'seo-route-mestre-san-marco');
assert.equal(result.kind,'route');
assert.equal(result.lang,'it');
assert.equal(result.status,'ready');
assert(result.relatedTransport>=2&&result.relatedTransport<=4);
assert(result.relatedReading>=3&&result.relatedReading<=6);

const html=fs.readFileSync(path.join(root,out),'utf8');
const css=fs.readFileSync(path.join(root,assetDir,'landing.css'),'utf8');

assert(html.includes('<meta name="robots" content="noindex,nofollow">'),'preview must be noindex/nofollow');
assert.equal((html.match(/<h1>/g)||[]).length,1,'preview must have exactly one H1');
assert(html.includes('<title>Da Stazione Mestre a Piazza San Marco: come arrivare</title>'));
assert(html.includes('fonts.googleapis.com/css2?family=Bricolage+Grotesque'),'Bricolage Grotesque font missing');
assert(html.includes('family=Inter'),'Inter font missing');
assert(html.includes('/t-sand/go/r/uv_mestre_station_san_marco?lang=it&amp;ref=seo_landing&amp;campaign=seo-route-mestre-san-marco'),'staging Journey CTA is incorrect');
assert.equal((html.match(/class="uv-faq-item"/g)||[]).length,5,'pilot FAQ count changed');
assert.equal((html.match(/class="uv-link-preview"/g)||[]).length,result.relatedTransport,'preview transport links must render as non-clickable preview cards');
assert(!/<a[^>]+class="uv-link-preview"/.test(html),'preview landing cards must not be clickable');
assert.equal((html.match(/class="uv-reading-card"/g)||[]).length,result.relatedReading,'editorial related-reading card count mismatch');
assert.equal((html.match(/class="uv-fares"/g)||[]).length,1,'route fare table missing');
assert(html.includes('Mestre Daily Pass 24 ore'),'route fare table missing Mestre Daily Pass');
assert(html.includes('Treno Venezia Mestre → Venezia Santa Lucia'),'route fare table missing train reference');
assert(html.includes('indicativo'),'third-party train fare must be labelled indicative');
assert(html.includes('Verificate il 2026-09-26'),'route fare verification date missing');
assert(!html.includes('{{'),'unresolved Markdown placeholders leaked into HTML');
assert(html.includes('<link rel="canonical" href="https://www.unlockvenice.com/trasporti/percorsi/stazione-mestre-piazza-san-marco/">'),'route canonical mismatch');
for(const locale of ['it','en','fr','de'])assert(html.includes('hreflang="'+locale+'"'),'route hreflang '+locale+' missing');
assert(html.includes('hreflang="x-default" href="https://www.unlockvenice.com/trasporti/percorsi/stazione-mestre-piazza-san-marco/"'),'route x-default mismatch');

assert(css.includes('--uv-brand:#b6174b'),'Unlock Venice brand token missing');
assert(css.includes('--uv-ink:#25291c'),'Unlock Venice ink token missing');
assert(css.includes('font-family:"Bricolage Grotesque"'),'heading font contract missing');
assert(css.includes('font-family:Inter'),'body font contract missing');

const placeOut='build/test-seo-preview/luoghi/piazza-san-marco/index.html';
const placeResult=B.buildPreview({
  root,
  source:'seo/content/place/san-marco/it.md',
  out:placeOut,
  assetDir,
  appBase:'/t-sand',
  assetBase:'/t-sand/seo-preview/assets',
  now:new Date('2026-09-26T12:00:00Z')
});
assert.equal(placeResult.pageId,'seo-place-san-marco');
assert.equal(placeResult.kind,'place');
assert.equal(placeResult.lang,'it');
assert.equal(placeResult.status,'ready');
assert(placeResult.relatedTransport>=2&&placeResult.relatedTransport<=4);
assert(placeResult.relatedReading>=3&&placeResult.relatedReading<=6);

const placeHtml=fs.readFileSync(path.join(root,placeOut),'utf8');
assert(placeHtml.includes('<meta name="robots" content="noindex,nofollow">'),'place preview must remain noindex');
assert.equal((placeHtml.match(/<h1>/g)||[]).length,1,'place preview must have exactly one H1');
assert(placeHtml.includes('<title>Piazza San Marco: come arrivare e da dove partire</title>'));
assert(placeHtml.includes('Trasporti · Luoghi'),'place eyebrow missing');
assert(placeHtml.includes('aria-label="Destinazione"'),'place destination hero missing');
assert(placeHtml.includes('Piazza San Marco'),'place name missing');
assert(placeHtml.includes('/t-sand/go/p/uv_venice_san_marco?from=current&amp;lang=it&amp;ref=seo_landing&amp;campaign=seo-place-san-marco'),'place Journey CTA is incorrect');
assert.equal((placeHtml.match(/class="uv-faq-item"/g)||[]).length,5,'place FAQ count changed');
assert.equal((placeHtml.match(/class="uv-link-preview"/g)||[]).length,placeResult.relatedTransport,'place internal-link preview mismatch');
assert.equal((placeHtml.match(/class="uv-reading-card"/g)||[]).length,placeResult.relatedReading,'place related-reading card count mismatch');
assert.equal((placeHtml.match(/class="uv-fares"/g)||[]).length,1,'place fare table missing');
assert(placeHtml.includes('ACTV rete unica 75 minuti'),'place fare table missing standard waterbus fare');
assert(placeHtml.includes('9,50'),'place fare table missing €9.50 visitor fare');
assert(placeHtml.includes('ACTV pass 1 giorno'),'place fare table missing tourist pass');
assert(placeHtml.includes('Percorsi e luoghi utili collegati a questa destinazione.'),'place related transport copy mismatch');
assert(placeHtml.includes('Approfondimenti selezionati perché pertinenti a questo luogo.'),'place related reading copy mismatch');
assert(!placeHtml.includes('{{'),'unresolved place placeholders leaked into HTML');
assert(placeHtml.includes('<link rel="canonical" href="https://www.unlockvenice.com/trasporti/luoghi/piazza-san-marco/">'),'place canonical mismatch');
assert(placeHtml.includes('hreflang="de" href="https://www.unlockvenice.com/de/trasporti/orte/markusplatz/"'),'place German alternate mismatch');

const Resolver=require(path.resolve(__dirname,'../scripts/resolve_seo_placeholders.cjs'));
const ctx=Resolver.loadContext(root);
const entities=new Map(ctx.registry.entities.map(entity=>[entity.id,entity]));
const contexts=[
  ...ctx.places.pages.map(page=>({kind:'place',page,manifest:ctx.places})),
  ...ctx.routes.pages.map(page=>({kind:'route',page,manifest:ctx.routes}))
];
let checked=0;
for(const context of contexts){
  for(const lang of context.page.languages){
    const links=B.buildSeoLinks(context.page.id,lang,ctx);
    const prefix=ctx.placeholderContract.localePrefixes[lang]||'';
    const segment=context.manifest.pathSegments[lang];
    const slug=context.kind==='route'
      ?context.page.slugs[lang]
      :entities.get(context.page.entity).seo.slugs[lang];
    const expected='https://www.unlockvenice.com'+prefix+'/trasporti/'+segment+'/'+slug+'/';
    assert.equal(links.canonical,expected,context.page.id+' '+lang+' canonical mismatch');
    assert.equal(links.alternates.length,context.page.languages.length+1,context.page.id+' alternate count mismatch');
    const self=links.alternates.find(item=>item.lang===lang);
    assert(self&&self.href===expected,context.page.id+' '+lang+' self alternate mismatch');
    const xDefault=links.alternates.find(item=>item.lang==='x-default');
    const italian=B.buildSeoLinks(context.page.id,'it',ctx).canonical;
    assert(xDefault&&xDefault.href===italian,context.page.id+' x-default must resolve to Italian');
    assert.equal(new Set(links.alternates.filter(item=>item.lang!=='x-default').map(item=>item.href)).size,context.page.languages.length,context.page.id+' localized alternates must be unique');
    checked++;
  }
}
assert.equal(checked,76,'expected canonical/hreflang coverage for 19 pages x 4 locales');

fs.rmSync(path.join(root,'build/test-seo-preview'),{recursive:true,force:true});
console.log('RESULT: route + place static landing previews share the approved Unlock Venice template, semantic noindex markup, live Journey CTA, visible FAQ and safe non-clickable internal-link previews.');
