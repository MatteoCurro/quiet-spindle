const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {parseHTML}=require('linkedom');

const root=path.join(__dirname,'..');
const navSource=fs.readFileSync(path.join(root,'js','app','navigation-state.js'),'utf8');
const panelSource=fs.readFileSync(path.join(root,'js','app','panel-manager.js'),'utf8');

const dom=parseHTML(`<!doctype html><html><body>
<button id="linesBtn" aria-expanded="false"></button>
<button id="nearbyBtn" aria-expanded="false"></button>
<button id="alertsBtn" aria-expanded="false"></button>
<button id="journeyBtn" aria-expanded="false"></button>
<div id="map"></div><div id="driverMapCanvas"></div>
<section id="drawer" hidden>
  <button id="compactBtn"></button>
  <h2 id="drawerTitle" tabindex="-1"></h2>
  <div id="view-lines" class="drawer-view" hidden></div>
  <div id="view-detail" class="drawer-view" hidden></div>
  <div id="view-journey" class="drawer-view" hidden></div>
</section>
</body></html>`);
const document=dom.window.document;
const events=[];
const browserEntries=[{uvTransportPanel:{panel:null,depth:0}}];
let browserIndex=0;
const history={
  get state(){return browserEntries[browserIndex]||null},
  replaceState(next){browserEntries[browserIndex]=next},
  pushState(next){browserEntries.splice(browserIndex+1);browserEntries.push(next);browserIndex=browserEntries.length-1},
  back(){if(browserIndex>0){browserIndex--;sandbox.dispatchEvent(new dom.window.CustomEvent('popstate',{detail:null}));}},
  go(delta){const next=Math.max(0,Math.min(browserEntries.length-1,browserIndex+Number(delta||0)));browserIndex=next;sandbox.dispatchEvent(new dom.window.CustomEvent('popstate',{detail:null}));}
};
const sandbox={
  document,
  history,
  location:{href:'https://example.test/trasporti/'},
  CustomEvent:dom.window.CustomEvent,
  UVTransitI18n:{t:key=>({
    'panel.lines':'Your lines',
    'panel.detail':'Details',
    'panel.journey':'Your journey',
    'panel.navigation':'Navigation',
    'drawer.reduce':'Collapse panel'
  }[key]||key)},
  addEventListener:dom.window.addEventListener.bind(dom.window),
  dispatchEvent(event){
    if(event.type==='popstate'&&!event.state){
      const replacement=new dom.window.Event('popstate');
      Object.defineProperty(replacement,'state',{value:history.state});
      events.push(replacement);return dom.window.dispatchEvent(replacement);
    }
    events.push(event);return dom.window.dispatchEvent(event);
  }
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
const context=vm.createContext(sandbox);
vm.runInContext(navSource,context,{filename:'js/app/navigation-state.js'});
vm.runInContext(panelSource,context,{filename:'js/app/panel-manager.js'});

const P=sandbox.UVTransitPanelManager;
assert(P);

P.open('lines',document.getElementById('linesBtn'),{history:true});
assert.equal(P.current(),'lines');
assert.equal(P.descriptor().presentation,'fullscreen');
assert.equal(document.getElementById('drawer').hidden,false);
assert.equal(document.getElementById('view-lines').hidden,false);
assert.equal(document.getElementById('drawerTitle').textContent,'Your lines');
assert.equal(document.body.dataset.presentation,'fullscreen');
assert(document.body.classList.contains('uv-panel-open'));
assert.equal(document.getElementById('linesBtn').getAttribute('aria-expanded'),'true');
assert.equal(document.getElementById('map').getAttribute('aria-hidden'),'true','fullscreen workspace must hide background map from accessibility tree');
assert(document.getElementById('map').hasAttribute('inert'),'fullscreen workspace must make background map inert');
assert.equal(history.state.uvTransportPanel.panel,'lines');
assert.equal(history.state.uvTransportPanel.depth,1);

P.open('detail',null,{history:true});
assert.equal(P.current(),'detail');
assert.equal(P.descriptor().presentation,'context');
assert.equal(document.getElementById('view-detail').hidden,false);
assert.equal(document.getElementById('drawerTitle').textContent,'Details');
assert(!document.getElementById('map').hasAttribute('inert'),'context card must keep map interactive');

P.open('navigation',null,{history:true});
assert.equal(P.current(),'navigation');
assert.equal(P.descriptor().presentation,'immersive');
assert.equal(document.getElementById('drawer').hidden,true);
assert(document.body.classList.contains('uv-navigation-active'));
assert(!document.body.classList.contains('uv-panel-open'));

P.close({restoreFocus:false,history:false});
assert.equal(P.current(),null);
assert.equal(P.descriptor().presentation,'map');
assert.equal(document.getElementById('drawer').hidden,true);
assert(!document.body.classList.contains('uv-navigation-active'));
assert(!document.getElementById('map').hasAttribute('aria-hidden'),'map must return to accessibility tree after close');
assert.equal(document.body.dataset.panel,'');

assert(events.some(e=>e.type==='uv:panel'&&e.detail.view==='lines'));
assert(events.some(e=>e.type==='uv:panel'&&e.detail.view===null));

process.stdout.write('panel manager: fullscreen, context, immersive and close presentation contracts OK\n');
