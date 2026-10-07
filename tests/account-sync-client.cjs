const assert=require('node:assert/strict');
global.window=globalThis;
const makeStorage=()=>{const m=new Map();return {getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k))}};
global.localStorage=makeStorage();
for(const p of ['../js/identity/storage.js','../js/identity/stores.js','../js/identity/sync-id-map.js','../js/identity/sync-serializer.js','../js/identity/remote-store.js','../js/identity/supabase-sync-store.js']){
 delete require.cache[require.resolve(p)];require(p);
}
let seq=1;const uuid=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
const adapter=UVIdentityStorage.createMemory(),idMap=UVSyncIdMap.create({storage:adapter,uuid});
const serializer=UVAccountSyncSerializer.create({idMap,providerId:'actv'});
const snapshot={schemaVersion:1,profile:{
 savedRoutes:['4L','T1'],savedStops:['S1'],
 savedPlaces:[{id:'place-old',name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'origin'}],
 savedJourneys:[{id:'legacy-journey',network:'all',origin:{name:'Mestre Centro',place:true,lat:45.49,lon:12.24},destination:{name:'Piazzale Roma',id:'R1',ids:['R1','R2'],lat:45.438,lon:12.319,network:'aut',members:[]},savedAt:123}],
 preferences:{debug:true,layers:{gps:true}},navigationPreferences:{voice:true}
}};
const wire=serializer.serialize(snapshot,{language:'it'});
assert.deepEqual(wire.savedRoutes.map(x=>x.route_id),['4L','T1']);
assert.equal(wire.savedPlaces[0].role,'origin');
assert.equal(wire.savedJourneys[0].network,'all');
assert.equal(wire.savedJourneys[0].origin_kind,'place');
assert.deepEqual(wire.savedJourneys[0].destination_ids,['R1','R2']);
assert.deepEqual(wire.preferences,{language:'it'});
assert.equal(JSON.stringify(wire).includes('debug'),false);
assert.equal(JSON.stringify(wire).includes('voice'),false);
assert.equal(JSON.stringify(wire).includes('guest'),false);
assert.equal(idMap.getOrCreate('saved_place','place-old'),wire.savedPlaces[0].id);

const back=serializer.deserialize({
 savedRoutes:wire.savedRoutes.map(x=>({...x,revision:1,updated_at:'2026-10-07T00:00:00Z'})),
 savedStops:wire.savedStops.map(x=>({...x,revision:1,updated_at:'2026-10-07T00:00:00Z'})),
 savedPlaces:wire.savedPlaces.map(x=>({...x,revision:1,updated_at:'2026-10-07T00:00:00Z'})),
 savedJourneys:wire.savedJourneys.map(x=>({...x,revision:1,updated_at:'2026-10-07T00:00:00Z'}))
});
assert.equal(back.profile.savedPlaces[0].id,'place-old');
assert.equal(back.profile.savedJourneys[0].id,'legacy-journey');
assert.deepEqual(back.profile.savedJourneys[0].destination.ids,['R1','R2']);
assert.equal(idMap.remoteFor('saved_route','actv|4L'),wire.savedRoutes[0].id);
assert.equal(idMap.remoteFor('saved_stop','actv|S1'),wire.savedStops[0].id);

const rows={
 account_settings:[{sync_enabled:true,revision:1,updated_at:'x'}],
 account_preferences:[{language:'it',revision:1,updated_at:'x'}],
 saved_routes:[],saved_stops:[],saved_places:[],saved_journeys:[]
};
const calls=[];
const client={
 from:name=>({select:async fields=>{calls.push(['select',name,fields]);return {data:rows[name]||[],error:null}}}),
 rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(name==='account_sync_tombstones')return {data:[],error:null};return {data:[{out_revision:2,out_updated_at:'x'}],error:null}}
};
const raw=UVSupabaseSyncStore.create({getClient:async()=>client,getUserId:async()=>'u1'});
const store=UVRemoteProfileStore.create(raw);
(async()=>{
 const pulled=await store.pull();assert.equal(pulled.syncEnabled,true);
 const op='11111111-1111-4111-8111-111111111111';
 await store.write('saved_place',wire.savedPlaces[0],{operationId:op,expectedRevision:1});
 const placeCall=calls.find(x=>x[1]==='sync_saved_place');assert(placeCall);
 assert.equal(placeCall[2].p_role,'origin');
 await store.write('saved_journey',wire.savedJourneys[0],{operationId:op,expectedRevision:1});
 const journeyCall=calls.find(x=>x[1]==='sync_saved_journey');assert.deepEqual(journeyCall[2].p_destination_ids,['R1','R2']);
 await store.remove('saved_place',wire.savedPlaces[0].id,{operationId:op,expectedRevision:2});
 assert(calls.some(x=>x[1]==='sync_delete_saved'));
 console.log('account-sync-client: allowlist, UUID map, roundtrip and remote store contract passed');
})().catch(e=>{console.error(e);process.exitCode=1});
