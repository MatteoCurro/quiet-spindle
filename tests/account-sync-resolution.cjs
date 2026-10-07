const assert=require('node:assert/strict');
global.window=globalThis;
for(const p of [
 '../js/identity/storage.js','../js/identity/stores.js','../js/identity/profile-sync.js',
 '../js/identity/sync-id-map.js','../js/identity/sync-state.js','../js/identity/sync-serializer.js',
 '../js/identity/account-sync-controller.js'
])require(p);

let seq=1;
const uuid=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
const adapter=UVIdentityStorage.createMemory();
const stores=UVIdentityStores.create({adapter});
stores.savedPlaces.save([{id:'home',name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'origin'}]);
const scope=UVSyncIdMap.scopeTag('account-a');
const idMap=UVSyncIdMap.create({storage:adapter,scope,uuid});
const state=UVSyncState.create({storage:adapter,scope});
const serializer=UVAccountSyncSerializer.create({idMap,providerId:'actv'});
const profileSync=UVProfileSync.create({stores});
let lang='it';
const cloud={syncEnabled:false,settings:null,preferences:null,savedRoutes:[],savedStops:[],savedPlaces:[],savedJourneys:[],tombstones:[]};
const key={saved_route:'savedRoutes',saved_stop:'savedStops',saved_place:'savedPlaces',saved_journey:'savedJourneys'};
const remote={
 pull:async()=>JSON.parse(JSON.stringify(cloud)),
 configure:async enabled=>{cloud.syncEnabled=enabled;cloud.settings={revision:(cloud.settings?.revision||0)+1,updated_at:'s'};return {out_revision:cloud.settings.revision,out_updated_at:'s',out_sync_enabled:enabled}},
 write:async(type,payload,meta)=>{
  if(type==='preferences'){const rev=(cloud.preferences?.revision||0)+1;cloud.preferences={language:payload.language,revision:rev,updated_at:'p'};return {out_revision:rev,out_updated_at:'p'}}
  const list=cloud[key[type]],i=list.findIndex(x=>x.id===payload.id),rev=(i>=0?list[i].revision:0)+1,row={...payload,revision:rev,updated_at:'u'+rev};
  if(i>=0)list[i]=row;else list.push(row);return {out_revision:rev,out_updated_at:row.updated_at};
 },
 remove:async(type,id)=>{
  const list=cloud[key[type]],i=list.findIndex(x=>x.id===id),row=list[i];assert(row);list.splice(i,1);
  const tomb={resource_type:type,resource_id:id,revision:row.revision+1,deleted_at:'d'};cloud.tombstones.push(tomb);
  return {out_revision:tomb.revision,out_deleted_at:'d'};
 },
 tombstones:async()=>cloud.tombstones
};
const controller=UVAccountSyncController.create({
 remoteStore:remote,profileSync,serializer,idMap,state,getLanguage:()=>lang,setLanguage:async x=>{lang=x},uuid,noticeVersion:'v1'
});

(async()=>{
 const imported=await controller.activateAndImport();assert(imported.ok);assert.equal(cloud.savedPlaces.length,1);
 stores.savedPlaces.save([{id:'home',name:'Locale',point:{name:'Locale',lat:45.49,lon:12.24,place:true},role:'origin'}]);
 cloud.savedPlaces[0]={...cloud.savedPlaces[0],label:'Cloud',revision:2,updated_at:'u2'};
 let res=await controller.sync(),item=res.conflicts.find(x=>x.type==='saved_place');assert(item);
 await controller.resolve(item,'account');assert.equal(stores.savedPlaces.load([])[0].name,'Cloud');

 stores.savedPlaces.save([{id:'home',name:'Device',point:{name:'Device',lat:45.49,lon:12.24,place:true},role:'origin'}]);
 cloud.savedPlaces[0]={...cloud.savedPlaces[0],label:'Cloud2',revision:3,updated_at:'u3'};
 res=await controller.sync();item=res.conflicts.find(x=>x.type==='saved_place');assert(item);
 await controller.resolve(item,'device');assert.equal(cloud.savedPlaces[0].label,'Device');

 const oldId=cloud.savedPlaces[0].id;
 cloud.savedPlaces=[];cloud.tombstones=[{resource_type:'saved_place',resource_id:oldId,revision:5,deleted_at:'d5'}];
 stores.savedPlaces.save([{id:'home',name:'Device changed',point:{name:'Device changed',lat:45.49,lon:12.24,place:true},role:'origin'}]);
 res=await controller.sync();item=res.conflicts.find(x=>x.reason==='delete-vs-local-change');assert(item);
 const solved=await controller.resolve(item,'device');assert(solved.replacedId);assert.notEqual(solved.id,oldId);assert.equal(cloud.savedPlaces.length,1);assert.equal(cloud.savedPlaces[0].label,'Device changed');
 console.log('account-sync-resolution: account/device choices and tombstone resurrection-as-new passed');
})().catch(e=>{console.error(e);process.exitCode=1});
