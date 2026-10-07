const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../js/provider-actv.js'),'utf8');
const manifest={schema:1,networks:{aut:{
 core:{file:'aut-core.json'},shapes:{file:'aut-shapes.json'},schedule:{file:'aut-schedule.json'}
}}};
const schedule={schema:2,network:'aut',days:['20260101','20260102'],chunks:{
 '20260101':{file:'d1.json'},'20260102':{file:'d2.json'}
}};
const payloads={
 'https://example.test/t-sand/runtime-data/manifest.json':manifest,
 'https://example.test/t-sand/runtime-data/aut-core.json':{schema:1,network:'aut',routes:[],trips:[],stops:[]},
 'https://example.test/t-sand/runtime-data/aut-shapes.json':{schema:1,network:'aut',shapes:{S1:[[45,12],[45.01,12]]}},
 'https://example.test/t-sand/runtime-data/aut-schedule.json':schedule,
 'https://example.test/t-sand/runtime-data/d1.json':{schema:2,network:'aut',day:'20260101',trips:[]},
 'https://example.test/t-sand/runtime-data/d2.json':{schema:2,network:'aut',day:'20260102',trips:[]}
};
const seen=[],created=[];
async function fetch(url){
 const clean=String(url).replace(/[?].*$/,'');seen.push(clean);const data=payloads[clean];
 return {ok:!!data,status:data?200:404,json:async()=>data,blob:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(0)};
}
const context={window:null,document:{baseURI:'https://example.test/t-sand/'},URL,Intl,Date,Map,Set,fetch,console,setTimeout,clearTimeout};
context.window=context;
context.UVTransitACTVNormalizer={createMatcher:args=>{created.push(args);return {args}}};
vm.createContext(context);vm.runInContext(src,context);
(async()=>{
 const matcher=await context.UVTransitProvider._test.ensureMatcher('aut');
 assert.equal(created.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(created[0].shapes)),{S1:[[45,12],[45.01,12]]});
 assert(seen.includes('https://example.test/t-sand/runtime-data/aut-shapes.json'));
 assert.equal(matcher.args.network,'aut');
 console.log('RESULT: provider realtime matcher receives runtime shapes.');
})().catch(e=>{console.error(e);process.exit(1)});
