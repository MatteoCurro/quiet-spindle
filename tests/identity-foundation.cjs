const assert=require('assert');
globalThis.window=globalThis;

function makeLocal(seed={}){
  const map=new Map(Object.entries(seed).map(([k,v])=>[String(k),typeof v==='string'?v:JSON.stringify(v)]));
  return {
    getItem:k=>map.has(String(k))?map.get(String(k)):null,
    setItem:(k,v)=>map.set(String(k),String(v)),
    removeItem:k=>map.delete(String(k)),
    dump:()=>Object.fromEntries(map)
  };
}
globalThis.localStorage=makeLocal({
  'unlockVeniceTransitFavorites.v1':{routes:['5'],stops:['S1']},
  'unlockVeniceTransitPlaces.v1':[{id:'p1',name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'both'}],
  'unlockVeniceTransitJourneys.v1':[{id:'j1',network:'all',origin:{name:'A',place:true,lat:45.48,lon:12.23},destination:{name:'B',place:true,lat:45.44,lon:12.33},savedAt:1}],
  'unlockVeniceTransitPrefs.v1':{tramFilter:'ALL',buses:['5'],layers:{routes:true}},
  'uv-navigation-preferences-v1':{voice:true,accessibility:'foot'}
});
for(const p of [
  '../js/identity/storage.js','../js/identity/stores.js','../js/identity/guest.js',
  '../js/identity/consent.js','../js/identity/migration.js','../js/analytics/event-model.js'
]){
  delete require.cache[require.resolve(p)];require(p);
}

const stores=globalThis.UVIdentityStores.defaults();
for(const name of ['IdentityStore','SavedPlacesStore','SavedRoutesStore','PreferencesStore','ConsentStore']){
  assert(stores[name],name+' missing');
}

const first=globalThis.UVIdentityMigration.run();
assert.equal(first.record.schemaVersion,1);
assert.equal(first.record.legacyRetained,true);
assert.equal(stores.favorites.load().routes[0],'5');
assert.equal(stores.savedPlaces.load()[0].name,'Casa');
assert.equal(stores.navigationPreferences.load().voice,true);
assert(globalThis.localStorage.getItem(globalThis.UVIdentityStores.KEYS.favorites),'canonical favorites not created');
assert(globalThis.localStorage.getItem('unlockVeniceTransitFavorites.v1'),'legacy favorites must be retained');

stores.favorites.save({routes:['6'],stops:['S2']});
assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(globalThis.UVIdentityStores.KEYS.favorites)),{routes:['6'],stops:['S2']});
stores.SavedRoutesStore.save(['7']);
assert.deepEqual(stores.SavedRoutesStore.load(),['7']);
assert.deepEqual(stores.SavedStopsStore.load(),['S2'],'semantic SavedRoutesStore must preserve saved stops');
assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('unlockVeniceTransitFavorites.v1')),{routes:['7'],stops:['S2']},'legacy mirror must stay in sync');

const second=globalThis.UVIdentityMigration.run();
assert(second.record.results.every(x=>x.migrated===false),'migration must be idempotent after canonical keys exist');

globalThis.localStorage.setItem(globalThis.UVIdentityStores.KEYS.favorites,'{broken-json');
globalThis.localStorage.setItem('unlockVeniceTransitFavorites.v1',JSON.stringify({routes:['9'],stops:['S9']}));
const repaired=stores.favorites.migrate();
assert.equal(repaired.migrated,true,'corrupt canonical should be repaired from legacy mirror');
assert.equal(repaired.reason,'legacy-repair');
assert.deepEqual(stores.favorites.load(),{routes:['9'],stops:['S9']});

const guest=globalThis.UVGuestIdentity.getOrCreate();
assert(/^guest:[0-9a-f-]{36}$/i.test(guest.id),'guest identity must use guest:<uuid> format');
assert.equal(globalThis.UVGuestIdentity.getOrCreate().id,guest.id,'guest identity must be stable');
assert.equal(guest.state,'guest');

const consent=globalThis.UVConsent.create({store:stores.consent,clock:()=>12345});
assert.equal(consent.get('analytics').status,'unset');
const granted=consent.set('analytics','granted',{policyVersion:'2026-10',source:'settings'});
assert.deepEqual(granted,{type:'analytics',status:'granted',timestamp:12345,policy_version:'2026-10',source:'settings'});
assert.equal(consent.allows('analytics'),true);
assert.equal(consent.get('marketing').status,'unset','marketing consent must remain separate');

const A=globalThis.UVProductAnalytics;
const evt=A.event('journey_search',{
  language:'it',network:'aut',identityState:'guest',
  query:'Piazza San Marco',lat:45.43,longitude:12.33,guestId:guest.id,gpsQuality:'good',
  resultType:'transit'
});
assert.equal(evt.properties.language,'it');
assert.equal(evt.properties.identity_state,'guest');
assert.equal(evt.properties.gps_quality,'good');
assert.equal(evt.properties.result_type,'transit');
assert.equal(evt.properties.query,undefined);
assert.equal(evt.properties.lat,undefined);
assert.equal(evt.properties.longitude,undefined);
assert.equal(evt.properties.guest_id,undefined);

const delivered=[];
const emitter=A.createEmitter({sink:p=>delivered.push(p),consentStore:consent});
const firstEmit=emitter.emit('app_open',{language:'it'});
assert.equal(firstEmit.delivered,true,'analytics sink should receive event after explicit grant');
assert.equal(delivered.length,1);
consent.set('analytics','denied',{policyVersion:'2026-10',source:'settings'});
const secondEmit=emitter.emit('app_open',{language:'it'});
assert.equal(secondEmit.delivered,false,'consent-gated emitter must suppress denied analytics');
assert.equal(delivered.length,1);

console.log('identity-foundation tests passed');
