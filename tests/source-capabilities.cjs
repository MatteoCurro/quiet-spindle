const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Map,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/source-capabilities.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/transit-read-api.js','utf8'),ctx);
const C=window.UVTransitCapabilities;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

const calls=[];
const delegate={
 loadRuntimeManifest:()=>{calls.push(['manifest']);return 'manifest'},
 loadRuntimeCore:(network,manifest,snapshot)=>{calls.push(['core',network,manifest,snapshot]);return 'core'},
 loadRuntimeShapes:(network,manifest,snapshot)=>{calls.push(['shapes',network,manifest,snapshot]);return 'shapes'},
 loadRuntimeSchedule:(network,manifest)=>{calls.push(['schedule',network,manifest]);return 'schedule'},
 loadStaticGtfs:network=>{calls.push(['static',network]);return 'static'},
 loadVehiclePositions:network=>{calls.push(['vp',network]);return 'vp'},
 loadTripUpdates:network=>{calls.push(['tu',network]);return 'tu'},
 loadTransitState:(network,manifest,days,now)=>{calls.push(['state',network,manifest,days,now]);return 'state'},
 peekTransitState:(network,manifest,days,now,maxAgeMs)=>{calls.push(['cached-state',network,manifest,days,now,maxAgeMs]);return 'cached-state'},
 loadDriverStateAdapter:network=>{calls.push(['driver',network]);return 'driver'},
 loadDerivedEvents:network=>{calls.push(['events',network]);return 'events'},
 loadOperationalState:network=>{calls.push(['ops',network]);return 'ops'},
 loadStatus:network=>({network}),
 connect:(network)=>'connect:'+network
};
const adapter=C.createSourceAdapter({
 id:'actv:aut',providerId:'actv-official',network:'aut',mode:'road',label:'ACTV terra',
 capabilities:['static_schedule','realtime_vehicle_positions','realtime_trip_updates','canonical_state','predicted_live','scheduled_simulation','driver_state','derived_events','operational_state','raw_realtime'],
 delegate,metadata:{official:true}
});

check('source descriptor is immutable',()=>{assert(Object.isFrozen(adapter));assert(Object.isFrozen(adapter.capabilities));assert(Object.isFrozen(adapter.capabilityLabels))});
check('capability lookup is provider-neutral',()=>{assert.equal(adapter.supports('canonical_state'),true);assert.equal(adapter.supports('driver_state'),true);assert.equal(adapter.supports('missing'),false)});
check('labels carry stable i18n key and fallback',()=>{const x=adapter.capabilityLabels.find(x=>x.id==='predicted_live');assert(x);assert.equal(x.labelKey,'transit.capability.predicted_live');assert(x.fallback)});
check('bound adapter forces its own network for static reads',()=>{assert.equal(adapter.loadStaticGtfs('nav'),'static');assert.deepEqual(calls.at(-1),['static','aut'])});
check('bound adapter forces its own network for state reads',()=>{assert.equal(adapter.loadTransitState('nav','m',[1],2),'state');assert.deepEqual(calls.at(-1),['state','aut','m',[1],2])});
check('cache-only state reads are network-bound without changing capability semantics',()=>{assert.equal(adapter.peekTransitState('nav','m',[1],2,25000),'cached-state');assert.deepEqual(calls.at(-1),['cached-state','aut','m',[1],2,25000])});
check('manifest remains provider-global',()=>{assert.equal(adapter.loadRuntimeManifest(),'manifest');assert.deepEqual(calls.at(-1),['manifest'])});
check('connect is scoped to source network',()=>{assert.equal(adapter.connect('nav',()=>{},{}),'connect:aut')});
check('methods are only exposed when capability allows them',()=>{
 const scheduleOnly=C.createSourceAdapter({id:'rail:x',providerId:'rail',network:'x',capabilities:['static_schedule','scheduled_simulation'],delegate});
 assert.equal(typeof scheduleOnly.loadStaticGtfs,'function');
 assert.equal(scheduleOnly.loadVehiclePositions,undefined);
 assert.equal(scheduleOnly.loadTransitState,undefined);
});
check('registry lists and filters sources by capability',()=>{
 const registry=C.createRegistry();registry.register(adapter);
 const nav=C.createSourceAdapter({id:'actv:nav',providerId:'actv-official',network:'nav',mode:'water',capabilities:['static_schedule','realtime_vehicle_positions','canonical_state'],delegate});
 registry.register(nav);
 assert.equal(registry.list().length,2);assert.equal(registry.supporting('driver_state').length,1);assert.equal(registry.supporting('canonical_state').length,2);
});
check('duplicate source ids are rejected',()=>{const registry=C.createRegistry();registry.register(adapter);assert.throws(()=>registry.register(adapter),/duplicata/)});
check('unknown capability ids are dropped instead of becoming implicit contracts',()=>assert.deepEqual([...C._test.normalizeCapabilityIds(['static_schedule','made_up'])],['static_schedule']));

(async()=>{
 const source=C.createSourceAdapter({
  id:'future:test',providerId:'future',network:'future-net',mode:'bus',
  capabilities:['static_schedule','realtime_vehicle_positions','realtime_trip_updates'],
  delegate
 });
 const read=window.UVTransitReadAPI.create({source});
 assert.equal(read.capabilities.staticGtfs,true);
 assert.equal(read.capabilities.vehiclePositions,true);
 assert.equal(read.capabilities.transitState,false);
 assert.equal(await read.map.staticGtfs('ignored'),'static');
 assert.equal(await read.journey.tripUpdates('ignored'),'tu');
 n++;console.log('PASS TransitRead consumes source adapter without provider-specific consumer code');
 console.log('RESULT: '+n+' source capability checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
