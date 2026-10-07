const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../js/provider-actv.js'),'utf8');
let calls=[];
const manifest={schema:1,networks:{aut:{core:{file:'aut-core.abc.json'},shapes:{file:'aut-shapes.def.json'}}}};
const core={schema:1,network:'aut',routes:[],trips:[],stops:[]};
const shapes={schema:1,network:'aut',shapes:{S1:[[45,12],[45.1,12.1]]}};
function response(value){return {ok:true,status:200,json:async()=>value,blob:async()=>Buffer.from('zip')}}
const context={
  window:{},document:{baseURI:'https://unlockvenice.com/trasporti/'},URL,Date,console,
  fetch:async(url,opts)=>{calls.push({url:String(url),opts:opts||{}});if(String(url).includes('manifest.json'))return response(manifest);if(String(url).includes('aut-core.abc.json'))return response(core);if(String(url).includes('aut-shapes.def.json'))return response(shapes);throw Error('unexpected '+url)},
  WebSocket:function(){}
};
context.window=context;
vm.createContext(context);vm.runInContext(source,context);
(async()=>{
  const p=context.UVTransitProvider;
  assert(p,'provider missing');
  const m=await p.loadRuntimeManifest();
  assert.equal(m.schema,1);
  const c=await p.loadRuntimeCore('aut',m);assert.strictEqual(c.data.network,'aut');
  const s=await p.loadRuntimeShapes('aut',m);assert.equal(s.data.shapes.S1.length,2);
  assert(calls[0].url.startsWith('https://unlockvenice.com/trasporti/runtime-data/manifest.json?_=')&&calls[0].opts.cache==='no-cache');
  assert(calls.some(x=>x.url==='https://unlockvenice.com/trasporti/runtime-data/aut-core.abc.json'&&x.opts.cache==='force-cache'));
  assert(calls.some(x=>x.url==='https://unlockvenice.com/trasporti/runtime-data/aut-shapes.def.json'&&x.opts.cache==='force-cache'));
  console.log('RESULT: 6 runtime-index checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
