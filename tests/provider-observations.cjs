const fs=require('fs'),vm=require('vm'),assert=require('assert');
const calls=[];
const tuFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:1780000000},entity:[
  {id:'tu1',tripUpdate:{trip:{tripId:'RAW-UNMATCHED',routeId:'RAW-R'},delay:45,timestamp:1780000001}}
]};
const vpFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:1780000000},entity:[
  {id:'vp1',vehicle:{trip:{tripId:'RAW-UNMATCHED',routeId:'RAW-R'},vehicle:{id:'BUS-X'},position:{latitude:45.49,longitude:12.24},timestamp:1780000002}},
  {id:'vp2',vehicle:{trip:{},vehicle:{id:'BUS-UNKNOWN'},timestamp:1780000003}}
]};
async function fetch(url){
  url=String(url);calls.push(url);
  const tag=url.includes('feed=tripUpdates')?1:url.includes('feed=vehiclePositions')?2:0;
  return {ok:tag>0,status:tag>0?200:404,arrayBuffer:async()=>Uint8Array.from([tag]).buffer,json:async()=>({})};
}
const window={};window.window=window;
window.UVTransitGTFSRT={decodeFeed:(buf)=>{const tag=new Uint8Array(buf)[0];return tag===1?tuFeed:vpFeed}};
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error,Math,encodeURIComponent});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/observations.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/observation-history.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

(async()=>{
  const P=window.UVTransitProvider;
  const first=await P.loadObservations('aut');
  assert.equal(first.observations.length,3);
  assert.equal(first.stats.observations,3);
  assert.equal(first.stats.positioned,1);
  assert(first.history);assert.equal(first.historySummary.entries,3);assert.equal(first.historySummary.batches,1);
  assert(first.observations.some(o=>o.externalTripId==='RAW-UNMATCHED'));
  assert(first.observations.some(o=>o.externalVehicleId==='BUS-UNKNOWN'&&o.position===null));
  assert(!calls.some(x=>x.includes('manifest.json')),'observation ingestion must not depend on static matching');
  assert.equal(calls.filter(x=>x.includes('feed=tripUpdates')).length,1);
  assert.equal(calls.filter(x=>x.includes('feed=vehiclePositions')).length,1);

  const second=await P.loadObservations('aut');
  assert.strictEqual(second.store,first.store);
  assert.equal(second.store.summary().observations,3);
  assert.equal(second.historySummary.entries,3);assert.equal(second.historySummary.batches,2);
  assert(second.historySummary.deduplicated>=3);
  assert.strictEqual(P._test.observationHistoryStore('aut'),P._test.observationHistoryStore('aut'));
  assert.equal(calls.filter(x=>x.includes('feed=tripUpdates')).length,1,'raw pair should be shared inside short cache window');
  assert.equal(calls.filter(x=>x.includes('feed=vehiclePositions')).length,1,'raw pair should be shared inside short cache window');
  assert.strictEqual(P._test.observationStore('aut'),first.store);
  console.log('RESULT: 16 ACTV observation + normalized history integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
