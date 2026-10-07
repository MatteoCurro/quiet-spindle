const fs=require('fs'),vm=require('vm'),assert=require('assert'),{parseHTML}=require('linkedom');
const source=fs.readFileSync(__dirname+'/../js/ui/entity-picker.js','utf8');
const {window}=parseHTML('<!doctype html><html><body><input id="q"><div id="results"></div></body></html>');
const timers=[];
const sandbox={window:null,document:window.document,Math,Error,Promise,console,
 setTimeout:(fn)=>{timers.push(fn);return timers.length},clearTimeout:()=>{}};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/ui/entity-picker.js'});
const P=sandbox.UVTransitEntityPicker;assert(P);

(async()=>{
 let selected=null,queries=[];
 const engine={search:async(q,opts)=>{queries.push(q);opts.onPartial?.([{id:'partial',name:q+' partial',type:'poi',source:'uv-entity'}]);return [{id:q,name:q+' final',type:'poi',source:'uv-entity'}]}};
 const picker=P.create({input:window.document.getElementById('q'),list:window.document.getElementById('results'),engine,minChars:3,debounce:0,meta:r=>'POI',onSelect:r=>selected=r});
 const input=picker.input,list=picker.list;
 input.value='san';input.dispatchEvent(new window.Event('input'));
 timers.splice(0).forEach(fn=>fn());await new Promise(r=>setTimeout(r,0));
 assert.equal(queries.at(-1),'san');
 assert(list.textContent.includes('san final'));
 assert.equal(list.querySelector('button').dataset.searchSource,'uv-entity');
 console.log('PASS progressive query renders final ranked options');

 let keyboardFocused=false;const firstButton=list.querySelector('button');firstButton.focus=()=>{keyboardFocused=true};const down=new window.Event('keydown');Object.defineProperty(down,'key',{value:'ArrowDown'});input.dispatchEvent(down);
 assert.equal(keyboardFocused,true);
 firstButton.click();
 assert.equal(selected.id,'san');assert.equal(input.value,'san final');assert.equal(list.textContent,'');
 console.log('PASS keyboard and click selection share one contract');

 input.value='sa';input.dispatchEvent(new window.Event('input'));
 assert.equal(list.textContent,'');
 console.log('PASS minChars clears stale suggestions');

 picker.destroy();
 console.log('RESULT: shared EntityPicker contracts passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
