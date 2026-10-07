const assert=require('assert');
globalThis.window=globalThis;
globalThis.CustomEvent=class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail}};
globalThis.dispatchEvent=()=>true;
globalThis.location={search:''};
globalThis.crypto={randomUUID:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};

const map=new Map();
globalThis.localStorage={
  getItem:k=>map.has(String(k))?map.get(String(k)):null,
  setItem:(k,v)=>map.set(String(k),String(v)),
  removeItem:k=>map.delete(String(k))
};
localStorage.setItem('unlockVeniceTransitPrefs.v1',JSON.stringify({tramFilter:'T1',buses:['5']}));
localStorage.setItem('unlockVeniceTransitFavorites.v1',JSON.stringify({routes:['5'],stops:['A']}));
localStorage.setItem('unlockVeniceTransitPlaces.v1',JSON.stringify([{id:'p',name:'Casa',point:{name:'Casa',lat:45.5,lon:12.2,place:true},role:'both'}]));
localStorage.setItem('unlockVeniceTransitJourneys.v1',JSON.stringify([]));
localStorage.setItem('uv-navigation-preferences-v1',JSON.stringify({voice:true,accessibility:'foot'}));

for(const p of [
 '../js/identity/storage.js','../js/identity/stores.js','../js/identity/migration.js',
 '../js/state/preferences.js','../js/state/favorites.js','../js/state/places.js',
 '../js/state/journeys.js','../js/navigation/preferences.js'
]){
 delete require.cache[require.resolve(p)];require(p);
}
globalThis.UVIdentityMigration.run();

assert.equal(globalThis.UVTransitPreferences.load().tramFilter,'T1');
assert.equal(globalThis.UVTransitFavorites.hasRoute('5'),true);
assert.equal(globalThis.UVTransitSavedPlaces.load()[0].name,'Casa');
assert.equal(globalThis.UVNavigationPreferences.load().voice,true);

globalThis.UVTransitPreferences.save({...globalThis.UVTransitPreferences.load(),buses:['6']});
assert.equal(JSON.parse(localStorage.getItem('uv.profile.preferences.v1')).buses[0],'6');
assert.equal(JSON.parse(localStorage.getItem('unlockVeniceTransitPrefs.v1')).buses[0],'6');

globalThis.UVTransitFavorites.toggleRoute('6');
const canonical=JSON.parse(localStorage.getItem('uv.profile.favorites.v1'));
const legacy=JSON.parse(localStorage.getItem('unlockVeniceTransitFavorites.v1'));
assert.deepEqual(canonical,legacy,'favorites canonical/legacy mirror diverged');

globalThis.UVNavigationPreferences.save({voice:false,accessibility:'wheelchair'});
assert.equal(JSON.parse(localStorage.getItem('uv.profile.navigation.v1')).accessibility,'wheelchair');
assert.equal(JSON.parse(localStorage.getItem('uv-navigation-preferences-v1')).accessibility,'wheelchair');

console.log('identity-state-compat tests passed');
