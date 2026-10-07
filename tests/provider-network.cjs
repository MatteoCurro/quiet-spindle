const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../js/provider-actv.js'),'utf8');
const calls=[];
const context={
  window:null,document:{baseURI:'https://www.unlockvenice.com/trasporti/'},URL,Intl,Date,
  fetch:async(url)=>{calls.push(['fetch',String(url)]);return {ok:true,status:200,json:async()=>({schema:1,networks:{}}),blob:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(0)}},
  console,setTimeout,clearTimeout
};context.window=context;vm.createContext(context);vm.runInContext(src,context);
const P=context.UVTransitProvider;let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};
check('provider identifies official ACTV source',()=>{assert.equal(P.id,'actv-official');assert.equal(P.label,'ACTV Open Data ufficiali')});
check('default endpoints remain automotive',()=>assert(P.endpoints.vehiclePositions.includes('network=aut&feed=vehiclePositions')));
check('official aut sources exact',()=>{const e=P.endpointsFor('aut');assert.equal(e.vehiclePositionsOfficial,'https://tpl.actv.it/aut/GTFSRT/vehiclePositions');assert.equal(e.tripUpdatesOfficial,'https://tpl.actv.it/aut/GTFSRT/tripUpdates');assert(e.staticOfficial.endsWith('/automobilistico/actv_aut.zip'))});
check('official nav sources exact',()=>{const e=P.endpointsFor('nav');assert.equal(e.vehiclePositionsOfficial,'https://tpl.actv.it/nav/GTFSRT/vehiclePositions');assert.equal(e.tripUpdatesOfficial,'https://tpl.actv.it/nav/GTFSRT/tripUpdates');assert(e.staticOfficial.endsWith('/navigazione/actv_nav.zip'))});
check('browser realtime is same-origin proxy',()=>{const e=P.endpointsFor('nav');assert.equal(e.vehiclePositions,'https://www.unlockvenice.com/trasporti/api/actv-realtime.php?network=nav&feed=vehiclePositions');assert.equal(e.tripUpdates,'https://www.unlockvenice.com/trasporti/api/actv-realtime.php?network=nav&feed=tripUpdates')});
check('legacy static fallback is same-origin proxy',()=>assert.equal(P.endpointsFor('aut').gtfs,'https://www.unlockvenice.com/trasporti/api/actv-static.php?network=aut'));
check('invalid network rejected',()=>assert.throws(()=>P.endpointsFor('foo'),/ACTV realtime non supportata/));
check('HTTP-only ACTV provider intentionally has no websocket',()=>assert.strictEqual(P.connect('nav',()=>{},{}),null));
check('legacy connect signature remains accepted',()=>assert.strictEqual(P.connect(()=>{},{}),null));
console.log(`RESULT: ${n} provider network checks passed.`);
