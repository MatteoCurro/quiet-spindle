/* Run: NODE_PATH=<folder containing linkedom and jszip> node tests/integration.cjs
   DOM/Leaflet test doubles: not a browser rendering or live network test. */
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const {parseHTML}=require('linkedom'),JSZip=require('jszip');
const root=path.resolve(__dirname,'..');let {window}=parseHTML(fs.readFileSync(root+'/index.html','utf8'));
const timers=[],raf=[],errors=[],storage=new Map();let clock=Date.now(),successGPS,errorGPS,watches=0,clears=0;
window.window=window;window.console={log(){},info(){},warn(){},error(...a){errors.push(a)}};
window.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
window.setInterval=(f,n)=>{timers.push({f,n});return timers.length};window.clearInterval=()=>{};window.setTimeout=(f,n)=>{timers.push({f,n});return timers.length};window.clearTimeout=()=>{};
window.requestAnimationFrame=f=>raf.push(f);window.performance={now:()=>1000};window.location={search:'?embed=1',href:'https://example.test/app/?embed=1'};window.URLSearchParams=URLSearchParams;window.matchMedia=()=>({matches:false});window.ResizeObserver=class{observe(){}};
Object.defineProperty(window,'navigator',{value:{geolocation:{watchPosition:(s,e)=>{watches++;successGPS=s;errorGPS=e;return watches},clearWatch:()=>clears++}},configurable:true});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value||this.querySelector('option')?.getAttribute('value')||''},set(v){this._value=v}});
window.HTMLElement.prototype.getBoundingClientRect=function(){return {height:240,width:380}};
window.HTMLElement.prototype.focus=function(){window.document._active=this};Object.defineProperty(window.document,'activeElement',{get(){return this._active||this.body}});
let map;const layers=new Set();function layer(kind,point,opts){return {kind,point,opts,events:{},addTo(m){layers.add(this);return this},on(e,f){this.events[e]=f;return this},bindTooltip(){return this},bindPopup(){return this},setLatLng(p){this.point=p;return this},setIcon(i){this.opts.icon=i;return this},setStyle(s){this.style=s;return this},getElement(){return window.document.createElement('button')}}}
window.L={map(){map={zoomControl:{setPosition(){}},setView(){return this},getZoom:()=>13,getSize:()=>({x:1200,y:800}),panBy(){},invalidateSize(){},hasLayer:l=>layers.has(l),removeLayer:l=>layers.delete(l),fitBounds(){return this}};return map},tileLayer:(u,o)=>layer('tile',null,o),marker:(p,o)=>layer('marker',p,o),polyline:(p,o)=>layer('line',p,o),divIcon:x=>x,latLngBounds:()=>({pad(){return this}})};
const domWindow=window;
Object.defineProperty(domWindow.document,'baseURI',{value:'https://example.test/app/',configurable:true});
const localeFetch=async input=>{
 const url=String(input);
 const match=url.match(/\/locales\/([a-z]{2})\.json(?:\?|$)/);
 if(!match)throw Error('Unexpected integration fetch: '+url);
 const body=fs.readFileSync(path.join(root,'locales',match[1]+'.json'),'utf8');
 return {ok:true,status:200,json:async()=>JSON.parse(body)};
};
window={document:domWindow.document,console:domWindow.console,localStorage:domWindow.localStorage,setInterval:domWindow.setInterval,clearInterval:domWindow.clearInterval,setTimeout:domWindow.setTimeout,clearTimeout:domWindow.clearTimeout,requestAnimationFrame:domWindow.requestAnimationFrame,performance:domWindow.performance,location:domWindow.location,URL,URLSearchParams,matchMedia:domWindow.matchMedia,ResizeObserver:domWindow.ResizeObserver,L:domWindow.L,Event:domWindow.Event,Element:domWindow.Element,NodeFilter:domWindow.NodeFilter||{SHOW_ELEMENT:1,SHOW_TEXT:4},fetch:localeFetch,navigator:{geolocation:{watchPosition:(s,e)=>{watches++;successGPS=s;errorGPS=e;return watches},clearWatch:()=>clears++}}};window.addEventListener=domWindow.addEventListener.bind(domWindow);window.dispatchEvent=domWindow.dispatchEvent.bind(domWindow);window.CustomEvent=domWindow.CustomEvent;window.MutationObserver=class{observe(){}};window.window=window;const ctx=vm.createContext(window);function run(file){vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),ctx,{filename:file})}const $=id=>window.document.getElementById(id);const tick=()=>new Promise(r=>setImmediate(r));let count=0;function check(name,f){f();process.stdout.write('PASS '+name+'\n');count++}
(async()=>{
 const zip=new JSZip();const routes=['T1','T2',...Array.from({length:9},(_,i)=>String(i+1))];zip.file('routes.txt','route_id,route_short_name,route_type\n'+routes.map(r=>`${r},${r},${r[0]==='T'?0:3}`).join('\n'));zip.file('trips.txt','route_id,trip_id,direction_id,trip_headsign,shape_id\n'+routes.map(r=>`${r},trip${r},0,Destinazione ${r},shape`).join('\n'));zip.file('stops.txt','stop_id,stop_name,stop_lat,stop_lon\ns1,Fermata test,45.493,12.244\ns2,Fermata test,45.4931,12.2441');zip.file('shapes.txt','shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape,45.49,12.24,1\nshape,45.50,12.25,2');const bytes=await zip.generateAsync({type:'nodebuffer'});let empty=false;
 const vp=()=>({header:{timestamp:Math.floor(clock/1000)},entity:empty?[]:routes.map(r=>({id:r,vehicle:{trip:{tripId:'trip'+r},vehicle:{id:r},position:{latitude:45.493,longitude:12.244},timestamp:Math.floor(clock/1000)}}))});
 const tu=()=>({entity:routes.map(r=>({tripUpdate:{trip:{tripId:'trip'+r},stopTimeUpdate:[{stopId:'s1',arrival:{time:Math.floor(clock/1000)+240}},{stopId:'s2',arrival:{time:Math.floor(clock/1000)+480}}]}}))});
 window.JSZip=JSZip;
 const scripts=[...window.document.querySelectorAll('script[src]')].map(e=>e.getAttribute('src')).filter(s=>s.startsWith('js/')).map(s=>s.split('?')[0]);
 for(const file of scripts){if(file==='js/provider-actv.js'){window.UVTransitProvider={loadStaticGtfs:async()=>bytes,loadVehiclePositions:async()=>vp(),loadTripUpdates:async()=>tu(),connect:()=>({})};window.UVTransitRead=window.UVTransitReadAPI.create({source:window.UVTransitProvider});continue}run(file)}
 for(let i=0;i<30;i++)await tick();
 check('runtime without errors',()=>assert.equal(errors.length,0,JSON.stringify(errors)));
 check('toolbar keeps icon-only alerts and removes recenter/ellipsis',()=>assert($('alertsBtn')&&!$('alertsBtn').textContent.includes('Avvisi')&&!$('fitBtn')&&!$('moreBtn')));
 check('baseline startup self-test',()=>assert(window.UVTransitSelfTest.run().ok));
 check('embed mode',()=>assert(window.document.body.classList.contains('embed')));
 check('T1 and T2 markers',()=>assert.equal($('tramCount').textContent,'2'));
 check('11 land routes in unified picker',()=>assert.equal(window.document.querySelectorAll('#busList input').length,11));
 check('T1 and T2 are in unified picker',()=>assert.deepEqual([...window.document.querySelectorAll('#busList input')].filter(x=>/^T[12]$/.test(x.value)).map(x=>x.value),['T1','T2']));
 $('linesBtn').click();check('lines opens',()=>assert(!$('drawer').hidden&&!$('view-lines').hidden));
 const t2Chip=$('busSelectedChips').querySelector('[data-line-picker-selected="T2"]');check('selected tram has sticky chip',()=>assert(t2Chip));t2Chip.click();for(let i=0;i<10;i++)await tick();check('tram deselects from chip in one tap',()=>assert.equal($('tramFilter').value,'T1'));
 const t2Box=[...window.document.querySelectorAll('#busList input')].find(x=>x.value==='T2');t2Box.checked=true;t2Box.dispatchEvent(new window.Event('change'));for(let i=0;i<10;i++)await tick();check('tram can be restored from same picker',()=>assert.equal($('tramFilter').value,'ALL'));
 const pickerLocales={en:['Search for a bus or tram line','Selected bus and tram lines','Line T1'],fr:['Rechercher une ligne de bus ou de tram','Lignes de bus et de tram sélectionnées','Ligne T1'],de:['Bus- oder Tramlinie suchen','Ausgewählte Bus- und Tramlinien','Linie T1'],it:['Cerca una linea bus o tram','Linee bus e tram selezionate','Linea T1']};
 for(const [lang,expected] of Object.entries(pickerLocales)){await window.UVTransitI18n.setLocale(lang,{persist:false,updateUrl:false});for(let i=0;i<3;i++)await tick();check('unified picker '+lang+' runtime translation',()=>{assert.equal(window.document.querySelector('label[for="busSearch"]').textContent,expected[0]);assert.equal($('busSelectedPanel').getAttribute('aria-label'),expected[1]);assert(window.document.querySelector('[data-line-picker-row="T1"]').textContent.includes(expected[2]));});}
 $('navProfile').click();$('profileOptions').click();check('one panel at a time',()=>assert($('view-lines').hidden&&!$('view-more').hidden));
 $('closeDrawer').click();check('close drawer',()=>assert($('drawer').hidden));
 const cb=[...window.document.querySelectorAll('#busList input')].filter(x=>!/^T[12]$/.test(x.value));for(let i=0;i<9;i++){cb[i].checked=true;cb[i].dispatchEvent(new window.Event('change'));for(let j=0;j<10;j++)await tick()}
 check('eight-bus limit',()=>assert.equal(cb.filter(c=>c.checked).length,8));
 check('limit notice visible text',()=>assert($('selectionNotice').textContent.includes('8')));
 check('bus preferences persisted',()=>assert.equal(window.UVTransitPreferences.load().buses.length,8));
 $('busSearch').value='NO_MATCH';$('busSearch').dispatchEvent(new window.Event('input'));check('empty search',()=>assert(!$('busNoResults').hidden));
 window.document.querySelector('[data-favorite-route="T1"]').click();await tick();check('favorite route persisted',()=>assert(window.UVTransitFavorites.hasRoute('T1')));
 $('nearbyBtn').click();successGPS({coords:{latitude:45.493,longitude:12.244,accuracy:30}});check('nearby renders',()=>assert.equal($('nearby').style.display,'block'));
 $('navProfile').click();$('profileOptions').click();$('nearbyBtn').click();check('reopening does not toggle GPS',()=>assert.equal(watches,1));
 check('nearby states straight-line distance',()=>assert($('nearbyMeta').textContent.includes('linea d’aria')));
 $('nearbySaveBtn').click();await tick();check('favorite stop persisted',()=>assert(window.UVTransitFavorites.hasStop('s1')));
 const vehicleMarker=[...layers].find(l=>l.opts?.icon?.className==='smooth-vehicle');vehicleMarker.events.click();check('vehicle detail',()=>assert(!$('view-detail').hidden&&$('detailContent').textContent.includes('Ultimo dato')));
 check('route focus',()=>assert([...layers].filter(l=>l.kind==='line').some(l=>l.style?.opacity===.9)));
 $('closeDrawer').click();check('route focus restored',()=>assert([...layers].filter(l=>l.kind==='line').every(l=>l.style.opacity<=.5)));
 $('navProfile').click();$('profileOptions').click();$('favoritesBtn').click();const saved=[...$('favoritesList').querySelectorAll('button')].find(b=>b.textContent==='Fermata test');saved.click();check('saved stop opens timetable board without search',()=>assert(!$('view-station').hidden));
 window.UVTransitNotifications.setService({level:'error',title:'Dati non aggiornati',message:'Test',visible:true});check('feed warning persistent',()=>assert(!$('serviceBanner').hidden));window.UVTransitNotifications.setService({level:'success',title:'Aggiornato',message:'Test',visible:true});check('success compact',()=>assert($('serviceBanner').hidden));window.UVTransitAlerts.accept({schemaVersion:1,generatedAt:new Date().toISOString(),revision:'test-alerts',sourceHealth:{telegram:{status:'ok'},actvNews:{status:'ok'}},alerts:[
 {id:'a1',version:'v1',provider:'AVM/Actv',category:'replacement_service',effects:['replacement_service'],cause:'operational',lifecycle:'active',severity:'major',planned:false,impact:'full',title:'Servizio sostitutivo · T1',body:'⚠️ #muoversivenezia SERVIZIO INFOMOBILITÀ: servizio sostitutivo T1 in entrambe le direzioni.',source:{channel:'telegram',publishedAt:'2026-09-24T09:00:00Z',url:'https://t.me/muoversivenezia/1'},scope:{networks:['tram'],lines:['T1'],stops:[],areas:[],directions:['both'],segments:[]},validity:{startsAt:'2026-09-24T09:00:00Z',endsAt:null,label:null},tags:['replacement_service'],audience:{topics:['line:T1'],pushEligible:true}},
 {id:'a2',version:'v1',provider:'AVM/Actv',category:'route_diversion',effects:['route_diversion'],cause:'maintenance',lifecycle:'resolved',severity:'minor',planned:true,impact:'partial',title:'Deviazione · T2',body:'Deviazione T2 conclusa.',source:{channel:'actv-news',publishedAt:'2026-09-23T09:00:00Z',url:'https://actv.avmspa.it/it/content/test'},scope:{networks:['tram'],lines:['T2'],stops:[],areas:[],directions:[],segments:[]},validity:{startsAt:'2026-09-23T09:00:00Z',endsAt:'2026-09-23T12:00:00Z',label:'23 settembre'},resolvedBy:'a3',tags:['resolved'],audience:{topics:['line:T2'],pushEligible:false}}
]});
check('alert badge counts active incidents, not unread history',()=>assert.equal($('alertsBadge').textContent,'1'));
check('affected vehicle gets map wrench',()=>assert(vehicleMarker.opts.icon.html.includes('vehicle-alert-tool')));
const affectedRoute=[...layers].find(l=>l.kind==='line'&&l.opts?.className?.includes('uv-route-alert'));
check('affected route uses a clearly separated dash pattern',()=>assert(affectedRoute&&affectedRoute.opts.dashArray==='16 32'&&affectedRoute.opts.lineCap==='butt'&&typeof affectedRoute.events.click==='function'));
affectedRoute.events.click();await tick();
check('map incident opens the matching alert panel',()=>assert(!$('view-alerts').hidden&&window.document.querySelector('[data-alert-filter="active"]').getAttribute('aria-pressed')==='true'));
check('map incident opens its notification detail',()=>{const cards=$('alertsList').querySelectorAll('details.alert-card');assert.equal(cards.length,1,'alertsList='+$('alertsList').textContent);assert(cards[0].open);assert(cards[0].textContent.toLowerCase().includes('servizio sostitutivo'))});
check('favorite line alert is personalized',()=>assert($('alertsList').textContent.includes('Per te')));
const compactCard=$('alertsList').querySelector('details.alert-card');compactCard.querySelector('summary').click();check('alert row closes on tap',()=>assert(!compactCard.open));compactCard.querySelector('summary').click();check('alert row reopens on tap',()=>assert(compactCard.open));
check('expanded alert cleans telegram chrome and exposes source',()=>assert(!$('alertsList').textContent.includes('#muoversivenezia')&&!$('alertsList').textContent.includes('SERVIZIO INFOMOBILITÀ')&&$('alertsList').textContent.includes('Telegram AVM/Actv')));
 const stalePayload=window.UVTransitAlerts.current();stalePayload.generatedAt=new Date(Date.now()-20*60*1000).toISOString();window.UVTransitAlerts.accept(stalePayload);
 check('stale alert feed is visible but not operational',()=>assert(window.UVTransitAlerts.feedFresh()===false&&window.UVTransitAlerts.activeProblemCount()===0&&$('alertsBadge').hidden&&$('alertsSourceStatus').textContent.includes('stato operativo sulla mappa è sospeso')));
 const freshPayload=window.UVTransitAlerts.current();freshPayload.generatedAt=new Date().toISOString();window.UVTransitAlerts.accept(freshPayload);
 check('fresh alert feed restores operational state',()=>assert(window.UVTransitAlerts.feedFresh()===true&&window.UVTransitAlerts.activeProblemCount()===1));
 $('locateBtn').click();check('explicit GPS stop',()=>assert.equal(clears,1));$('locateBtn').click();errorGPS({code:1,message:'Denied'});check('GPS denied retry',()=>assert(!$('locateBtn').disabled&&$('locationFeedback').textContent.includes('negato')));
 $('navProfile').click();$('profileOptions').click();$('favoritesBtn').click();const favoriteRoute=[...$('favoritesList').querySelectorAll('button')].find(b=>b.textContent==='Linea T1');favoriteRoute.click();for(let i=0;i<20;i++)await tick();check('activate favorite route',()=>assert.equal($('tramFilter').value,'T1'));check('favorite selection syncs unified picker',()=>assert(![...window.document.querySelectorAll('#busList input')].find(x=>x.value==='T2').checked));
 check('T2 filtered from map',()=>assert.equal($('tramCount').textContent,'1'));
 $('navProfile').click();$('profileOptions').click();$('compactBtn').click();check('compact drawer',()=>assert($('drawer').classList.contains('compact')));$('compactBtn').click();check('expand drawer',()=>assert(!$('drawer').classList.contains('compact')));
 window.document.dispatchEvent(new window.Event('keydown'));check('no asynchronous errors',()=>assert.equal(errors.length,0,JSON.stringify(errors)));
 check('44px vehicle geometry',()=>assert.equal(vehicleMarker.opts.icon.iconSize[0],44));
 $('navProfile').click();check('profile opens without account requirement',()=>assert(!$('view-profile').hidden&&$('navProfile').getAttribute('aria-current')==='page'));
 $('profileOptions').click();check('profile options keep explicit back action',()=>assert(!$('view-more').hidden&&!$('panelBack').hidden));$('panelBack').click();check('back restores profile',()=>assert(!$('view-profile').hidden));
 $('navSaved').click();check('saved screen exposes routes and existing favorites',()=>assert(!$('view-favorites').hidden&&$('savedJourneys').textContent.includes('Percorsi')));
 $('navMap').click();check('map navigation closes panel',()=>assert($('drawer').hidden&&$('navMap').getAttribute('aria-current')==='page'));
 $('locateHero').click();const watchAfterHero=watches;successGPS({coords:{latitude:45.493,longitude:12.244,accuracy:25}});check('hero GPS publishes precision',()=>assert($('locateHeroStatus').textContent.includes('25')));$('locateHero').click();check('recenter never toggles off GPS',()=>assert.equal(watches,watchAfterHero));
 window.UVTransitSavedJourneys.save({network:'aut',origin:{id:'s1',ids:['s1','s2'],name:'Fermata test'},destination:{id:'end',name:'Venezia'}});$('navSaved').click();check('saved route rendered safely',()=>assert($('savedJourneys').textContent.includes('Fermata test → Venezia')));window.UVTransitSavedJourneys.save({network:'aut',origin:{id:'s1',ids:['s2','s1'],name:'Fermata test'},destination:{id:'end',name:'Venezia'}});check('same grouped route not duplicated',()=>assert.equal(window.UVTransitSavedJourneys.load().length,1));
 $('savedJourneys').querySelector('.saved-remove').click();check('saved route removed independently of line favorites',()=>assert.equal(window.UVTransitSavedJourneys.load().length,0));check('existing favorite preserved',()=>assert(window.UVTransitFavorites.hasRoute('T1')));
 const originalStorage=window.localStorage.setItem;window.localStorage.setItem=()=>{throw Error('quota')};check('storage error is surfaced, not silently reported saved',()=>assert.throws(()=>window.UVTransitSavedJourneys.save({network:'aut',origin:{id:'s1',name:'A'},destination:{id:'s2',name:'B'}}),/Impossibile salvare/));window.localStorage.setItem=originalStorage;
 process.stdout.write(`RESULT: ${count} checks passed. Simulated DOM and Leaflet, no live/browser claim.\n`);
})().catch(e=>{process.stderr.write(String(e.stack)+'\n');process.exitCode=1});
