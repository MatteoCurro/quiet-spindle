const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8');
const index={schema:2,network:'aut',days:['20260917','20260918'],chunks:{
 '20260917':{file:'aut-schedule-day-20260917.a.json'},
 '20260918':{file:'aut-schedule-day-20260918.b.json'}
},routes:[],stops:[],transfers:[]};
const payloads={
 'https://example.test/trasporti/runtime-data/aut-schedule.index.json':index,
 'https://example.test/trasporti/runtime-data/aut-schedule-day-20260917.a.json':{schema:2,network:'aut',day:'20260917',trips:[]},
 'https://example.test/trasporti/runtime-data/aut-schedule-day-20260918.b.json':{schema:2,network:'aut',day:'20260918',trips:[['t','r','','',[]]]}
};
const seen=[];
async function fetch(url){seen.push(String(url));const data=payloads[String(url)];return {ok:!!data,status:data?200:404,json:async()=>data};}
const window={};window.window=window;const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){}});vm.runInContext(code,ctx);
(async()=>{
 const manifest={schema:1,networks:{aut:{core:{file:'aut-core.json'},schedule:{file:'aut-schedule.index.json'}}}};
 const out=await window.UVTransitProvider.loadRuntimeSchedule('aut',manifest);
 assert.equal(out.data.schema,2);assert.equal(Object.keys(out.data.chunksData).length,2);assert.equal(out.data.chunksData['20260918'].trips.length,1);
 assert(seen.includes('https://example.test/trasporti/runtime-data/aut-schedule.index.json'));
 assert(seen.includes('https://example.test/trasporti/runtime-data/aut-schedule-day-20260918.b.json'));
 console.log('RESULT: 5 provider chunked schedule checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
