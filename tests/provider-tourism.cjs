const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Map,Error});
for(const file of ['source-capabilities.js','transit-read-api.js'])
 vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const calls=[];
window.UVTransitSourceRegistry=window.UVTransitCapabilities.createRegistry();
window.UVTransitACTVSources={aut:{id:'actv:aut'}};
window.UVTransitProvider={
 loadRuntimeManifest:async()=>({schema:1}),
 loadRuntimeCore:async network=>{calls.push(['core',network]);return {data:{network}}},
 loadRuntimeShapes:async network=>{calls.push(['shapes',network]);return {data:{network}}},
 loadRuntimeSchedule:async network=>{calls.push(['schedule',network]);return {data:{network}}}
};
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-tourism.js','utf8'),ctx);
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('ACTV airport profile points to existing realtime source and lines 5/15',()=>{
 const x=window.UVTransitSourceRegistry.get('actv:airport-vce');
 assert(x);assert.equal(x.kind,'profile');assert.equal(x.supports('airport_connection'),true);
 assert.equal(x.metadata.parentSourceId,'actv:aut');assert.deepEqual([...x.metadata.routeShortNames],['5','15']);
 assert.equal(x.loadTransitState,undefined);
});
check('Alilaguna is a real schedule source with scheduled simulation capability',()=>{
 const x=window.UVTransitSourceRegistry.get('alilaguna:water');
 assert(x);assert.equal(x.kind,'source');assert.equal(x.network,'ali');
 assert.equal(x.supports('static_schedule'),true);assert.equal(x.supports('scheduled_simulation'),true);
 assert.equal(x.supports('realtime_vehicle_positions'),false);
});
check('Alilaguna runtime reads are hard-bound to ali network',async()=>{});
check('ATVO is registered honestly as catalog-only',()=>{
 const x=window.UVTransitSourceRegistry.get('atvo:airport');
 assert(x);assert.equal(x.kind,'catalog');
 assert.equal(x.supports('external_timetable'),true);assert.equal(x.supports('airport_connection'),true);
 assert.equal(x.supports('realtime_vehicle_positions'),false);assert.equal(x.supports('static_schedule'),false);
 assert.equal(x.loadRuntimeSchedule,undefined);assert.equal(x.metadata.structuredPublicFeed,null);
});
check('VCE profile aggregates ACTV ATVO and Alilaguna without consumer branching',()=>{
 assert.deepEqual([...window.UVTransitAirportProfiles.VCE.sourceIds],['actv:airport-vce','atvo:airport','alilaguna:water']);
});
check('TSF profile contains ATVO only at this stage',()=>{
 assert.deepEqual([...window.UVTransitAirportProfiles.TSF.sourceIds],['atvo:airport']);
});
check('only Alilaguna gets a TransitRead facade among new structured sources',()=>{
 assert(window.UVTransitSourceReads['alilaguna:water']);
 assert.equal(window.UVTransitSourceReads['atvo:airport'],undefined);
});

(async()=>{
 const read=window.UVTransitSourceReads['alilaguna:water'];
 const schedule=await read.journey.runtimeSchedule('ignored');
 assert.equal(schedule.data.network,'ali');
 assert.deepEqual(calls.at(-1),['schedule','ali']);
 n++;console.log('PASS Alilaguna runtime reads are hard-bound to ali network');
 console.log('RESULT: '+n+' airport/ATVO/Alilaguna provider checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
