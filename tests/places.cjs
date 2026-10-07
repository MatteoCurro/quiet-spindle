const vm=require('vm'),fs=require('fs'),assert=require('assert');
let payload,handler=null,calls=0,seen=[];
const streets={schema:1,version:'v1',streets:[
 {id:1,name:'Via Torino',key:'via torino',core:'torino',lat:45.478,lon:12.255,shard:0,count:5,zone:''},
 {id:2,name:'Via Torre Belfredo',key:'via torre belfredo',core:'torre belfredo',lat:45.495,lon:12.24,shard:0,count:2,zone:''},
 {id:3,name:'Via 20 Settembre',key:'via 20 settembre',core:'20 settembre',lat:45.49,lon:12.25,shard:0,count:1,zone:''}
]};
for(let i=4;i<1005;i++)streets.streets.push({id:i,name:'Strada Test '+i,key:'strada test '+i,core:'test '+i,lat:45.4,lon:12.2,shard:Math.floor(i/128),count:1,zone:''});
const shard={schema:1,version:'v1',streets:{'1':[['1/C',45.477,12.252],['15',45.478,12.254],['155',45.4786,12.2556],['157',45.4788,12.2558],['176',45.479,12.256]],'2':[['14',45.495,12.24]],'3':[['10',45.49,12.25]]}};
function fixture(url){const u=new URL(url);seen.push(String(url));calls++;if(u.pathname.endsWith('/manifest.json'))return {provider:'Comune di Venezia - TopoCivici',version:'v1',index:'v1/streets.json',shard_base:'v1/shards/',indexed_civics:80000};if(u.pathname.endsWith('/v1/streets.json'))return streets;if(u.pathname.endsWith('/v1/shards/000.json'))return shard;if(u.hostname==='photon.komoot.io')return {features:[{properties:{name:'Hotel Plaza',street:'Viale Stazione',housenumber:'36',city:'Venezia',district:'Mestre'},geometry:{type:'Point',coordinates:[12.231,45.482]}}]};return payload;}
const ctx={URL,URLSearchParams,AbortController,setTimeout,clearTimeout,document:{baseURI:'https://unlockvenice.test/t-sand/'},location:{href:'https://unlockvenice.test/t-sand/',origin:'https://unlockvenice.test'},fetch:async url=>({ok:true,json:async()=>handler?handler(String(url)):fixture(String(url))})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../js/journey/places.js','utf8'),ctx);
(async()=>{
 handler=null;seen=[];calls=0;
 const streetRows=await ctx.UVTransitPlaces.search('Via Tor');assert(streetRows.length>=2);assert.equal(streetRows[0].street,'Via Torino');assert.equal(streetRows[0].source,'comune-venezia');assert(seen.some(x=>x.includes('/trasporti/runtime-data/addresses/manifest.json')));console.log('PASS street autocomplete is served by local official index');
 const civicPrefix=await ctx.UVTransitPlaces.search('Via Torino 15');assert(civicPrefix.length>=3);assert.equal(civicPrefix[0].house,'15');assert(civicPrefix.some(x=>x.house==='155'));assert(civicPrefix.some(x=>x.house==='157'));assert(civicPrefix.every(x=>x.street==='Via Torino'));console.log('PASS civic autocomplete narrows the selected street while typing');
 const exact=await ctx.UVTransitPlaces.search('Torino 155 Mestre');assert.equal(exact[0].house,'155');assert.equal(exact[0].exactHouse,true);assert.equal(exact[0].street,'Via Torino');console.log('PASS street core + civic + locality resolves exact official address');
 const numericStreet=await ctx.UVTransitPlaces.search('Via 20 Settembre');assert.equal(numericStreet[0].kind,'street');assert.equal(numericStreet[0].street,'Via 20 Settembre');console.log('PASS numeric street names are not mistaken for civic numbers');
 const contextual=await ctx.UVTransitPlaces.civics('Via Torino','15');assert(contextual.some(x=>x.house==='155'));assert(contextual.every(x=>x.street==='Via Torino'));console.log('PASS contextual civic lookup uses the same local shard');
 const beforePhoton=seen.length;const poi=await ctx.UVTransitPlaces.search('Hotel Plaza Mestre');assert.equal(poi[0].source,'photon');assert(seen.slice(beforePhoton).some(x=>x.includes('photon.komoot.io')));console.log('PASS Photon remains only as fallback for non-address places');
 handler=()=>{throw Error('remote walking service must not be called')};
 ctx.UVLocalWalk={
  matrix:async(place,stops)=>stops.map((stop,i)=>({id:stop.id,seconds:40+i,distance:60+i,stop,verified:true,exact:true})),
  matrixPairs:async links=>links.map((link,i)=>({key:link.key,seconds:30+i,distance:45+i,verified:true,exact:true})),
  walk:async()=>({seconds:70,distance:90,points:[[45,12],[45.001,12.001]]})
 };
 const localMatrix=await ctx.UVTransitPlaces.matrix({lat:45.49,lon:12.24},[{id:'a',lat:45.491,lon:12.241}]);assert.equal(localMatrix[0].seconds,40);assert(localMatrix[0].exact);console.log('PASS local OSM matrix is primary when available');
 const localPairs=await ctx.UVTransitPlaces.matrixPairs([{key:'a-b',from:{lat:45,lon:12},to:{lat:45.01,lon:12.01}}]);assert.equal(localPairs[0].seconds,30);assert(localPairs[0].exact);console.log('PASS local OSM transfer routing is primary when available');
 const localWalk=await ctx.UVTransitPlaces.walk({lat:45,lon:12},{lat:45.001,lon:12.001});assert.equal(localWalk.seconds,70);assert.equal(localWalk.source,'local-osm');assert(localWalk.exact);console.log('PASS local OSM exact walking is primary when available');
 let routeCalls=0,matrixCalls=0;
 const sibling={id:'aut:good',name:'VENEZIA',network:'aut',lat:45.4381,lon:12.3184};
 const stranded={id:'aut:bad',name:'VENEZIA',network:'aut',lat:45.4382,lon:12.3190,hubMembers:[]};stranded.hubMembers=[stranded,sibling];
 const pontile={id:'nav:p',name:'P.le Roma "F"',network:'nav',lat:45.4389,lon:12.3188};
 ctx.UVLocalWalk={
  walk:async(a,b)=>{routeCalls++;if(a.id==='aut:good')return {seconds:140,distance:150,points:[[a.lat,a.lon],[b.lat,b.lon]]};const e=Error('no path');e.code='LOCAL_NO_PATH';throw e},
  matrix:async(a,targets)=>{matrixCalls++;return a.id==='aut:good'?[{id:'0',seconds:130,distance:140,stop:targets[0],verified:true,exact:true}]:[]}
 };
 const hubAdjusted=await ctx.UVTransitPlaces.walk(stranded,pontile);assert(hubAdjusted.hubAdjusted);assert.equal(hubAdjusted.fromAnchor.id,'aut:good');assert(hubAdjusted.seconds>140);assert(matrixCalls>0&&routeCalls>1);console.log('PASS disconnected land platform can use a walkable sibling inside the same physical hub');
 const waterA={id:'nav:a',network:'nav',lat:45.4265,lon:12.3635},waterB={id:'nav:b',network:'nav',lat:45.4174,lon:12.3680};waterA.hubMembers=[waterA,sibling];
 await assert.rejects(()=>ctx.UVTransitPlaces.walk(waterA,waterB),/Percorso a piedi non disponibile/);console.log('PASS water stops never inherit land-hub sibling shortcuts');

 delete ctx.UVLocalWalk;

 handler=url=>{const u=new URL(url);if(u.pathname.includes('sources_to_targets'))return {sources_to_targets:{durations:[[100,200]],distances:[[.1,.2]]}};throw Error('unexpected '+url)};
 const matrix=await ctx.UVTransitPlaces.matrix({lat:45.49,lon:12.24},[{id:'a',lat:45.491,lon:12.241},{id:'b',lat:45.492,lon:12.242}]);assert.equal(matrix.length,2);assert.equal(matrix[0].seconds,100);assert.equal(matrix[1].distance,200);console.log('PASS Valhalla matrix screening unchanged');
 handler=url=>{const u=new URL(url);if(u.pathname.includes('sources_to_targets'))return {sources_to_targets:{durations:[[55,999],[999,75]],distances:[[.05,.9],[.9,.08]]}};throw Error('unexpected '+url)};
 const pairs=await ctx.UVTransitPlaces.matrixPairs([{key:'a-b',from:{lat:45,lon:12},to:{lat:45.01,lon:12.01}},{key:'c-d',from:{lat:45.02,lon:12.02},to:{lat:45.03,lon:12.03}}]);assert.equal(pairs[0].seconds,55);assert.equal(pairs[1].seconds,75);console.log('PASS batched transfer matrix unchanged');
 handler=null;payload={trip:{status:0,summary:{time:90,length:.12,has_ferry:true},legs:[]}};
 const oldFixture=fixture;handler=url=>{if(url.includes('valhalla'))return payload;return oldFixture(url)};await assert.rejects(()=>ctx.UVTransitPlaces.walk({lat:45,lon:12},{lat:45.1,lon:12}),/traghetto/);console.log('PASS walking rejects ferry');
 payload={trip:{status:0,summary:{time:90,length:.12,has_ferry:false},legs:[{shape:'??',maneuvers:[]}]}};const w=await ctx.UVTransitPlaces.walk({lat:45,lon:12},{lat:45.2,lon:12});assert.equal(w.seconds,90);assert.equal(w.distance,120);assert.deepEqual(Array.from(w.points[0]),[0,0]);console.log('PASS walking time distance and polyline decoding');
})().catch(e=>{console.error(e);process.exitCode=1});
