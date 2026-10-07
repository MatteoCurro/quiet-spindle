const fs=require('fs'),path=require('path'),assert=require('assert'),{chromium}=require('playwright-core');

const BASE=process.env.UV_STAGING_URL||'https://unlockvenice.com/t-sand/';
const CHROME=process.env.CHROME_PATH||'/usr/bin/google-chrome';
const OUT=path.resolve(process.env.UV_MOBILE_ARTIFACTS||'mobile-artifacts');
const TARGET_SHA=(process.env.GITHUB_SHA||'').slice(0,8);
fs.mkdirSync(OUT,{recursive:true});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function log(event,data={}){console.log(JSON.stringify({event,...data}))}
async function waitForButtons(page,selector,needle,timeout=15000){
 await page.waitForFunction(({selector,needle})=>[...document.querySelectorAll(selector)].some(b=>b.innerText.toLowerCase().includes(needle.toLowerCase())),{selector,needle},{timeout});
 const rows=page.locator(selector);for(let i=0;i<await rows.count();i++){const b=rows.nth(i),text=(await b.innerText()).trim();if(text.toLowerCase().includes(needle.toLowerCase()))return b}
 throw Error('Suggestion not found: '+needle);
}
async function layoutSnapshot(page,name){
 const data=await page.evaluate(()=>{const r=id=>{const e=document.querySelector(id);if(!e)return null;const b=e.getBoundingClientRect(),cs=getComputedStyle(e);return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),display:cs.display,visibility:cs.visibility,hidden:e.hidden||false}};
  return {vw:innerWidth,vh:innerHeight,docW:document.documentElement.scrollWidth,bodyW:document.body.scrollWidth,map:r('#map'),drawer:r('#drawer'),journey:r('#view-journey'),origin:r('#journeyOrigin'),destination:r('#journeyDestination'),find:r('#journeyFind'),gps:r('#journeyGPS')};
 });
 log('layout',{name,...data});
 assert(data.docW<=data.vw+2&&data.bodyW<=data.vw+2,name+' has horizontal overflow');
 if(data.map)assert(data.map.w>=Math.min(300,data.vw-20)&&data.map.h>=180,name+' map collapsed');
 return data;
}
async function openJourney(page,expectOriginFirst=false){
 const shortcut=page.locator('#searchDestination');
 if(await shortcut.isVisible())await shortcut.click();
 else await page.evaluate(()=>window.UVTransitJourney?.openSearch?.());
 await page.waitForFunction(()=>{const e=document.querySelector('#view-journey');return e&&!e.hidden&&getComputedStyle(e).display!=='none'},{},{timeout:10000});
 await page.waitForSelector('#journeyOrigin',{state:'visible'});
 if(expectOriginFirst){
  await page.waitForTimeout(120);
  const state=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r&&{top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height)}},bodyEl=document.querySelector('#drawer .drawer-body'),body=bodyEl?.getBoundingClientRect(),drawer=document.querySelector('#drawer'),drawerRect=drawer?.getBoundingClientRect(),drawerStyle=drawer&&getComputedStyle(drawer),intro=document.querySelector('#view-journey .journey-intro'),mapWrap=document.querySelector('.map-wrap')?.getBoundingClientRect(),dock=document.querySelector('.app-dock')?.getBoundingClientRect(),heading=document.querySelector('.app-heading'),headingStyle=heading&&getComputedStyle(heading),siteHeader=document.querySelector('.site-header'),siteHeaderStyle=siteHeader&&getComputedStyle(siteHeader),compact=document.querySelector('#compactBtn');return {vw:innerWidth,vh:innerHeight,active:document.activeElement?.id,scrollTop:bodyEl?.scrollTop||0,introDisplay:intro&&getComputedStyle(intro).display,presentation:document.body.dataset.presentation,headingVisible:heading?headingStyle.display!=='none'&&headingStyle.visibility!=='hidden'&&heading.getBoundingClientRect().height>0:false,siteHeaderVisible:siteHeader?siteHeaderStyle.display!=='none'&&siteHeaderStyle.visibility!=='hidden'&&siteHeader.getBoundingClientRect().height>0:false,compactVisible:compact?getComputedStyle(compact).display!=='none':false,drawer:drawerRect&&{top:Math.round(drawerRect.top),bottom:Math.round(drawerRect.bottom),height:Math.round(drawerRect.height),position:drawerStyle.position,cssHeight:drawerStyle.height,topCss:drawerStyle.top,bottomCss:drawerStyle.bottom,maxHeight:drawerStyle.maxHeight},mapWrap:mapWrap&&{top:Math.round(mapWrap.top),bottom:Math.round(mapWrap.bottom),height:Math.round(mapWrap.height)},dock:dock&&{top:Math.round(dock.top),bottom:Math.round(dock.bottom),height:Math.round(dock.height)},journey:rect('#view-journey'),origin:rect('#journeyOrigin'),destination:rect('#journeyDestination'),find:rect('#journeyFind'),body:body&&{top:Math.round(body.top),bottom:Math.round(body.bottom),height:Math.round(body.height)}}});
  log('journey-entry',{state});assert(state.body&&state.origin&&state.origin.top>=state.body.top-2&&state.origin.bottom<=state.body.bottom+2,'origin is hidden behind/outside drawer viewport: '+JSON.stringify(state));assert(state.scrollTop<20,'empty journey must open at the top of the workspace');if(state.vw<=760){assert.equal(state.presentation,'fullscreen','journey must use the 9.0 fullscreen presentation: '+JSON.stringify(state));const shortLandscape=state.vw>state.vh&&state.vh<=520;if(!shortLandscape)assert.equal(state.headingVisible,true,'mobile Journey must keep the app heading visible when the base layout shows it: '+JSON.stringify(state));assert.equal(state.siteHeaderVisible,true,'mobile Journey must keep the Unlock Venice header visible: '+JSON.stringify(state));assert.equal(state.drawer?.position,'absolute','mobile journey workspace must be owned by the app/map workspace: '+JSON.stringify(state));assert(state.mapWrap&&Math.abs(state.drawer.top-state.mapWrap.top)<=2&&Math.abs(state.drawer.bottom-state.mapWrap.bottom)<=2,'mobile journey must fill the map workspace while reserving the persistent dock: '+JSON.stringify(state));assert(state.dock&&state.drawer.bottom<=state.dock.top,'fullscreen workspace overlaps the dock: '+JSON.stringify(state));assert.equal(state.compactVisible,false,'fullscreen workspace must not expose the legacy collapse control');}
 }
}
async function selectHub(page,kind,q,needle){
 const input=page.locator(kind==='origin'?'#journeyOrigin':'#journeyDestination'),list=kind==='origin'?'#originSuggestions':'#destinationSuggestions';
 await input.fill(q);await input.dispatchEvent('input');
 await page.waitForFunction(({list,needle})=>[...document.querySelectorAll(list+' button')].some(b=>{const t=b.innerText.toLowerCase();return t.includes(needle.toLowerCase())&&t.includes('più piattaforme')}),{list,needle},{timeout:20000});
 const buttons=page.locator(list+' button'),texts=await buttons.allInnerTexts(),competing=texts.filter(t=>t.toLowerCase().includes(needle.toLowerCase())&&!t.toLowerCase().includes('più piattaforme')&&/fermata dei mezzi/i.test(t));
 assert.equal(competing.length,0,kind+' still exposes an external single-stop competitor: '+competing.join(' | '));
 let b=null;for(let i=0;i<await buttons.count();i++){const row=buttons.nth(i),text=(await row.innerText()).replace(/\s+/g,' ').trim();if(text.toLowerCase().includes(needle.toLowerCase())&&text.toLowerCase().includes('più piattaforme')){b=row;break}}
 assert(b,kind+' hub suggestion not found: '+needle);const text=(await b.innerText()).replace(/\s+/g,' ').trim();await b.click();log('selected',{kind,text});
}
async function linePickerSmoke(page,label){
 await page.locator('#linesBtn').click();
 await page.waitForFunction(()=>{const e=document.querySelector('#view-lines');return e&&!e.hidden&&getComputedStyle(e).display!=='none'},{},{timeout:10000});
 await page.waitForSelector('#busList input[type="checkbox"]',{state:'visible',timeout:15000});
 const target=page.locator('#busList input[type="checkbox"]:not(:checked)').first();
 assert(await target.count(),label+' has no unselected bus line available for LinePicker test');
 const line=await target.getAttribute('value');
 await target.click();
 await page.waitForSelector('[data-line-picker-selected="'+line+'"]',{state:'visible',timeout:10000});
 const chip=page.locator('[data-line-picker-selected="'+line+'"]');
 const chipBox=await chip.boundingBox();assert(chipBox&&chipBox.height>=36,label+' selected-line chip is too small for touch');
 await chip.click();
 await page.waitForFunction(line=>{const cb=document.querySelector('[data-line-picker-checkbox="'+CSS.escape(line)+'"]');return cb&&!cb.checked&&!document.querySelector('[data-line-picker-selected="'+CSS.escape(line)+'"]')},line,{timeout:10000});
 log('line-picker',{label,line,deselectedFromChip:true});
 const tram=page.locator('[data-line-picker-checkbox="T2"]');assert(await tram.count(),label+' unified picker is missing T2');assert(await tram.isChecked(),label+' T2 should be selected by the default ALL compatibility state');
 const tramChip=page.locator('#busSelectedChips [data-line-picker-selected="T2"]');assert(await tramChip.isVisible(),label+' selected T2 chip is missing');await tramChip.click();await page.waitForFunction(()=>{const cb=document.querySelector('[data-line-picker-checkbox="T2"]');return cb&&!cb.checked&&!document.querySelector('#busSelectedChips [data-line-picker-selected="T2"]')},{},{timeout:10000});
 await tram.click();await page.waitForFunction(()=>{const cb=document.querySelector('[data-line-picker-checkbox="T2"]');return cb&&cb.checked&&!!document.querySelector('#busSelectedChips [data-line-picker-selected="T2"]')},{},{timeout:10000});log('line-picker-tram',{label,line:'T2',deselectedFromChip:true,restoredFromRow:true});
 const lineLayout=await page.evaluate(()=>{const drawer=document.querySelector('#drawer')?.getBoundingClientRect(),body=document.querySelector('#drawerBody')?.getBoundingClientRect(),list=document.querySelector('#busPopover')?.getBoundingClientRect(),dock=document.querySelector('.app-dock')?.getBoundingClientRect(),host=document.querySelector('#busPopover'),style=host&&getComputedStyle(host);return drawer&&body&&list&&dock&&host&&style?{drawer:{top:drawer.top,bottom:drawer.bottom},body:{top:body.top,bottom:body.bottom},list:{top:list.top,bottom:list.bottom,height:list.height,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,overflowY:style.overflowY},dock:{top:dock.top,bottom:dock.bottom}}:null});
 assert(lineLayout&&lineLayout.list.height>60,label+' Lines list has no usable scroll region: '+JSON.stringify(lineLayout));assert(['auto','scroll'].includes(lineLayout.list.overflowY),label+' Lines list is not the dedicated scroller: '+JSON.stringify(lineLayout));assert(lineLayout.list.bottom<=lineLayout.body.bottom+1,label+' Lines list escapes drawer body: '+JSON.stringify(lineLayout));assert(lineLayout.drawer.bottom<=lineLayout.dock.top+1,label+' Lines drawer overlaps bottom dock: '+JSON.stringify(lineLayout));log('line-picker-layout',{label,...lineLayout});
 if(label==='iphone8-portrait'){
  const search=page.locator('#busSearch');await search.focus();
  await page.evaluate(()=>{
   window.__uvLineVvHeight=Object.getOwnPropertyDescriptor(window.visualViewport,'height');
   window.__uvLineVvTop=Object.getOwnPropertyDescriptor(window.visualViewport,'offsetTop');
   Object.defineProperty(window.visualViewport,'height',{configurable:true,value:Math.max(260,innerHeight-260)});
   Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,value:18});
   window.UVTransitRedesign.syncViewport();
  });
  const keyboard=await page.evaluate(()=>{const rect=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect(),cs=e&&getComputedStyle(e);return r&&{top:r.top,bottom:r.bottom,height:r.height,display:cs.display,visibility:cs.visibility,paddingBottom:cs.paddingBottom}},drawer=rect('#drawer'),dock=rect('.app-dock'),search=rect('#busSearch'),list=rect('#busPopover'),body=rect('#drawerBody');return {drawer,dock,search,list,body,visualHeight:visualViewport.height,offsetTop:visualViewport.offsetTop,keyboardOpen:document.body.classList.contains('uv-keyboard-open')}});
  assert(keyboard.keyboardOpen,label+' Lines keyboard state was not detected: '+JSON.stringify(keyboard));
  assert(keyboard.drawer&&keyboard.dock&&keyboard.search&&keyboard.list,label+' Lines keyboard layout is incomplete: '+JSON.stringify(keyboard));
  assert.equal(keyboard.dock.display,'none',label+' persistent dock must hide while keyboard is open: '+JSON.stringify(keyboard));
  assert(keyboard.drawer.top>=keyboard.offsetTop-1,label+' Lines drawer starts above the visual viewport: '+JSON.stringify(keyboard));
  assert(Math.abs(keyboard.drawer.bottom-(keyboard.visualHeight+keyboard.offsetTop))<=2,label+' Lines drawer must consume the full visual viewport: '+JSON.stringify(keyboard));
  assert(keyboard.search.top>=keyboard.drawer.top-1&&keyboard.search.bottom<=keyboard.drawer.bottom+1,label+' Lines search escapes visible keyboard workspace: '+JSON.stringify(keyboard));
  assert.equal(keyboard.body.paddingBottom,'0px',label+' drawer keeps useless bottom padding with keyboard open: '+JSON.stringify(keyboard));
  assert.equal(keyboard.list.paddingBottom,'0px',label+' Lines list keeps useless bottom padding with keyboard open: '+JSON.stringify(keyboard));
  assert(keyboard.list.height>100&&keyboard.list.bottom<=keyboard.drawer.bottom+1,label+' Lines list has insufficient keyboard workspace: '+JSON.stringify(keyboard));
  log('line-picker-keyboard',{label,...keyboard});
  await page.evaluate(()=>{
   document.activeElement?.blur?.();
   for(const [key,saved] of [['height',window.__uvLineVvHeight],['offsetTop',window.__uvLineVvTop]]){if(saved)Object.defineProperty(visualViewport,key,saved);else delete visualViewport[key]}
   window.UVTransitRedesign.syncViewport();
  });
 }
 await page.locator('#closeDrawer').click();
 await page.waitForFunction(()=>document.querySelector('#drawer')?.hidden===true,{},{timeout:10000});
}
async function deepLinkSmoke(page,label){
 const gateway=new URL('go/p/uv_venice_san_marco?ref=mobile_acceptance',BASE).href;
 await page.goto(gateway,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.UVTransitDeepLinks?.last?.()?.state==='needs-input',{},{timeout:15000});
 const state=await page.evaluate(()=>({href:location.href,destination:document.querySelector('#journeyDestination')?.value||'',journey:!!document.querySelector('#view-journey')&&!document.querySelector('#view-journey').hidden,robots:document.querySelector('meta[name="robots"][data-uv-deep-link]')?.content||'',canonical:document.querySelector('link[rel="canonical"][data-uv-deep-link]')?.href||'',deep:window.UVTransitDeepLinks?.last?.()?.state||null}));
 log('deep-link-live',{label,...state});assert(/to=poi%3Auv_venice_san_marco/i.test(state.href)||/to=poi:uv_venice_san_marco/i.test(state.href),label+' gateway did not preserve stable POI token: '+state.href);assert(/piazza san marco/i.test(state.destination),label+' stable POI did not hydrate Journey destination: '+JSON.stringify(state));assert(state.journey,label+' deep link did not open Journey');assert.equal(state.robots,'noindex,follow',label+' operational deep link missing noindex');assert(/\/t-sand\/$/.test(state.canonical),label+' deep-link canonical must point to app shell: '+state.canonical);

 const routeGateway=new URL('go/r/uv_mestre_station_san_marco?lang=en&ref=mobile_acceptance',BASE).href;
 await page.goto(routeGateway,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.UVTransitDeepLinks?.last?.()?.state==='ready',{},{timeout:30000});
 const routeState=await page.evaluate(()=>({href:location.href,origin:document.querySelector('#journeyOrigin')?.value||'',destination:document.querySelector('#journeyDestination')?.value||'',routeId:window.UVTransitDeepLinks?.last?.()?.parsed?.routeId||'',deep:window.UVTransitDeepLinks?.last?.()?.state||null,journey:!!document.querySelector('#view-journey')&&!document.querySelector('#view-journey').hidden,lang:document.documentElement.lang||''}));
 log('deep-link-route-live',{label,...routeState});
 assert(/route=uv_mestre_station_san_marco/i.test(routeState.href),label+' stable route gateway did not preserve route ID: '+routeState.href);
 assert.equal(routeState.routeId,'uv_mestre_station_san_marco',label+' stable route ID was not resolved');
 assert(/mestre/i.test(routeState.origin),label+' stable route did not hydrate origin: '+JSON.stringify(routeState));
 assert(/st mark|san marco/i.test(routeState.destination),label+' stable route did not hydrate destination: '+JSON.stringify(routeState));
 assert.equal(routeState.deep,'ready',label+' stable route did not reach ready state');
 assert(routeState.journey,label+' stable route did not open Journey');
}
async function addressSmoke(page,label){
 const data=await page.evaluate(async()=>{
  const rows=await window.UVTransitPlaces.search('Via Torino 155');
  const exact=rows.find(r=>r.source==='comune-venezia'&&r.kind==='address'&&r.exactHouse&&String(r.house)==='155'&&/via torino/i.test(r.street||r.name||''))||null;
  if(!exact)return {exact:null,rows:rows.slice(0,5).map(r=>({name:r.name,source:r.source,kind:r.kind,house:r.house,exactHouse:r.exactHouse}))};
  const civics=await window.UVTransitPlaces.civics(exact.street,'');
  const second=civics.find(r=>r.source==='comune-venezia'&&r.kind==='address'&&String(r.house)!=='155')||null;
  let walk=null;if(second){const t=performance.now();try{const w=await window.UVTransitPlaces.walk(exact,second);walk={ms:Math.round(performance.now()-t),seconds:w.seconds,distance:w.distance,source:w.source,exact:w.exact}}catch(e){walk={error:e.message}}}
  return {exact:{name:exact.name,street:exact.street,house:exact.house,lat:exact.lat,lon:exact.lon,source:exact.source,provider:exact.provider,exactHouse:exact.exactHouse},second:second&&{name:second.name,street:second.street,house:second.house,lat:second.lat,lon:second.lon,source:second.source},walk};
 });
 log('address-live',{label,...data});
 assert(data.exact,label+' live TopoCivici did not resolve Via Torino 155 exactly');
 assert.equal(data.exact.source,'comune-venezia',label+' exact address did not come from Comune di Venezia');
 assert(Number.isFinite(data.exact.lat)&&Number.isFinite(data.exact.lon),label+' exact address has invalid coordinates');
 assert(data.second,label+' live TopoCivici did not expose a second civic on Via Torino');
 assert(data.walk&&!data.walk.error,label+' live address-to-address walk failed: '+JSON.stringify(data.walk));
 assert.equal(data.walk.source,'local-osm',label+' address-to-address walk did not use local OSM');
 assert(data.walk.exact,label+' address-to-address walk was not exact');

 const input=page.locator('#journeyOrigin'),list='#originSuggestions';
 await input.fill('Via Torino 155');await input.dispatchEvent('input');
 await page.waitForFunction(({list})=>[...document.querySelectorAll(list+' button')].some(b=>/via torino\s+155/i.test(b.innerText)&&/indirizzo/i.test(b.innerText)),{list},{timeout:15000});
 const uiRows=await page.locator(list+' button').allInnerTexts();const exactUi=uiRows.find(t=>/via torino\s+155/i.test(t)&&/indirizzo/i.test(t));
 log('address-ui',{label,text:String(exactUi||'').replace(/\s+/g,' ').trim()});
 assert(exactUi,label+' exact civic is not exposed in the unified planner input');
 const exactButton=page.locator(list+' button').filter({hasText:/Via Torino\s+155/i}).first();await exactButton.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:100});await exactButton.dispatchEvent('pointermove',{pointerType:'touch',clientX:50,clientY:140});await exactButton.dispatchEvent('pointercancel',{pointerType:'touch'});assert(await exactButton.isVisible(),label+' scrolling selected a suggestion');await exactButton.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:100});await exactButton.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,button:0,clientX:50,clientY:100});await exactButton.dispatchEvent('click');await page.waitForTimeout(90);const touchValue=await input.inputValue();assert(/via torino\s+155/i.test(touchValue),label+' touch suggestion did not commit on the first tap');assert.equal(await page.locator(list+' button').count(),0,label+' suggestion list remained open after one-touch selection');const touchState=await page.evaluate(()=>({journey:!document.querySelector('#view-journey')?.hidden,favorites:!document.querySelector('#view-favorites')?.hidden,active:document.activeElement?.id||''}));assert(touchState.journey&&!touchState.favorites,label+' touch suggestion navigated away from journey: '+JSON.stringify(touchState));assert(!['journeyOrigin','journeyDestination'].includes(touchState.active),label+' touch suggestion left keyboard focus on a journey input');log('suggestion-touch',{label,value:touchValue,touchState});
 await input.fill('');await input.dispatchEvent('input');
}
async function plannerFlow(page,label){
 await openJourney(page);await layoutSnapshot(page,label+'-journey');
 assert(await page.locator('#journeyGPS').isVisible(),label+' GPS shortcut hidden');
 assert(await page.locator('#originMap').isVisible()&&await page.locator('#destinationMap').isVisible(),label+' map buttons hidden');
 const leaked=await page.locator('body').innerText();assert(!leaked.includes('svgSulla mappa'),label+' leaks obsolete svgSulla mappa text');
 await page.evaluate(()=>{for(const id of ['layerRoutes','layerStops']){const el=document.getElementById(id);if(el&&!el.checked){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}}});await page.waitForTimeout(250);

 await selectHub(page,'origin','Mestre FS','Stazione MESTRE FS');
 await selectHub(page,'destination','Piazzale Roma','Piazzale Roma');
 await page.evaluate(()=>window.UVTransitAlerts.accept({schemaVersion:1,generatedAt:new Date().toISOString(),revision:'journey-alert-test',sourceHealth:{telegram:{status:'ok'}},alerts:[{id:'journey-line2',version:'1',provider:'AVM/Actv',category:'service_restriction',effects:['service_restriction'],cause:'operational',lifecycle:'active',severity:'major',planned:false,impact:'partial',title:'Servizio limitato · 2',body:'Servizio limitato sulla linea 2.',source:{channel:'telegram',publishedAt:new Date().toISOString(),url:'https://t.me/muoversivenezia/2'},scope:{networks:['water'],lines:['2'],stops:[],areas:[],directions:[],segments:[]},validity:{startsAt:new Date().toISOString(),endsAt:null,label:null},tags:['service_restriction'],audience:{topics:['line:2'],pushEligible:true}}]}));
 const start=Date.now();await page.locator('#journeyFind').click();assert(await page.locator('#journeyLoading').isVisible(),label+' themed journey loader did not appear');
 await page.waitForSelector('#journeyResults .journey-card',{state:'visible',timeout:20000});assert(!(await page.locator('#journeyLoading').isVisible()),label+' journey loader stayed visible after the first result');
 const firstMs=Date.now()-start,first=page.locator('#journeyResults .journey-card').first(),text=(await first.innerText()).replace(/\s+/g,' ').trim();
 const badges=await first.locator('.journey-badge').allInnerTexts();
 log('first-route',{label,firstMs,badges,text:text.slice(0,500)});
 assert(badges.some(x=>x.trim()==='2'),label+' first Mestre FS → Piazzale Roma route is not line 2');
 assert(/Diretto/i.test(text),label+' first route is not direct');
 assert(!/Marghera/i.test(text),label+' first route detours through Marghera');
 assert(await first.locator('.journey-alert').isVisible(),label+' active line incident missing from journey result');
 assert((await first.locator('.journey-alert').innerText()).includes('Linea 2'),label+' journey warning does not identify line 2');
 const metrics=await page.evaluate(()=>window.UVTransitJourneyMetrics?.last||null);log('journey-metrics',{label,metrics});
 assert(metrics?.marks?.firstResult!==undefined,label+' did not expose time-to-first-result');
 assert(metrics.marks.firstResult<10000,label+' first verified route exceeded 10 s');

 await first.getByRole('button',{name:/Dettagli del viaggio/}).click();
 await page.waitForFunction(()=>{const e=document.querySelector('#view-itinerary');return e&&!e.hidden},{},{timeout:10000});
 const itineraryAlert=page.locator('#itineraryContent .journey-alert');assert(await itineraryAlert.isVisible(),label+' active line incident missing from itinerary detail');
 assert((await itineraryAlert.innerText()).includes('Linea 2'),label+' itinerary warning does not identify line 2');
 const mapBtn=page.locator('#view-itinerary').getByRole('button',{name:'Sulla mappa'});
 assert(await mapBtn.isVisible(),label+' itinerary map action missing');
 await mapBtn.click();
 await page.waitForFunction(()=>document.body.classList.contains('uv-itinerary'),{},{timeout:12000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const mapState=await page.evaluate(()=>{const map=window.UVTransitMap?.get?.(),layers=map?Object.values(map._layers||{}):[],lines=layers.filter(l=>window.L&&l instanceof L.Polyline&&Array.isArray(l._latlngs)&&l._latlngs.length>1&&[3,5,7,10].includes(Number(l.options?.weight))),points=lines.reduce((n,l)=>n+l._latlngs.length,0),lineBounds=lines.map((l,i)=>{const flat=l._latlngs.flat(Infinity).filter(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng));return {i,weight:l.options?.weight,count:flat.length,minLat:Math.min(...flat.map(p=>p.lat)),maxLat:Math.max(...flat.map(p=>p.lat)),minLon:Math.min(...flat.map(p=>p.lng)),maxLon:Math.max(...flat.map(p=>p.lng))}}),markers=layers.filter(l=>window.L&&l instanceof L.Marker&&l.getElement?.()?.querySelector?.('.journey-map-point')),size=map?.getSize?.(),markerPixels=map&&size?markers.map(l=>{const ll=l.getLatLng(),p=map.latLngToContainerPoint(ll);return {lat:ll.lat,lon:ll.lng,x:Math.round(p.x),y:Math.round(p.y),inView:p.x>=0&&p.x<=size.x&&p.y>=0&&p.y<=size.y}}):[],center=map?.getCenter?.(),bounds=map?.getBounds?.(),baseEls=[...document.querySelectorAll('#map .smooth-vehicle,#map .smooth-water-vehicle,#map .raw-fix,#map .uv-network-route,#map .uv-water-route,#map .stop-hit,#map .user-person-marker')],baseVisible=baseEls.filter(el=>{const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)!==0});return {baseOverlayTotal:baseEls.length,baseOverlayVisible:baseVisible.length,intermediateStops:document.querySelectorAll('#map .journey-map-stop').length,svgPaths:document.querySelectorAll('#map .leaflet-overlay-pane path').length,canvas:document.querySelectorAll('#map canvas').length,itineraryLines:lines.length,itineraryPoints:points,lineBounds,journeyMarkers:markers.length,journeyMarkersInView:markerPixels.filter(p=>p.inView).length,markerPixels,zoom:map?.getZoom?.(),center:center&&{lat:center.lat,lon:center.lng},bounds:bounds&&{south:bounds.getSouth(),north:bounds.getNorth(),west:bounds.getWest(),east:bounds.getEast()},reopen:!document.querySelector('#reopenJourney')?.hidden,map:{w:document.querySelector('#map')?.getBoundingClientRect().width,h:document.querySelector('#map')?.getBoundingClientRect().height}}});
 log('itinerary-map',{label,...mapState});assert(mapState.itineraryLines>=2&&mapState.itineraryPoints>=4,label+' itinerary has no Leaflet polyline geometry');assert(mapState.baseOverlayTotal>0,label+' acceptance did not create normal map overlays before itinerary');assert.equal(mapState.baseOverlayVisible,0,label+' normal map overlays remain visible during itinerary: '+JSON.stringify(mapState));assert(mapState.intermediateStops>0,label+' itinerary does not show intermediate stops');assert(mapState.journeyMarkers>=2,label+' itinerary start/end markers missing');assert(mapState.journeyMarkersInView>=2,label+' itinerary start/end markers are outside the visible map: '+JSON.stringify(mapState));assert(Number(mapState.zoom)>=9,label+' itinerary fit zoomed out too far: '+JSON.stringify(mapState));assert(mapState.map.w>250&&mapState.map.h>180,label+' itinerary map collapsed');
}
async function waitForStagingRevision(page){
 if(!TARGET_SHA)return;
 const deadline=Date.now()+300000;
 while(Date.now()<deadline){
  try{
   await page.goto(BASE+'?acceptance-sha='+TARGET_SHA+'&t='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
   const state=await page.evaluate(target=>{
    const css=[...document.querySelectorAll('link[rel="stylesheet"]')].find(el=>/assets\/app-9\.0\.css/.test(el.href));
    const picker=[...document.scripts].find(el=>/js\/ui\/entity-picker\.js/.test(el.src));
    const ui=[...document.scripts].find(el=>/js\/journey\/ui\.js/.test(el.src));
    const urls={css:css?.href||null,picker:picker?.src||null,ui:ui?.src||null};
    const refs={css:!!css,picker:!!picker,ui:!!ui};
    const tokens=Object.fromEntries(Object.entries(urls).map(([key,url])=>[key,!!url&&url.includes(target)]));
    return {refs,urls,tokens,ready:Object.values(refs).every(Boolean)&&Object.values(tokens).every(Boolean)};
   },TARGET_SHA);
   if(state.ready){
    log('staging-revision',{sha:TARGET_SHA,assets:'target-token',urls:state.urls});
    return;
   }
   log('staging-wait',{sha:TARGET_SHA,reason:'target asset token not exposed',refs:state.refs,tokens:state.tokens,urls:state.urls});
  }catch(e){
   log('staging-wait',{sha:TARGET_SHA,reason:String(e?.message||e)});
  }
  await sleep(5000);
 }
 throw Error('Staging did not expose the deploy index for '+TARGET_SHA+' within 300s');
}
async function runViewport(browser,{name,width,height}){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'it-IT',timezoneId:'Europe/Rome'});
 const page=await context.newPage();await page.route('**/t-sand/**',route=>route.continue());const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
 const graphResponses=[];page.on('response',r=>{if(/\/runtime-data\/walk\/.+graph\.bin(\.gz)?/.test(r.url()))graphResponses.push({url:r.url(),status:r.status(),length:r.headers()['content-length']||null})});
 await waitForStagingRevision(page);await deepLinkSmoke(page,name);const nav=Date.now();await page.goto(BASE+'?mobile-acceptance='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>window.UVTransitJourney&&window.UVLocalWalk&&window.UVTransitEntityPicker&&window.UVTransitSearchAggregator,{},{timeout:20000});
 log('page-ready',{name,ms:Date.now()-nav});await layoutSnapshot(page,name+'-initial');await linePickerSmoke(page,name);

 const mapControlLayout=await page.evaluate(()=>{const m=document.querySelector('#map')?.getBoundingClientRect(),h=document.querySelector('#locateHero')?.getBoundingClientRect();return m&&h?{gapBottom:Math.round(m.bottom-h.bottom),heroTop:Math.round(h.top),heroBottom:Math.round(h.bottom),mapBottom:Math.round(m.bottom)}:null});
 assert(mapControlLayout&&mapControlLayout.gapBottom>=18&&mapControlLayout.gapBottom<=48,name+' Dove sono is not anchored near map bottom: '+JSON.stringify(mapControlLayout));
 await page.evaluate(async()=>{window.UVTransitAlerts?.stop?.();await new Promise(r=>setTimeout(r,1200));return window.UVTransitAlerts?.accept?.({schemaVersion:1,generatedAt:new Date().toISOString(),revision:'mobile-alert-test',sourceHealth:{telegram:{status:'ok'}},alerts:[{id:'mobile-a1',version:'1',provider:'AVM/Actv',category:'replacement_service',effects:['replacement_service'],cause:'operational',lifecycle:'active',severity:'major',planned:false,impact:'full',title:'Servizio sostitutivo · T1',body:'#muoversivenezia SERVIZIO INFOMOBILITÀ: servizio sostitutivo linea T1.',source:{channel:'telegram',publishedAt:new Date().toISOString(),url:'https://t.me/muoversivenezia/1'},scope:{networks:['tram'],lines:['T1'],stops:[],areas:[],directions:['both'],segments:[]},validity:{startsAt:new Date().toISOString(),endsAt:null,label:null},tags:['replacement_service'],audience:{topics:['line:T1'],pushEligible:true}}]})});
 await page.locator('#alertsBtn').click();await page.waitForSelector('#view-alerts',{state:'visible'});
 const alertCard=page.locator('#alertsList details.alert-card').first();assert(await alertCard.isVisible(),name+' alerts panel has no compact card');
 await alertCard.locator('summary').click();assert(await alertCard.evaluate(el=>el.open),name+' alert detail did not expand from compact row');
 await page.locator('#closeDrawer').click();
 await openJourney(page,true);
 // Dock, fullscreen workspace navigation and a simulated iOS visual viewport cycle.
 const dock=page.locator('.app-dock');assert(await dock.isVisible(),name+' dock hidden');
 assert(!(await page.locator('#searchDestination').isVisible()),name+' redundant destination shortcut visible');
 assert(!(await page.locator('#compactBtn').isVisible()),name+' legacy collapse control visible in fullscreen workspace');
 const workspace=await page.locator('#drawer').boundingBox(),mapWorkspace=await page.locator('.map-wrap').boundingBox();assert(workspace&&mapWorkspace&&Math.abs(workspace.height-mapWorkspace.height)<=2,name+' fullscreen workspace does not fill map area');
 await page.locator('#navSaved').click();assert(await page.locator('#view-favorites').isVisible(),name+' dock cannot switch panel');
 await page.locator('#journeyBtn').click();
 await page.evaluate(()=>{
  const input=document.querySelector('#journeyDestination');input.focus({preventScroll:true});
  window.__uvVvHeight=Object.getOwnPropertyDescriptor(window.visualViewport,'height');
  window.__uvVvTop=Object.getOwnPropertyDescriptor(window.visualViewport,'offsetTop');
  Object.defineProperty(window.visualViewport,'height',{configurable:true,value:Math.max(220,innerHeight-260)});
  Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,value:18});window.UVTransitRedesign.syncViewport();
 });
 const keyboardLayout=await page.evaluate(()=>{const d=document.querySelector('#drawer').getBoundingClientRect(),dock=document.querySelector('.app-dock'),n=dock.getBoundingClientRect(),dockStyle=getComputedStyle(dock),suggestions=document.querySelector('#destinationSuggestions')?.getBoundingClientRect();return {top:d.top,bottom:d.bottom,dockTop:n.top,dockBottom:n.bottom,dockDisplay:dockStyle.display,h:visualViewport.height,offset:visualViewport.offsetTop,suggestions:suggestions&&{top:suggestions.top,bottom:suggestions.bottom,height:suggestions.height}}});
 assert.equal(keyboardLayout.dockDisplay,'none',name+' persistent dock must hide while keyboard is open: '+JSON.stringify(keyboardLayout));
 assert(Math.abs(keyboardLayout.bottom-(keyboardLayout.h+keyboardLayout.offset))<=2,name+' keyboard workspace must fill the visual viewport: '+JSON.stringify(keyboardLayout));assert(keyboardLayout.top>=keyboardLayout.offset-1&&keyboardLayout.top<keyboardLayout.bottom,name+' keyboard workspace has invalid bounds: '+JSON.stringify(keyboardLayout));
 await page.evaluate(()=>{
  document.activeElement.blur();
  for(const [key,saved] of [['height',window.__uvVvHeight],['offsetTop',window.__uvVvTop]]){if(saved)Object.defineProperty(visualViewport,key,saved);else delete visualViewport[key]}
  window.UVTransitRedesign.syncViewport();
 });
 assert(await dock.isVisible(),name+' dock missing after keyboard');
 await page.locator('#closeDrawer').click();await openJourney(page,true);

 const coldStart=Date.now(),cold=await page.evaluate(async()=>{const t=performance.now(),m=await window.UVLocalWalk.ready();return {ms:performance.now()-t,transport:m.transport,gzipBytes:m.gzipBytes,bytes:m.bytes,nodes:m.nodes,edges:m.edges}});
 cold.ms=Math.round(cold.ms);log('walk-cold',{name,...cold});assert(cold.transport==='gzip'||cold.transport==='raw',name+' walking graph transport unknown');assert(cold.ms<15000,name+' cold graph readiness >15s');
 assert(cold.gzipBytes&&cold.gzipBytes<cold.bytes,name+' compressed graph metadata missing');
 const warm=await page.evaluate(async()=>{const t=performance.now(),m=await window.UVLocalWalk.ready();return {ms:performance.now()-t,transport:m.transport,nodes:m.nodes,edges:m.edges}});warm.ms=Math.round(warm.ms*10)/10;log('walk-warm',{name,...warm});assert(warm.ms<250,name+' warm graph readiness >250 ms');
 if(name==='iphone8-portrait')await addressSmoke(page,name);
 await page.screenshot({path:path.join(OUT,name+'-journey.png'),fullPage:true});
 await plannerFlow(page,name);
 await page.screenshot({path:path.join(OUT,name+'-itinerary.png'),fullPage:true});
 assert(errors.filter(x=>!/favicon|ResizeObserver/.test(x)).length===0,name+' browser errors: '+errors.join(' | '));
 log('graph-responses',{name,responses:graphResponses});
 await context.close();
 return cold;
}
(async()=>{
 assert(fs.existsSync(CHROME),'Chrome executable not found: '+CHROME);
 const browser=await chromium.launch({headless:true,executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const portrait=await runViewport(browser,{name:'iphone8-portrait',width:375,height:667});
  const landscape=await runViewport(browser,{name:'iphone8-landscape',width:667,height:375});
  // Warm-cache pass: same browser profile/context cache is not guaranteed across
  // isolated contexts, so verify repeat readiness inside one page/worker instead.
  assert(portrait.gzipBytes<8*1024*1024,'Compressed graph exceeds 8 MiB mobile budget');
  assert(landscape.gzipBytes===portrait.gzipBytes,'Graph manifest changed during acceptance run');
  log('mobile-acceptance',{status:'passed',gzipBytes:portrait.gzipBytes,rawBytes:portrait.bytes});
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exit(1)});

