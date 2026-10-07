const fs=require('fs'),vm=require('vm'),assert=require('assert'),{parseHTML}=require('linkedom');
const source=fs.readFileSync(__dirname+'/../js/ui/line-picker.js','utf8');
const {window}=parseHTML('<!doctype html><html><body><input id="search"><section id="selected" hidden><span id="count"></span><div id="chips"></div></section><div id="notice"></div><div id="list"></div><p id="none" hidden>No rows</p></body></html>');
const listeners={};
const shared={
 suggestionButton:(text,fn)=>{const b=window.document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);return b}
};
const sandbox={window:null,globalThis:null,document:window.document,CSS:{escape:v=>String(v).replace(/"/g,'\\\"')},UVTransitEntityPicker:shared,
 addEventListener:(name,fn)=>{(listeners[name]||(listeners[name]=[])).push(fn)},
 removeEventListener:()=>{}};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/ui/line-picker.js'});
const selected=new Set(['2','4L']);
const toggles=[];
const picker=sandbox.UVTransitLinePicker.create({
 search:'#search',list:'#list',selectedWrap:'#selected',selectedHost:'#chips',selectedCount:'#count',noResults:'#none',notice:'#notice',
 items:['2','4L','7'].map(id=>({id,label:'Linea '+id})),
 isSelected:id=>selected.has(id),
 onToggle:async(id,wanted)=>{toggles.push([id,wanted]);wanted?selected.add(id):selected.delete(id);return true},
 label:item=>item.label,
 selectedSummary:n=>n+' selected',
 removeLabel:item=>'Remove '+item.label,
 color:id=>id==='2'?'#111111':'#222222'
});
assert.equal(window.document.querySelectorAll('[data-line-picker-selected]').length,2);
assert.equal(window.document.getElementById('selected').hidden,false);
assert.equal(window.document.getElementById('count').textContent,'2 selected');
console.log('PASS selected routes stay pinned in removable chips');

(async()=>{
 const chip=window.document.querySelector('[data-line-picker-selected="2"]');assert(chip);chip.click();await new Promise(resolve=>setTimeout(resolve,0));
 assert(!selected.has('2'));assert.equal(window.document.querySelector('[data-line-picker-checkbox="2"]').checked,false);
 assert.equal(window.document.querySelectorAll('[data-line-picker-selected]').length,1);
 assert.deepEqual(toggles[0],['2',false]);
 console.log('PASS selected route is deselected in one tap without finding its row');

 const search=window.document.getElementById('search');search.value='7';search.dispatchEvent(new window.Event('input'));
 assert.equal(window.document.querySelector('[data-line-picker-row="7"]').style.display,'flex');
 assert.equal(window.document.querySelector('[data-line-picker-row="4L"]').style.display,'none');
 assert.equal(window.document.getElementById('none').hidden,true);
 search.value='zzz';search.dispatchEvent(new window.Event('input'));assert.equal(window.document.getElementById('none').hidden,false);
 console.log('PASS line search filters rows while selected chips remain independent');

 selected.add('7');picker.sync();
 assert(window.document.querySelector('[data-line-picker-selected="7"]'));
 assert.equal(window.document.querySelector('[data-line-picker-checkbox="7"]').checked,true);
 console.log('PASS external selection changes resync both chips and rows');
 console.log('RESULT: shared LinePicker contracts passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
