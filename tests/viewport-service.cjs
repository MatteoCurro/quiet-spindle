const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../js/app/viewport-service.js','utf8');

let count=0;function check(name,fn){fn();console.log('PASS '+name);count++}
function fixture(){
 const flags=new Set(),styles=new Map(),frames=[],events=[];
 const input={tagName:'INPUT',id:'busSearch',value:'24H',getBoundingClientRect:()=>({top:20,bottom:68})};
 const body={scrollTop:200,getBoundingClientRect:()=>({top:80,bottom:180})};
 const drawer={hidden:false},warning={hidden:true},link={};
 const els={busSearch:input,drawerBody:body,drawer,viewportWarning:warning,openStandalone:link,map:{}};
 let invalidations=0,parentWrites=0;
 const listeners=new Map();
 const visualListeners=new Map();
 const add=(store,type,fn)=>{if(!store.has(type))store.set(type,[]);store.get(type).push(fn)};
 const g={
  innerWidth:375,innerHeight:667,
  visualViewport:{height:667,scale:1,offsetTop:0,addEventListener:(t,fn)=>add(visualListeners,t,fn)},
  self:{},top:{},location:{href:'https://example.test/app/?embed=1'},
  requestAnimationFrame:fn=>{frames.push(fn);return frames.length},
  setTimeout:fn=>{fn();return 1},
  addEventListener:(t,fn)=>add(listeners,t,fn),
  dispatchEvent:e=>{events.push(e);return true},
  frameElement:{style:{set height(v){parentWrites++}}}
 };
 const documentListeners=new Map();
 const document={
  activeElement:null,hidden:false,
  documentElement:{clientHeight:667,clientWidth:375,style:{setProperty:(k,v)=>styles.set(k,v)}},
  body:{classList:{toggle:(k,v)=>v?flags.add(k):flags.delete(k),contains:k=>flags.has(k)}},
  getElementById:id=>els[id]||null,
  addEventListener:(t,fn)=>add(documentListeners,t,fn)
 };
 const context=vm.createContext({
  window:g,document,URL,Math,Number,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail}},
  ResizeObserver:class{constructor(fn){this.fn=fn}observe(){}},console
 });
 vm.runInContext(source,context,{filename:'js/app/viewport-service.js'});
 const V=g.UVTransitViewport;
 V.init({map:{invalidateSize:()=>invalidations++}});
 return {
  g,document,flags,styles,input,body,drawer,warning,link,frames,events,V,
  focus:()=>{document.activeElement=input;},
  flush:()=>{const all=frames.splice(0);all.forEach(fn=>fn())},
  invalidations:()=>invalidations,parentWrites:()=>parentWrites
 };
}
check('portrait to keyboard and back retains typed text',()=>{const f=fixture();f.focus();f.g.visualViewport.height=310;f.V.sync();assert(f.flags.has('uv-keyboard-open'));assert.equal(f.styles.get('--uv-app-height'),'310px');assert.equal(f.input.value,'24H');f.g.visualViewport.height=667;f.g.innerHeight=667;f.document.activeElement=null;f.V.sync();assert(!f.flags.has('uv-keyboard-open'));assert.equal(f.input.value,'24H')});
check('short portrait has no forced minimum',()=>{const f=fixture();f.g.visualViewport.height=170;f.V.sync();assert.equal(f.styles.get('--uv-app-height'),'170px');assert(f.flags.has('uv-short-viewport'))});
check('landscape short is detected',()=>{const f=fixture();f.g.innerWidth=844;f.g.visualViewport.height=390;f.V.sync();assert(f.flags.has('uv-landscape-short'))});
check('no parent iframe mutation',()=>{const f=fixture();f.g.visualViewport.height=300;f.V.sync();assert.equal(f.parentWrites(),0)});
check('unusable iframe exposes standalone link',()=>{const f=fixture();f.g.visualViewport.height=160;f.V.sync();assert(!f.warning.hidden);assert.equal(f.link.href,'https://example.test/app/')});
check('keyboard suppresses iframe warning',()=>{const f=fixture();f.focus();f.g.visualViewport.height=160;f.V.sync();assert(f.warning.hidden)});
check('resize events coalesce',()=>{const f=fixture();f.flush();const before=f.invalidations();for(let i=0;i<20;i++)f.V.sync();assert.equal(f.frames.length,1);f.flush();assert.equal(f.invalidations(),before+1)});
check('focused field scrolls only inside drawer',()=>{const f=fixture();f.flush();f.focus();f.V.sync();f.flush();assert.equal(f.body.scrollTop,128);assert.equal(f.document.activeElement,f.input)});
check('closed drawer does not move internal scroll',()=>{const f=fixture();f.flush();f.focus();f.drawer.hidden=true;f.V.sync();f.flush();assert.equal(f.body.scrollTop,200)});
check('pinch zoom keeps application height',()=>{const f=fixture();f.flush();const before=f.styles.get('--uv-app-height');f.g.visualViewport.scale=2;f.g.visualViewport.height=250;f.V.sync();assert.equal(f.styles.get('--uv-app-height'),before)});
check('visual viewport offset follows native pan',()=>{const f=fixture();f.g.visualViewport.offsetTop=42;f.V.sync();assert.equal(f.styles.get('--uv-viewport-top'),'42px')});
console.log(`RESULT: ${count} viewport service checks passed.`);
