const fs=require('fs'),path=require('path'),assert=require('assert');
const S=require(path.resolve(__dirname,'../scripts/build_seo_sitemaps.cjs'));

const root=path.resolve(__dirname,'..');
const base='build/test-seo-sitemaps';
fs.rmSync(path.join(root,base),{recursive:true,force:true});

assert.equal(S.manifestAllowed('ready',false),true);
assert.equal(S.manifestAllowed('planned',false),false);
assert.equal(S.manifestAllowed('planned',true),true);
assert.equal(S.copyAllowed('ready',false),true);
assert.equal(S.copyAllowed('draft',false),false);
assert.equal(S.copyAllowed('draft',true),true);

const prod=S.buildSitemaps({
  root,
  outDir:base+'/prod',
  siteOrigin:'https://www.unlockvenice.com'
});
assert.equal(prod.placeUrls,44,'ready place pages must enter production sitemap');
assert.equal(prod.routeUrls,32,'ready route pages must enter production sitemap');
assert.equal(prod.totalUrls,76,'production sitemap must contain all ready localized URLs');
assert.equal(prod.skipped.length,0,'no ready first-tranche page should be skipped from production');

const prodPlaces=fs.readFileSync(prod.files.places,'utf8');
const prodRoutes=fs.readFileSync(prod.files.routes,'utf8');
assert.equal((prodPlaces.match(/<url>/g)||[]).length,44,'production place sitemap URL count mismatch');
assert.equal((prodRoutes.match(/<url>/g)||[]).length,32,'production route sitemap URL count mismatch');

const preview=S.buildSitemaps({
  root,
  outDir:base+'/preview',
  siteOrigin:'https://www.unlockvenice.com',
  includePlanned:true
});
assert.equal(preview.placeUrls,44,'preview place sitemap should contain 11 pages × 4 locales');
assert.equal(preview.routeUrls,32,'preview route sitemap should contain 8 pages × 4 locales');
assert.equal(preview.totalUrls,76,'preview sitemap should contain all 76 localized URLs');
assert.equal(preview.skipped.length,0,'all planned first-tranche clusters should validate in preview mode');

const places=fs.readFileSync(preview.files.places,'utf8');
const routes=fs.readFileSync(preview.files.routes,'utf8');
const index=fs.readFileSync(preview.files.index,'utf8');
const combined=places+'\n'+routes;

assert(places.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'),'xhtml namespace missing');
assert(routes.includes('<loc>https://www.unlockvenice.com/trasporti/percorsi/stazione-mestre-piazza-san-marco/</loc>'),'Italian route URL missing');
assert(routes.includes('hreflang="en" href="https://www.unlockvenice.com/en/trasporti/routes/mestre-station-st-marks-square/"'),'English route alternate missing');
assert(places.includes('<loc>https://www.unlockvenice.com/de/trasporti/orte/markusplatz/</loc>'),'German place URL missing');
assert(places.includes('hreflang="x-default" href="https://www.unlockvenice.com/trasporti/luoghi/piazza-san-marco/"'),'place x-default must point to Italian');
assert(index.includes('<loc>https://www.unlockvenice.com/sitemap-transport-places.xml</loc>'),'place sitemap index URL mismatch');
assert(index.includes('<loc>https://www.unlockvenice.com/sitemap-transport-routes.xml</loc>'),'route sitemap index URL mismatch');

assert.equal((combined.match(/<url>/g)||[]).length,76,'unexpected sitemap URL count');
assert.equal((combined.match(/<xhtml:link /g)||[]).length,380,'each URL must expose IT/EN/FR/DE + x-default');
assert.equal((combined.match(/hreflang="x-default"/g)||[]).length,76,'each URL needs one x-default');
assert(!combined.includes('/t-sand/'),'staging URLs must never enter sitemap output');
assert(!combined.includes('/seo-preview/'),'preview URLs must never enter sitemap output');
assert(!combined.includes('/go/'),'operational deep links must never enter sitemap output');
assert(!/<loc>[^<]*\?/.test(combined),'canonical sitemap loc values must not contain query strings');
assert(!/href="[^"]*\?/.test(combined),'canonical sitemap alternate href values must not contain query strings');

fs.rmSync(path.join(root,base),{recursive:true,force:true});
console.log('RESULT: sitemap production includes exactly 76 ready localized URLs; low-level gates still reject planned/draft states and all hreflang/canonical checks pass.');
