const fs=require('fs'),path=require('path'),assert=require('assert');
const V=require(path.resolve(__dirname,'../scripts/validate_seo_landing_manifest.cjs'));
const read=p=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'..',p),'utf8'));

const fixtures={
  places:read('seo/pages/places.json'),
  routes:read('seo/pages/routes.json'),
  registry:read('data/entities/poi.json'),
  routeCatalog:read('data/deep-links/routes.json'),
  copyContract:read('seo/content/COPY-CONTRACT.json')
};

const result=V.validateAll(fixtures);
assert.deepEqual(result,{placePages:11,routePages:8,totalPages:19,readyPages:19});
assert(fixtures.places.pages.every(p=>p.contentState==='ready'),'first place tranche must be ready after final publication gate');
assert(fixtures.routes.pages.every(p=>p.contentState==='ready'),'first route tranche must be ready after final publication gate');
assert(fixtures.places.internalLinking.min===2&&fixtures.places.internalLinking.max===4,'place internal linking must stay selective');
assert(fixtures.routes.internalLinking.min===2&&fixtures.routes.internalLinking.max===4,'route internal linking must stay selective');

const badEntity=structuredClone(fixtures);
badEntity.places.pages[0].entity='poi:missing';
assert.throws(()=>V.validateAll(badEntity),/Unknown place entity/);

const duplicateRouteSlug=structuredClone(fixtures);
duplicateRouteSlug.routes.pages[1].slugs.it=duplicateRouteSlug.routes.pages[0].slugs.it;
assert.throws(()=>V.validateAll(duplicateRouteSlug),/Duplicate route slug/);

const plannedStillValid=structuredClone(fixtures);
plannedStillValid.places.pages[0].contentState='planned';
assert.equal(V.validateAll(plannedStillValid).readyPages,18,'validator must keep planned pages valid but outside the ready count');

const brokenCopy=structuredClone(fixtures);
brokenCopy.copyContract.place.sections=brokenCopy.copyContract.place.sections.filter(s=>s.id!=='faq');
assert.throws(()=>V.validateAll(brokenCopy),/missing section faq/);

const spammyLinks=structuredClone(fixtures);
spammyLinks.copyContract.internalLinking.transportLandingLinks.max=12;
assert.throws(()=>V.validateAll(spammyLinks),/bounds must be 2–4/);

console.log('RESULT: SEO landing manifests validate 11 places + 8 routes in ready state, localized source references, Q&A contract and selective internal linking.');
