const path=require('path'),assert=require('assert');
const R=require(path.resolve(__dirname,'../scripts/resolve_seo_placeholders.cjs'));

const ctx=R.loadContext(path.resolve(__dirname,'..'));

const parsed=R.parsePlaceholder('{{journey_cta route="uv_mestre_station_san_marco" label="Calcola il percorso"}}');
assert.deepEqual(parsed,{name:'journey_cta',attrs:{route:'uv_mestre_station_san_marco',label:'Calcola il percorso'}});
assert.throws(()=>R.parsePlaceholder('{{journey_cta route=bad}}'),/Invalid placeholder attributes/);
assert.throws(()=>R.resolvePlaceholder('{{unknown}}','seo-route-mestre-san-marco','it',ctx),/Unknown placeholder/);
assert.throws(()=>R.resolvePlaceholder('{{journey_cta route="uv_mestre_station_san_marco" bad="x"}}','seo-route-mestre-san-marco','it',ctx),/Unsupported journey_cta attribute/);
assert.throws(()=>R.resolvePlaceholder('{{journey_cta route="uv_mestre_station_san_marco" to="poi:uv_venice_san_marco"}}','seo-route-mestre-san-marco','it',ctx),/cannot combine route and to/);

const cta=R.resolvePlaceholder(
  '{{journey_cta route="uv_mestre_station_san_marco" label="Calcola il percorso"}}',
  'seo-route-mestre-san-marco','it',ctx,{appBase:'/trasporti'}
);
assert.equal(cta.type,'journey_cta');
assert.equal(cta.href,'/trasporti/go/r/uv_mestre_station_san_marco?lang=it&ref=seo_landing&campaign=seo-route-mestre-san-marco');
assert.equal(cta.label,'Calcola il percorso');
assert.deepEqual(cta.attribution,{ref:'seo_landing',campaign:'seo-route-mestre-san-marco'});

const placeCta=R.resolvePlaceholder(
  '{{journey_cta}}','seo-place-san-marco','it',ctx,{appBase:'/trasporti'}
);
assert.equal(placeCta.href,'/trasporti/go/p/uv_venice_san_marco?from=current&lang=it&ref=seo_landing&campaign=seo-place-san-marco');
assert(placeCta.label.includes('Piazza San Marco'));

const enSanMarco=R.pageContext('seo-place-san-marco',ctx);
assert.equal(R.landingHref(enSanMarco,'en',ctx),'/en/trasporti/places/st-marks-square/');
assert.equal(R.landingHref(R.pageContext('seo-route-mestre-san-marco',ctx),'it',ctx),'/trasporti/percorsi/stazione-mestre-piazza-san-marco/');

const urbanFares=R.resolvePlaceholder(
  '{{fare_table group="venice-urban"}}','seo-place-san-marco','it',ctx
);
assert.equal(urbanFares.type,'fare_table');
assert.equal(urbanFares.group,'venice-urban');
assert(urbanFares.items.some(x=>x.id==='actv-road-75'&&x.price===1.5&&x.displayPrice.includes('1,50')));
assert(urbanFares.items.some(x=>x.id==='actv-network-75'&&x.price===9.5&&x.displayPrice.includes('9,50')));
assert(urbanFares.items.some(x=>x.id==='actv-day-1'&&x.priceType==='from'&&x.displayPrice.startsWith('da ')));
assert(urbanFares.items.every(x=>x.lastVerified&&x.sourceUrl),'fare rows must expose verification date and source');

const mestreFares=R.resolvePlaceholder(
  '{{fare_table group="mestre-venice"}}','seo-route-mestre-san-marco','it',ctx
);
const trainFare=mestreFares.items.find(x=>x.id==='trenitalia-mestre-santalucia');
assert(trainFare&&trainFare.price===1.5&&trainFare.sourceType==='indicative-third-party','Mestre train fare must remain explicitly indicative');

const airportFares=R.resolvePlaceholder(
  '{{fare_table group="airport-venice"}}','seo-place-marco-polo-airport','it',ctx
);
assert(airportFares.items.some(x=>x.id==='actv-airport-oneway'&&x.price===10));
assert(airportFares.items.some(x=>x.id==='alilaguna-airport-venice-oneway'&&x.price===18));
assert.throws(()=>R.resolvePlaceholder('{{fare_table group="missing"}}','seo-place-san-marco','it',ctx),/Unknown fare group/);

const productionRelated=R.resolveRelatedTransport('seo-route-mestre-san-marco','it',ctx,{includePlanned:false});
assert(productionRelated.items.length>=2&&productionRelated.items.length<=4,'ready production pages must expose selective internal links');
assert(productionRelated.items.every(x=>x.href.startsWith('/trasporti/')),'production related transport must use localized canonical landing hrefs');

const previewRelated=R.resolveRelatedTransport('seo-route-mestre-san-marco','it',ctx,{includePlanned:true});
assert(previewRelated.items.length>=2&&previewRelated.items.length<=4,'pilot preview must return selective related transport links');
assert(previewRelated.items.some(x=>x.pageId==='seo-place-mestre-station'&&x.reason==='route-origin'),'route origin place missing from preview internal links');
assert(previewRelated.items.some(x=>x.pageId==='seo-place-san-marco'&&x.reason==='route-destination'),'route destination place missing from preview internal links');
assert(previewRelated.items.every(x=>x.href.startsWith('/trasporti/')),'Italian preview returned non-localized landing href');

const previewEn=R.resolveRelatedTransport('seo-route-mestre-san-marco','en',ctx,{includePlanned:true});
assert(previewEn.items.every(x=>x.href.startsWith('/en/trasporti/')),'English preview returned wrong localized href');

const Related=require(path.resolve(__dirname,'../scripts/score_seo_related_content.cjs'));
const trevisoReading=R.resolveRelatedReading('seo-place-treviso-airport','it',ctx,{now:new Date('2026-10-05T12:00:00Z')});
assert(trevisoReading.items.length>=3,'Treviso Airport must inherit enough relevant editorial reading from its connected Mestre hub');
const trevisoPrimary=Related.rankRelated(ctx.index,ctx.registry,'airport:uv_treviso','it',{
  limit:6,minScore:Related.DEFAULTS.minScore,overrides:ctx.overrides,now:new Date('2026-10-05T12:00:00Z')
});
if(trevisoPrimary.results.length<3){
  assert(trevisoReading.items.some(x=>x.reason==='connected-hub-ranking'&&x.sourceEntities.includes('hub:uv_mestre_station')),
    'Treviso Airport editorial fallback must use only its explicit connected hub');
}

const reading=R.resolveRelatedReading('seo-route-mestre-san-marco','it',ctx,{now:new Date('2026-09-26T12:00:00Z')});
assert(reading.items.length>0&&reading.items.length<=6,'pilot route returned no editorial related reading');
assert(reading.items.every(x=>x.url.includes('unlockvenice.com')),'related reading contains unexpected external URL');
assert(reading.items.every(x=>x.sourceEntities.every(id=>['hub:uv_mestre_station','poi:uv_venice_san_marco'].includes(id))),'route reading used an unrelated source entity');

const mestreRank=Related.rankRelated(ctx.index,ctx.registry,'hub:uv_mestre_station','it',{
  limit:12,minScore:Related.DEFAULTS.minScore,overrides:ctx.overrides,now:new Date('2026-09-26T12:00:00Z')
});
if(mestreRank.results.length){
  assert(reading.items.some(x=>x.sourceEntities.includes('hub:uv_mestre_station')),'route merge must preserve origin diversity when origin candidates exist');
}


const balanced=R.mergeRouteReading(
  {entityId:'origin:test',results:[
    {url:'https://example.test/o1',title:'Origin one',published:'2026-01-01',score:30,exactEntity:false,manualInclude:false,signals:[]},
    {url:'https://example.test/o2',title:'Origin two',published:'2026-01-01',score:29,exactEntity:false,manualInclude:false,signals:[]}
  ]},
  {entityId:'dest:test',results:[
    {url:'https://example.test/d1',title:'Destination one',published:'2026-01-01',score:100,exactEntity:true,manualInclude:false,signals:[]},
    {url:'https://example.test/d2',title:'Destination two',published:'2026-01-01',score:99,exactEntity:true,manualInclude:false,signals:[]},
    {url:'https://example.test/d3',title:'Destination three',published:'2026-01-01',score:98,exactEntity:true,manualInclude:false,signals:[]},
    {url:'https://example.test/d4',title:'Destination four',published:'2026-01-01',score:97,exactEntity:true,manualInclude:false,signals:[]}
  ]},
  6
);
assert.equal(balanced.length,6);
assert(balanced.filter(x=>x.sourceEntities.includes('origin:test')).length>=2,'six-item route block should reserve up to two valid origin slots');
assert(balanced.filter(x=>x.sourceEntities.includes('dest:test')).length>=2,'six-item route block should preserve destination relevance');

const blocks=R.resolvePageBlocks('seo-route-mestre-san-marco','it',ctx,{
  appBase:'/t-sand',
  includePlanned:true,
  now:new Date('2026-09-26T12:00:00Z')
});
assert.equal(blocks.journey_cta.href,'/t-sand/go/r/uv_mestre_station_san_marco?lang=it&ref=seo_landing&campaign=seo-route-mestre-san-marco');
assert(blocks.related_transport.items.length>=2);
assert(blocks.related_reading.items.length>0);
console.log('PILOT RELATED TRANSPORT',blocks.related_transport.items);
console.log('PILOT RELATED READING',blocks.related_reading.items.slice(0,6).map(x=>({score:x.score,title:x.title,reason:x.reason,sources:x.sourceEntities})));

console.log('RESULT: SEO placeholders resolve Journey CTAs, verified tourist fares, ready-only localized internal links and same-language editorial reading.');
