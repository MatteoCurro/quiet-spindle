const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={};
const seen=[];
async function fetch(url){
  url=String(url);seen.push(url);
  const data=payloads[url];
  return {ok:!!data,status:data?200:404,json:async()=>data};
}
const window={};window.window=window;
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/service-date-resolver.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const old={
  id:'old',sourceZipSha256:'oldhash',
  core:{file:'old-core.json'},shapes:{file:'old-shapes.json'},
  schedule:{file:'old-schedule.json'},serviceDates:['20260928']
};
const latest={
  id:'latest',sourceZipSha256:'newhash',
  core:{file:'new-core.json'},shapes:{file:'new-shapes.json'},
  schedule:{file:'new-schedule.json'},serviceDates:['20260929','20260930']
};
const manifest={schema:1,networks:{aut:{
  sourceZipSha256:'newhash',core:latest.core,shapes:latest.shapes,schedule:latest.schedule,
  snapshots:[latest,old]
}}};

payloads['https://example.test/trasporti/runtime-data/old-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260928'],
  routes:[['r-old','1',3]],stops:[['a','A',45,12,''],['b','B',45.1,12.1,'']],
  transfers:[],transferRules:[],chunks:{'20260928':{file:'old-28.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/new-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260929','20260930'],
  routes:[['r-new','2',3]],stops:[['b','B',45.1,12.1,''],['c','C',45.2,12.2,'']],
  transfers:[],transferRules:[],chunks:{
    '20260929':{file:'new-29.json',trips:1},
    '20260930':{file:'new-30.json',trips:1}
  }
};
payloads['https://example.test/trasporti/runtime-data/old-28.json']={schema:2,network:'aut',day:'20260928',trips:[['old-trip','r-old','','',[['a',1,3600,3600,1,0],['b',2,4200,4200,1,1]]]]};
payloads['https://example.test/trasporti/runtime-data/new-29.json']={schema:2,network:'aut',day:'20260929',trips:[['new-trip','r-new','','',[['b',1,3600,3600,1,0],['c',2,4200,4200,1,1]]]]};

(async()=>{
  const P=window.UVTransitProvider;
  assert.equal(P._test.snapshotForDay(manifest.networks.aut,'20260928').id,'old');
  assert.equal(P._test.snapshotForDay(manifest.networks.aut,'20260929').id,'latest');
  const out=await P._test.loadResolvedSchedule('aut',manifest,['20260928','20260929']);
  assert.deepEqual([...out.data.days],['20260928','20260929']);
  assert.equal(out.data.snapshotByDay['20260928'],'old');
  assert.equal(out.data.snapshotByDay['20260929'],'latest');
  assert.equal(out.data.chunksData['20260928'].trips[0][0],'old-trip');
  assert.equal(out.data.chunksData['20260929'].trips[0][0],'new-trip');
  assert(out.data.routes.some(r=>r[0]==='r-old'));
  assert(out.data.routes.some(r=>r[0]==='r-new'));
  assert(seen.includes('https://example.test/trasporti/runtime-data/old-schedule.json'));
  assert(seen.includes('https://example.test/trasporti/runtime-data/new-schedule.json'));
  console.log('RESULT: 10 provider service-date runtime checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
