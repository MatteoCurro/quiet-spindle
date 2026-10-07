const fs=require('fs'),vm=require('vm'),assert=require('assert');
const c={Intl,Date,Map,Set};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../js/journey/schedule.js','utf8'),c);const {Schedule}=c.UVTransitSchedule;
const now=Date.parse('2026-09-18T08:00:00+02:00')/1000;
const stops=[['a','Cattaneo',45.49,12.24,''],['b','Mestre Centro',45.50,12.25,'']];
const routes=[['r','T1',0]];
const trip=['t','r','Mestre Centro','s',[['a',1,8*3600+10*60,8*3600+10*60,1,0],['b',2,8*3600+20*60,8*3600+20*60,1,1]]];
const runtime={schema:2,network:'aut',timezone:'Europe/Rome',buildDay:'20260918',days:['20260917','20260918','20260919','20260920','20260921','20260922','20260923','20260924'],routes,stops,transfers:[],chunksData:{
  '20260917':{schema:2,network:'aut',day:'20260917',trips:[]},
  '20260918':{schema:2,network:'aut',day:'20260918',trips:[trip]},
  '20260919':{schema:2,network:'aut',day:'20260919',trips:[trip]},
  '20260920':{schema:2,network:'aut',day:'20260920',trips:[]},
  '20260921':{schema:2,network:'aut',day:'20260921',trips:[]},
  '20260922':{schema:2,network:'aut',day:'20260922',trips:[]},
  '20260923':{schema:2,network:'aut',day:'20260923',trips:[]},
  '20260924':{schema:2,network:'aut',day:'20260924',trips:[]}
}};
let count=0;function test(n,f){f();count++;console.log('PASS '+n)}
test('chunked runtime dataset loads',()=>{const s=new Schedule(),m=s.loadRuntime(runtime,now);assert(m.runtime);assert.equal(m.schema,2);assert.equal(m.trips,1)});
test('same trip across chunks merges service dates',()=>{const s=new Schedule();s.loadRuntime(runtime,now);assert.deepEqual([...s.trips.get('t').dates],['20260918','20260919'])});
test('runtime departures preserve exact seconds',()=>{const s=new Schedule();s.loadRuntime(runtime,now);const d=s.departures('a',now,6);assert.equal(d.length,1);assert.equal(d[0].route,'T1');assert.equal(d[0].time,Date.parse('2026-09-18T08:10:00+02:00')/1000)});
test('runtime search preserves stop IDs',()=>{const s=new Schedule();s.loadRuntime(runtime,now);assert.equal(s.search('Cattaneo')[0].id,'a')});
test('runtime plan works without CSV',()=>{const s=new Schedule();s.loadRuntime(runtime,now);const r=s.plan([{id:'a'}],['b'],now);assert(r.length);assert.equal(r[0].legs[0].shape,'s')});
test('missing current-day chunk fails explicitly',()=>{const s=new Schedule(),bad={...runtime,chunksData:{...runtime.chunksData}};delete bad.chunksData['20260918'];assert.throws(()=>s.loadRuntime(bad,now),/non aggiornato|Nessuna corsa/)});
console.log('RESULT: '+count+' runtime schedule tests passed.');
