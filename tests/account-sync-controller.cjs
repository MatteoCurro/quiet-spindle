const assert=require('node:assert/strict');
global.window=globalThis;

require('../js/identity/storage.js');
require('../js/identity/stores.js');
require('../js/identity/profile-sync.js');
require('../js/identity/sync-id-map.js');
require('../js/identity/sync-state.js');
require('../js/identity/sync-serializer.js');
require('../js/identity/account-sync-controller.js');

const clone=v=>JSON.parse(JSON.stringify(v));
let seq=1;
const nextUuid=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;

function harness(initialProfile={},initialRemote={}){
  const adapter=UVIdentityStorage.createMemory();
  const stores=UVIdentityStores.create({adapter});
  if(initialProfile.savedRoutes)stores.savedRoutes.save(initialProfile.savedRoutes);
  if(initialProfile.savedStops)stores.savedStops.save(initialProfile.savedStops);
  if(initialProfile.savedPlaces)stores.savedPlaces.save(initialProfile.savedPlaces);
  if(initialProfile.savedJourneys)stores.savedJourneys.save(initialProfile.savedJourneys);
  const scope=UVSyncIdMap.scopeTag(initialRemote.account||'account-a');
  const idMap=UVSyncIdMap.create({storage:adapter,scope,uuid:nextUuid});
  const state=UVSyncState.create({storage:adapter,scope});
  const serializer=UVAccountSyncSerializer.create({idMap,providerId:'actv'});
  const profileSync=UVProfileSync.create({stores});
  let language=initialProfile.language||'it';
  const data={
    syncEnabled:initialRemote.syncEnabled??true,
    settings:initialRemote.settings??{revision:1,updated_at:'s1'},
    preferences:initialRemote.preferences??null,
    savedRoutes:clone(initialRemote.savedRoutes||[]),
    savedStops:clone(initialRemote.savedStops||[]),
    savedPlaces:clone(initialRemote.savedPlaces||[]),
    savedJourneys:clone(initialRemote.savedJourneys||[]),
    tombstones:clone(initialRemote.tombstones||[])
  };
  const calls=[];
  const key={saved_route:'savedRoutes',saved_stop:'savedStops',saved_place:'savedPlaces',saved_journey:'savedJourneys'};
  const remote={
    pull:async()=>clone(data),
    configure:async(enabled,notice,meta)=>{
      calls.push(['configure',enabled,notice,clone(meta)]);
      const rev=Number(data.settings?.revision)||0;
      assert.equal(meta.expectedRevision,rev);
      data.syncEnabled=enabled;
      data.settings={revision:rev+1,updated_at:'settings-'+(rev+1)};
      return {out_revision:rev+1,out_updated_at:data.settings.updated_at,out_sync_enabled:enabled};
    },
    write:async(type,payload,meta)=>{
      calls.push(['write',type,clone(payload),clone(meta)]);
      if(type==='preferences'){
        const current=data.preferences;
        assert.equal(meta.expectedRevision,current?.revision||0);
        const rev=(current?.revision||0)+1;
        data.preferences={language:payload.language,revision:rev,updated_at:'pref-'+rev};
        return {out_revision:rev,out_updated_at:data.preferences.updated_at};
      }
      const list=data[key[type]],idx=list.findIndex(x=>x.id===payload.id);
      const current=idx>=0?list[idx]:null;
      assert.equal(meta.expectedRevision,current?.revision||0);
      const rev=(current?.revision||0)+1,row={...clone(payload),revision:rev,updated_at:type+'-'+rev};
      if(idx>=0)list[idx]=row;else list.push(row);
      return {out_revision:rev,out_updated_at:row.updated_at};
    },
    remove:async(type,id,meta)=>{
      calls.push(['remove',type,id,clone(meta)]);
      const list=data[key[type]],idx=list.findIndex(x=>x.id===id),current=idx>=0?list[idx]:null;
      assert(current);assert.equal(meta.expectedRevision,current.revision);
      list.splice(idx,1);
      const rev=current.revision+1,t={resource_type:type,resource_id:id,revision:rev,deleted_at:'del-'+rev};
      data.tombstones.push(t);
      return {out_revision:rev,out_deleted_at:t.deleted_at};
    },
    tombstones:async()=>clone(data.tombstones)
  };
  const controller=UVAccountSyncController.create({
    remoteStore:remote,profileSync,serializer,idMap,state,
    getLanguage:()=>language,setLanguage:async l=>{language=l},
    uuid:nextUuid,noticeVersion:'notice-v1'
  });
  return {adapter,stores,idMap,state,serializer,profileSync,data,calls,controller,getLanguage:()=>language};
}

(async()=>{
  // Enabled elsewhere: local guest data is not uploaded until this device accepts import.
  const h=harness({savedPlaces:[{id:'legacy-home',name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'origin'}]});
  const first=await h.controller.sync();
  assert.equal(first.needsImport,true);
  assert.equal(h.calls.some(x=>x[0]==='write'&&x[1]==='saved_place'),false);
  assert.equal(h.stores.savedPlaces.load([])[0].id,'legacy-home');

  // Explicit action enables sync if needed and imports this device's local profile.
  h.data.syncEnabled=false;h.data.settings=null;
  const imported=await h.controller.activateAndImport();
  assert.equal(imported.ok,true);
  assert.equal(h.state.importAccepted(),true);
  assert(h.calls.some(x=>x[0]==='configure'&&x[1]===true));
  const cloudPlace=h.data.savedPlaces[0];
  assert(cloudPlace&&cloudPlace.id);
  assert.equal(h.idMap.remoteFor('saved_place','legacy-home'),cloudPlace.id);

  // Local + cloud both changed from the same base: never last-write-wins silently.
  h.stores.savedPlaces.save([{id:'legacy-home',name:'Locale',point:{name:'Locale',lat:45.49,lon:12.24,place:true},role:'origin'}]);
  cloudPlace.label='Cloud';cloudPlace.revision=2;cloudPlace.updated_at='cloud-2';
  const conflict=await h.controller.sync();
  assert.equal(conflict.ok,false);
  assert(conflict.conflicts.some(x=>x.type==='saved_place'&&x.reason==='concurrent-update'));
  assert.equal(h.stores.savedPlaces.load([])[0].name,'Locale');

  // If local is unchanged from base and cloud was deleted, tombstone removes local copy.
  h.stores.savedPlaces.save([{id:'legacy-home',name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'origin'}]);
  h.data.savedPlaces=[];
  h.data.tombstones=[{resource_type:'saved_place',resource_id:cloudPlace.id,revision:3,deleted_at:'del-3'}];
  const deletion=await h.controller.sync();
  assert.equal(deletion.stats.pulledDeletes,1);
  assert.equal(h.stores.savedPlaces.load([]).length,0);

  // Exact initial place match adopts the existing cloud UUID, preserving the legacy local ID.
  const remoteId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const h2=harness(
    {savedPlaces:[{id:'my-hotel',name:'Hotel',point:{name:'Hotel',lat:45.5,lon:12.2,place:true},role:'both'}],language:'it'},
    {savedPlaces:[{id:remoteId,label:'Hotel',lat:45.5,lon:12.2,entity_id:null,role:'both',revision:4,updated_at:'r4'}],preferences:{language:'it',revision:1,updated_at:'p1'}}
  );
  const exact=await h2.controller.sync();
  assert.equal(exact.ok,true);
  assert.equal(h2.data.savedPlaces.length,1);
  assert.equal(h2.stores.savedPlaces.load([])[0].id,'my-hotel');
  assert.equal(h2.idMap.remoteFor('saved_place','my-hotel'),remoteId);
  assert.equal(h2.calls.some(x=>x[0]==='write'&&x[1]==='saved_place'),false);

  // Sync metadata/UUID maps are isolated between accounts on the same browser.
  const shared=UVIdentityStorage.createMemory();
  const scopeA=UVSyncIdMap.scopeTag('account-a'),scopeB=UVSyncIdMap.scopeTag('account-b');
  assert.notEqual(scopeA,scopeB);
  const mapA=UVSyncIdMap.create({storage:shared,scope:scopeA,uuid:nextUuid});
  const mapB=UVSyncIdMap.create({storage:shared,scope:scopeB,uuid:nextUuid});
  assert.notEqual(mapA.getOrCreate('saved_place','same-local'),mapB.getOrCreate('saved_place','same-local'));
  assert.notEqual(UVSyncState.create({storage:shared,scope:scopeA}).KEY,UVSyncState.create({storage:shared,scope:scopeB}).KEY);

  console.log('account-sync-controller: explicit import, CAS merge, conflicts, tombstones, exact rebind, account isolation passed');
})().catch(e=>{console.error(e);process.exitCode=1});
