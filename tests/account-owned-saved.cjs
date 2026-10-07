const assert=require('node:assert/strict');
global.window=globalThis;
const listeners=new Map();
global.addEventListener=(n,f)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f)};
global.dispatchEvent=e=>{for(const f of listeners.get(e.type)||[])f(e);return true};
global.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};

for(const p of [
 '../js/identity/storage.js','../js/identity/stores.js','../js/identity/profile-sync.js',
 '../js/identity/sync-id-map.js','../js/identity/sync-state.js','../js/identity/sync-serializer.js',
 '../js/identity/account-cache.js','../js/identity/account-sync-controller.js'
])require(p);

let seq=1;
const uuid=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
const adapter=UVIdentityStorage.createMemory();
const stores=UVIdentityStores.create({adapter});
stores.savedRoutes.save(['LEGACY']);
const profileSync=UVProfileSync.create({stores});
const idMap=UVSyncIdMap.create({storage:adapter,scope:UVSyncIdMap.scopeTag('account-a'),uuid});
const state=UVSyncState.create({storage:adapter,scope:UVSyncIdMap.scopeTag('account-a')});
const serializer=UVAccountSyncSerializer.create({idMap,providerId:'actv'});
const cache=UVAccountCache.create({stores,storage:adapter});
const cloud={
 syncEnabled:false,settings:null,preferences:null,
 savedRoutes:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',provider_id:'actv',route_id:'4L',revision:1,updated_at:'r1'}],
 savedStops:[],savedPlaces:[],savedJourneys:[],tombstones:[]
};
let failWrites=false,configureCalls=0,writeCalls=0,removeCalls=0;
const remote={
 pull:async()=>JSON.parse(JSON.stringify(cloud)),
 configure:async(enabled,notice,meta)=>{configureCalls++;cloud.syncEnabled=enabled;cloud.settings={revision:(cloud.settings?.revision||0)+1,updated_at:'s'};return {out_revision:cloud.settings.revision,out_sync_enabled:enabled,out_updated_at:'s'}},
 write:async(type,payload,meta)=>{
  writeCalls++;if(failWrites)throw Object.assign(new Error('offline'),{code:'ACCOUNT_SYNC_UNAVAILABLE'});
  const key={saved_route:'savedRoutes',saved_stop:'savedStops',saved_place:'savedPlaces',saved_journey:'savedJourneys'}[type];
  const list=cloud[key],i=list.findIndex(x=>x.id===payload.id),rev=(i>=0?list[i].revision:0)+1,row={...payload,revision:rev,updated_at:'u'+rev};
  if(i>=0)list[i]=row;else list.push(row);return {out_revision:rev,out_updated_at:row.updated_at};
 },
 remove:async(type,id,meta)=>{
  removeCalls++;const key={saved_route:'savedRoutes',saved_stop:'savedStops',saved_place:'savedPlaces',saved_journey:'savedJourneys'}[type];
  const list=cloud[key],i=list.findIndex(x=>x.id===id);assert(i>=0);const row=list[i];list.splice(i,1);
  const tomb={resource_type:type,resource_id:id,revision:row.revision+1,deleted_at:'d'};cloud.tombstones.push(tomb);
  return {out_revision:tomb.revision,out_deleted_at:tomb.deleted_at};
 },
 tombstones:async()=>cloud.tombstones
};
const controller=UVAccountSyncController.create({
 remoteStore:remote,profileSync,serializer,idMap,state,cacheManifest:cache,
 getLanguage:()=>null,setLanguage:async()=>{},uuid,noticeVersion:'notice-v1'
});

(async()=>{
 state.acceptImport(true); // stale flag from the superseded manual-sync prototype must never authorize upload.
 const connected=await controller.connectAccount();
 assert.equal(state.importAccepted(),false);
 assert.equal(connected.ok,true);
 assert.equal(configureCalls,1);
 assert.deepEqual(stores.savedRoutes.load().sort(),['4L','LEGACY']);
 assert.deepEqual(cache.load().routes,['4L']);
 assert.equal(writeCalls,0,'legacy local data must not upload on login');

 failWrites=true;
 await assert.rejects(()=>controller.saveOwned('saved_route','5'));
 assert.deepEqual(stores.savedRoutes.load().sort(),['4L','LEGACY'],'failed cloud write must not change local cache');
 failWrites=false;

 await controller.saveOwned('saved_route','5');
 assert(stores.savedRoutes.load().includes('5'));
 assert(cloud.savedRoutes.some(x=>x.route_id==='5'));
 assert(cache.load().routes.includes('5'));

 await controller.removeOwned('saved_route','4L');
 assert(!stores.savedRoutes.load().includes('4L'));
 assert(!cloud.savedRoutes.some(x=>x.route_id==='4L'));
 assert.equal(removeCalls,1);

 cache.purge();
 assert.deepEqual(stores.savedRoutes.load(),['LEGACY']);
 assert.deepEqual(cache.load().routes,[]);
 console.log('account-owned-saved: hydrate without legacy import, remote-first commit, remote-first delete and cache purge passed');
})().catch(e=>{console.error(e);process.exitCode=1});
