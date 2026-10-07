const fs=require('fs'),path=require('path'),assert=require('assert');
const Site=require(path.resolve(__dirname,'../scripts/build_seo_site.cjs'));

const root=path.resolve(__dirname,'..');
const outDir='build/test-seo-public-crawl';
fs.rmSync(path.join(root,outDir),{recursive:true,force:true});

const site=Site.buildSeoSite({
  root,outDir,
  siteOrigin:'https://www.unlockvenice.com',
  now:new Date('2026-09-26T12:00:00Z')
});

assert.equal(site.mode,'public');
assert.equal(site.pages,76,'public crawl must cover 76 localized pages');
assert.equal(site.placePages,44);
assert.equal(site.routePages,32);
assert.equal(site.skipped.length,0,'ready public build must not skip landing clusters');
assert.equal(site.sitemaps.totalUrls,76,'public sitemap/build parity mismatch');

const byCanonical=new Map(site.results.map(result=>[result.canonical,result]));
assert.equal(byCanonical.size,76,'canonical URLs must be unique');
const cssFile=path.join(root,outDir,'trasporti/seo-assets/landing.css');
assert(fs.existsSync(cssFile),'shared public landing CSS missing');

function hrefs(html,className){
  const rx=new RegExp('<a[^>]*class="[^"]*\\b'+className+'\\b[^"]*"[^>]*href="([^"]+)"','g');
  return [...html.matchAll(rx)].map(m=>m[1].replace(/&amp;/g,'&'));
}
function alternates(html){
  return [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)]
    .map(m=>({lang:m[1],href:m[2].replace(/&amp;/g,'&')}));
}
function sitemapLocs(xml){
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
}
function localizedEditorialOk(url,lang){
  const pathname=new URL(url).pathname;
  if(lang==='it')return !/^\/(?:en|fr|de)\//.test(pathname);
  return pathname.startsWith('/'+lang+'/');
}

for(const result of site.results){
  const html=fs.readFileSync(result.out,'utf8');
  assert(html.includes('<meta name="robots" content="index,follow">'),'public robots mismatch '+result.canonical);
  assert(html.includes('<link rel="canonical" href="'+result.canonical+'">'),'canonical mismatch '+result.canonical);
  assert.equal((html.match(/<h1>/g)||[]).length,1,'H1 count mismatch '+result.canonical);
  assert(!/<script\b/i.test(html),'public content must not depend on JavaScript '+result.canonical);
  assert(!html.includes('uv-preview-bar'),'preview chrome leaked '+result.canonical);
  assert(!/%%[A-Z0-9_]+%%|\{\{/.test(html),'unresolved token '+result.canonical);
  assert(html.includes('href="/trasporti/seo-assets/landing.css"'),'shared CSS href mismatch '+result.canonical);

  const alts=alternates(html);
  assert.equal(alts.length,5,'expected four locales + x-default '+result.canonical);
  for(const alt of alts){
    if(alt.lang==='x-default'){
      assert(alt.href.includes('/trasporti/'),'x-default must point to canonical Italian transport layer '+result.canonical);
      continue;
    }
    const target=byCanonical.get(alt.href);
    assert(target,'hreflang target missing from public build '+alt.href);
    const targetHtml=fs.readFileSync(target.out,'utf8');
    assert(
      targetHtml.includes('hreflang="'+result.lang+'" href="'+result.canonical+'"'),
      'hreflang reciprocity missing '+result.canonical+' -> '+alt.href
    );
  }

  const transportLinks=hrefs(html,'uv-link-live');
  assert(transportLinks.length>=2&&transportLinks.length<=4,'transport link count '+result.canonical+': '+transportLinks.length);
  for(const href of transportLinks){
    const absolute=new URL(href,'https://www.unlockvenice.com').href;
    assert(byCanonical.has(absolute),'internal transport target not built '+result.canonical+' -> '+absolute);
  }

  const readingLinks=hrefs(html,'uv-reading-card');
  assert(readingLinks.length>=3&&readingLinks.length<=6,'related-reading count '+result.canonical+': '+readingLinks.length);
  for(const href of readingLinks){
    assert(localizedEditorialOk(href,result.lang),'cross-language editorial link '+result.lang+' '+result.canonical+' -> '+href);
  }
}

const placesXml=fs.readFileSync(site.sitemaps.files.places,'utf8');
const routesXml=fs.readFileSync(site.sitemaps.files.routes,'utf8');
const locs=[...sitemapLocs(placesXml),...sitemapLocs(routesXml)];
assert.equal(locs.length,76,'sitemap must expose 76 localized loc entries');
assert.equal(new Set(locs).size,76,'sitemap loc entries must be unique');
assert.deepEqual(new Set(locs),new Set(byCanonical.keys()),'sitemap URLs and generated HTML canonicals must match exactly');

fs.rmSync(path.join(root,outDir),{recursive:true,force:true});
console.log('RESULT: HTML crawl passes all 76 ready pages without JS; sitemap parity, canonical/hreflang reciprocity, internal links and localized editorial links are valid.');
