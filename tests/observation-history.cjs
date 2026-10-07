const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Math,Date,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/observation-history.js','utf8'),ctx);
const H=window.UVTransitObservationHistory;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

const store=H.createObservationHistoryStore({retentionSec:120,maxEntries:3,maxBatches:3});
const obs=(id,at,extra={})=>Object.freeze({
 id,provider:'p',network:'aut',kind:'vehicle_position',observedAt:at,receivedAt:at,
 externalVehicleId:'V'+id,externalTripId:'T'+id,position:{lat:45,lon:12},
 provenance:{format:'gtfs-rt'},details:{},...extra
});

check('ingest stores canonical observations',()=>{
 const r=store.ingest([obs('1',100),obs('2',101)],{provider:'p',network:'aut',receivedAt:101});
 assert.equal(r.added,2);assert.equal(r.updated,0);assert.equal(r.summary.entries,2);
});
check('same Observation id is deduplicated and last receipt advances',()=>{
 const newer=obs('1',100,{receivedAt:110});
 const r=store.ingest([newer],{provider:'p',network:'aut',receivedAt:110});
 assert.equal(r.added,0);assert.equal(r.updated,1);
 const row=store.snapshot(110).query({externalVehicleId:'V1'})[0];
 assert.equal(row.seenCount,2);assert.equal(row.firstReceivedAt,100);assert.equal(row.lastReceivedAt,110);
});
check('driver/device GPS is rejected by construction',()=>{
 const privateObs=obs('driver',111,{provenance:{format:'driver-gps'},details:{sourceKind:'driver_device'}});
 const r=store.ingest([privateObs],{receivedAt:111});
 assert.equal(r.rejectedPrivate,1);assert.equal(store.snapshot(111).query({externalVehicleId:'Vdriver'}).length,0);
});
check('query supports trip, vehicle and time filters',()=>{
 const s=store.snapshot(111);
 assert.equal(s.query({externalTripId:'T1'}).length,1);
 assert.equal(s.query({externalVehicleId:'V2'}).length,1);
 assert.equal(s.query({from:101,to:101}).length,1);
});
check('entry cap removes oldest last-seen rows',()=>{
 store.ingest([obs('3',112),obs('4',113)],{receivedAt:113});
 const s=store.snapshot(113);
 assert.equal(s.entries.length,3);
 assert.equal(s.query({externalVehicleId:'V2'}).length,0);
 assert.equal(s.query({externalVehicleId:'V1'}).length,1);
});
check('batch metadata is bounded independently from entries',()=>{
 store.ingest([obs('5',114)],{receivedAt:114});
 store.ingest([obs('6',115)],{receivedAt:115});
 const s=store.snapshot(115);
 assert.equal(s.batches.length,3);
});
check('retention prunes stale normalized observations',()=>{
 const s=store.snapshot(300);
 assert.equal(s.entries.length,0);assert.equal(s.batches.length,0);assert(s.stats.pruned>=3);
});
check('summary exposes counts without coordinates',()=>{
 store.ingest([obs('7',310)],{provider:'p',network:'aut',receivedAt:310});
 const summary=store.summary(310),json=JSON.stringify(summary);
 assert.equal(summary.entries,1);assert.equal(summary.kinds.vehicle_position,1);
 assert(!json.includes('"lat"'));assert(!json.includes('"lon"'));
});
check('snapshot graph is immutable',()=>{
 const s=store.snapshot(310);
 assert(Object.isFrozen(s));assert(Object.isFrozen(s.entries));assert(Object.isFrozen(s.entries[0]));
});
check('clear removes history only',()=>{store.clear();assert.equal(store.snapshot(310).entries.length,0)});

console.log('RESULT: '+n+' ObservationHistory checks passed.');
