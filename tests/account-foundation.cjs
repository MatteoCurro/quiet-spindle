const assert=require('assert');
globalThis.window=globalThis;

function makeLocal(){
  const map=new Map();
  return {
    getItem:k=>map.has(String(k))?map.get(String(k)):null,
    setItem:(k,v)=>map.set(String(k),String(v)),
    removeItem:k=>map.delete(String(k))
  };
}
globalThis.localStorage=makeLocal();

for(const p of [
  '../js/identity/storage.js','../js/identity/stores.js','../js/identity/guest.js',
  '../js/identity/account-provider.js','../js/identity/account-session.js','../js/identity/profile-sync.js'
]){
  delete require.cache[require.resolve(p)];require(p);
}

(async()=>{
  const P=globalThis.UVAccountProvider;
  const normalized=P.normalizeSession({
    access_token:'secret',
    refresh_token:'secret2',
    user:{id:'u1',email:'user@example.com',name:'Matteo',role:'admin'}
  });
  assert.deepEqual(normalized,{state:'user',user:{id:'u1',email:'user@example.com',displayName:'Matteo'}});
  assert.equal(normalized.access_token,undefined,'tokens must never cross account boundary');
  assert.equal(normalized.user.role,undefined,'provider-specific claims must not leak by default');

  const guest=globalThis.UVGuestIdentity;
  const noop=P.createNoop();
  const session=globalThis.UVAccountSession.create({provider:noop,guest});
  const boot=await session.bootstrap();
  assert.equal(boot.state,'guest');
  assert(/^guest:/.test(boot.guestId));
  await assert.rejects(()=>session.signIn({email:'x@example.com'}),e=>e&&e.code==='ACCOUNT_PROVIDER_DISABLED');

  let signedIn=false;
  const adapter=P.create({
    kind:'test',
    currentSession:async()=>signedIn?{user:{sub:'remote-1',email:'a@b.test'}}:null,
    signIn:async()=>{signedIn=true;return {user:{sub:'remote-1',email:'a@b.test'},access_token:'hidden'}},
    signOut:async()=>{signedIn=false;return true}
  });
  const account=globalThis.UVAccountSession.create({provider:adapter,guest});
  assert.equal((await account.bootstrap()).state,'guest');
  const user=await account.signIn({});
  assert.deepEqual(user,{state:'user',guestId:null,account:{id:'remote-1',email:'a@b.test'}});
  assert.equal((await account.signOut()).state,'guest');

  const stores=globalThis.UVIdentityStores.defaults();
  stores.savedRoutes.save(['5','6']);
  stores.savedStops.save(['S1']);
  stores.savedPlaces.save([{id:'home',name:'Casa',point:{lat:45.49,lon:12.24}}]);
  stores.savedJourneys.save([{id:'j1'}]);
  stores.preferences.save({network:'all'});
  stores.navigationPreferences.save({voice:true});
  const sync=globalThis.UVProfileSync.create({stores,clock:()=>123});
  const snapshot=sync.collect();
  assert.equal(snapshot.schemaVersion,1);
  assert.equal(snapshot.generatedAt,123);
  assert.deepEqual(snapshot.profile.savedRoutes,['5','6']);
  assert.equal(snapshot.guestId,undefined,'guest identity must not be part of remote sync snapshot');
  assert.equal(snapshot.consent,undefined,'consent must not be silently included in profile sync');

  sync.apply({schemaVersion:1,profile:{
    savedRoutes:['7'],savedStops:['S2'],savedPlaces:[],savedJourneys:[],
    preferences:{network:'aut'},navigationPreferences:{voice:false}
  }});
  assert.deepEqual(stores.savedRoutes.load(),['7']);
  assert.deepEqual(stores.savedStops.load(),['S2']);
  assert.equal(stores.preferences.load().network,'aut');
  assert.equal(stores.navigationPreferences.load().voice,false);

  console.log('account-foundation tests passed');
})().catch(err=>{console.error(err);process.exit(1)});
