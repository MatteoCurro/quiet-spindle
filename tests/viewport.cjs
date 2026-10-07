/* Controller tests with simulated viewport/DOM; these do not render CSS. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../js/ui/redesign.js','utf8');
let count=0;function check(name,fn){fn();console.log('PASS '+name);count++}
function fixture(){
 const flags=new Set(),styles=new Map(),frames=[],input={tagName:'INPUT',value:'24H',getBoundingClientRect:()=>({top:20,bottom:68})},body={scrollTop:200,getBoundingClientRect:()=>({top:80,bottom:180})},drawer={hidden:false},warning={hidden:true},link={};
 const els={busSearch:input,drawerBody:body,drawer,viewportWarning:warning,openStandalone:link};
 let invalidations=0,parentWrites=0;
 const g={innerWidth:375,innerHeight:667,visualViewport:{height:667,scale:1},self:{},top:{},location:{href:'https://example.test/app/?embed=1'},requestAnimationFrame:fn=>{frames.push(fn);return frames.length},frameElement:{style:{set height(v){parentWrites++}}}};
 const document={activeElement:null,documentElement:{clientHeight:667,style:{setProperty:(k,v)=>styles.set(k,v)}},body:{classList:{toggle:(k,v)=>v?flags.add(k):flags.delete(k)}}};
 const ctx=vm.createContext({g,document,URL,Math,Number,$:id=>els[id],api:{map:{invalidateSize:()=>invalidations++}},resizeRaf:0});
 vm.runInContext(source.slice(source.indexOf('let focusHeight=0;'),source.indexOf('function rect(')),ctx);
 return {g,document,flags,styles,input,body,drawer,warning,link,frames,run:()=>vm.runInContext('syncViewport()',ctx),focus:()=>{document.activeElement=input;vm.runInContext('focusHeight=viewportHeight()',ctx)},flush:()=>{const all=frames.splice(0);all.forEach(fn=>fn())},invalidations:()=>invalidations,parentWrites:()=>parentWrites};
}
check('portrait to keyboard and back retains typed text',()=>{const f=fixture();f.focus();f.g.visualViewport.height=310;f.run();assert(f.flags.has('uv-keyboard-open'));assert.equal(f.styles.get('--uv-app-height'),'310px');assert.equal(f.input.value,'24H');f.g.visualViewport.height=667;f.run();assert(!f.flags.has('uv-keyboard-open'));assert.equal(f.input.value,'24H')});
check('resizes-content keyboard uses pre-focus height',()=>{const f=fixture();f.focus();f.g.innerHeight=300;f.g.visualViewport.height=300;f.run();assert(f.flags.has('uv-keyboard-open'))});
check('short portrait remains valid without a forced minimum',()=>{const f=fixture();f.g.visualViewport.height=170;f.run();assert.equal(f.styles.get('--uv-app-height'),'170px');assert(f.flags.has('uv-short-viewport'))});
check('landscape does not require width below 760',()=>{const f=fixture();f.g.innerWidth=844;f.g.visualViewport.height=390;f.run();assert(f.flags.has('uv-landscape-short'))});
check('no parent iframe mutation',()=>{const f=fixture();f.g.visualViewport.height=300;f.run();assert.equal(f.parentWrites(),0)});
check('normal small iframe is not obscured by warning',()=>{const f=fixture();f.g.visualViewport.height=375;f.run();assert(f.warning.hidden)});
check('unusable iframe exposes standalone link',()=>{const f=fixture();f.g.visualViewport.height=160;f.run();assert(!f.warning.hidden);assert.equal(f.link.href,'https://example.test/app/')});
check('keyboard suppresses iframe warning',()=>{const f=fixture();f.focus();f.g.visualViewport.height=160;f.run();assert(f.warning.hidden)});
check('resize events coalesce into one map invalidation',()=>{const f=fixture();for(let i=0;i<20;i++)f.run();assert.equal(f.frames.length,1);f.flush();assert.equal(f.invalidations(),1);f.run();f.flush();assert.equal(f.invalidations(),2)});
check('focused field restores internal scroll only',()=>{const f=fixture();f.focus();f.run();f.flush();assert.equal(f.body.scrollTop,128);assert.equal(f.document.activeElement,f.input)});
check('closed drawer does not scroll input',()=>{const f=fixture();f.focus();f.drawer.hidden=true;f.run();f.flush();assert.equal(f.body.scrollTop,200)});
check('pinch zoom does not resize application',()=>{const f=fixture();f.run();f.flush();f.g.visualViewport.scale=2;f.g.visualViewport.height=250;f.run();assert.equal(f.styles.get('--uv-app-height'),'667px')});
check('keyboard remains active after blur until viewport recovers',()=>{const f=fixture();f.focus();f.g.innerHeight=310;f.g.visualViewport.height=310;f.run();f.document.activeElement=null;f.run();assert(f.flags.has('uv-keyboard-open'));f.g.innerHeight=667;f.g.visualViewport.height=667;f.run();assert(!f.flags.has('uv-keyboard-open'))});
check('visual viewport offset follows native iOS pan',()=>{const f=fixture();f.g.visualViewport.offsetTop=42;f.run();assert.equal(f.styles.get('--uv-viewport-top'),'42px')});
console.log(`RESULT: ${count} simulated viewport checks passed.`);

