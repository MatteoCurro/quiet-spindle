const fs=require('fs'),path=require('path'),assert=require('assert');
const Quality=require(path.resolve(__dirname,'../scripts/validate_seo_quality.cjs'));
const Site=require(path.resolve(__dirname,'../scripts/build_seo_site.cjs'));
const Landing=require(path.resolve(__dirname,'../scripts/build_seo_landing_preview.cjs'));
const Resolver=require(path.resolve(__dirname,'../scripts/resolve_seo_placeholders.cjs'));

const root=path.resolve(__dirname,'..');
const report=Quality.auditQuality({root,now:new Date('2026-09-26T12:00:00Z')});
assert.equal(report.documents,76,'quality gate must audit 76 localized documents');
assert.equal(report.placeDocuments,44);
assert.equal(report.routeDocuments,32);
assert.deepEqual(report.languages.sort(),['de','en','fr','it']);
assert.deepEqual(report.errors,[],'SEO quality errors:\n'+report.errors.join('\n'));
assert.equal(report.ok,true);

const candidate=Site.buildSeoSite({
  root,outDir:'build/test-seo-site-candidate',includePlanned:true,
  siteOrigin:'https://www.unlockvenice.com',
  now:new Date('2026-09-26T12:00:00Z')
});
assert.equal(candidate.mode,'candidate');
assert.equal(candidate.pages,76);
assert.equal(candidate.placePages,44);
assert.equal(candidate.routePages,32);
for(const result of candidate.results){
  const html=fs.readFileSync(result.out,'utf8');
  assert(html.includes('<meta name="robots" content="noindex,nofollow">'),'candidate must remain noindex '+result.pageId+' '+result.lang);
}

const production=Site.buildSeoSite({
  root,outDir:'build/test-seo-site-public',
  siteOrigin:'https://www.unlockvenice.com'
});
assert.equal(production.mode,'public');
assert.equal(production.pages,76,'all ready localized pages must enter the public artifact');
assert.equal(production.sitemaps.totalUrls,76,'all ready localized pages must enter public sitemaps');

const ctx=Resolver.loadContext(root);
const publicOut='build/test-public-fixture/trasporti/percorsi/stazione-mestre-piazza-san-marco/index.html';
const publicResult=Landing.buildPublic({
  root,ctx,source:'seo/content/route/mestre-san-marco/it.md',out:publicOut,
  assetDir:'build/test-public-fixture/trasporti/seo-assets',
  assetBase:'/trasporti/seo-assets',appBase:'/trasporti',
  siteOrigin:'https://www.unlockvenice.com',
  now:new Date('2026-09-26T12:00:00Z')
});
const publicHtml=fs.readFileSync(path.join(root,publicOut),'utf8');
assert.equal(publicResult.mode,'public');
assert(publicHtml.includes('<meta name="robots" content="index,follow">'),'public landing must be indexable');
assert(!publicHtml.includes('ANTEPRIMA SEO'),'public landing leaked preview chrome');
assert(publicHtml.includes('class="uv-link-preview uv-link-live"'),'public related transport links must be clickable');
assert(!publicHtml.includes('Landing in preparazione'),'public landing leaked planned label');
assert(publicHtml.includes('href="/trasporti/luoghi/stazione-venezia-mestre/"'),'public internal transport link missing');
assert(publicHtml.includes('<link rel="stylesheet" href="/trasporti/seo-assets/landing.css">'),'public asset path mismatch');
assert(publicHtml.includes('<link rel="canonical" href="https://www.unlockvenice.com/trasporti/percorsi/stazione-mestre-piazza-san-marco/">'));

for(const dir of ['build/test-seo-site-candidate','build/test-seo-site-public','build/test-public-fixture']){
  fs.rmSync(path.join(root,dir),{recursive:true,force:true});
}
console.log('RESULT: 76-copy thin/duplicate gate passes; candidate stays noindex; ready-only public builder emits all 76 indexable static pages with live internal links.');
