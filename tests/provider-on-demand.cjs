const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Map,Error});
for(const f of ['source-capabilities.js'])vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+f,'utf8'),ctx);
window.UVTransitSourceRegistry=window.UVTransitCapabilities.createRegistry();
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-on-demand.js','utf8'),ctx);
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('land taxi is catalog/on-demand only',()=>{
 const x=window.UVTransitSourceRegistry.get('taxi:venice-land');
 assert(x);assert.equal(x.kind,'catalog');assert.equal(x.supports('on_demand'),true);
 assert.equal(x.supports('booking'),true);assert.equal(x.supports('fare_info'),true);
 assert.equal(x.supports('static_schedule'),false);assert.equal(x.supports('realtime_vehicle_positions'),false);
});
check('water taxi is separate from public Alilaguna transport',()=>{
 const x=window.UVTransitSourceRegistry.get('water-taxi:venice');
 assert(x);assert.equal(x.mode,'water_taxi');assert.equal(x.providerId,'consorzio-motoscafi-venezia');
 assert.equal(x.supports('airport_connection'),true);
});
check('NCC airport directory is catalog-only',()=>{
 const x=window.UVTransitSourceRegistry.get('ncc:venice-airport');
 assert(x);assert.equal(x.mode,'ncc');assert.equal(x.kind,'catalog');
 assert.equal(x.supports('static_schedule'),false);
});
check('none of on-demand sources exposes TransitRead transport methods',()=>{
 for(const id of ['taxi:venice-land','water-taxi:venice','ncc:venice-airport']){
  const x=window.UVTransitSourceRegistry.get(id);
  assert.equal(x.loadTransitState,undefined);assert.equal(x.loadTripUpdates,undefined);
  assert.equal(x.loadVehiclePositions,undefined);
 }
});
check('booking metadata remains external and explicit',()=>{
 assert(window.UVTransitOnDemandSources.landTaxi.metadata.bookingUrl);
 assert(window.UVTransitOnDemandSources.waterTaxi.metadata.bookingUrl);
});

console.log('RESULT: '+n+' on-demand provider checks passed.');
