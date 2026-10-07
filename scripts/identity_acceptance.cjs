const assert=require('assert');
const {chromium}=require('playwright-core');
const executablePath=process.env.CHROME_PATH;
const base=process.env.UV_STAGING_URL||'https://www.unlockvenice.com/t-sand/';
if(!executablePath)throw new Error('CHROME_PATH missing');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{
    localStorage.setItem('unlockVeniceTransitFavorites.v1',JSON.stringify({routes:['TEST-5'],stops:['TEST-S1']}));
    localStorage.setItem('unlockVeniceTransitPrefs.v1',JSON.stringify({tramFilter:'ALL',buses:['TEST-5'],layers:{routes:true},debug:false}));
    localStorage.removeItem('uv.profile.favorites.v1');
    localStorage.removeItem('uv.profile.preferences.v1');
    localStorage.removeItem('uv.identity.guest.v1');
    localStorage.removeItem('uv.identity.consent.v1');
    localStorage.removeItem('uv.identity.migration.v1');
  });
  const page=await context.newPage();
  const identityRequests=[];
  page.on('request',req=>{
    const u=req.url();
    if(/\/api\/[^?#]*identity|identity\.php|\/account\/guest/i.test(u))identityRequests.push(u);
  });
  await page.goto(base+'?identity-gate='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__UV_IDENTITY__&&window.UVGuestIdentity&&window.UVIdentityStores&&window.UVConsent&&window.UVProductAnalytics,{timeout:20000});

  const result=await page.evaluate(()=>{
    const guest=UVGuestIdentity.getOrCreate();
    const guestAgain=UVGuestIdentity.getOrCreate();
    const stores=UVIdentityStores.defaults();
    const consent=UVConsent.instance();
    const defaultAnalytics=consent.get('analytics');
    const defaultMarketing=consent.get('marketing');
    const safe=UVProductAnalytics.event('journey_search',{
      language:'it',network:'aut',identityState:'guest',
      query:'sensitive raw query',lat:45.4,lon:12.3,guestId:guest.id,gpsQuality:'good'
    });
    return {
      guest,guestAgain,
      migration:JSON.parse(localStorage.getItem(UVIdentityStores.KEYS.migration)||'null'),
      canonicalFavorites:JSON.parse(localStorage.getItem(UVIdentityStores.KEYS.favorites)||'null'),
      legacyFavorites:JSON.parse(localStorage.getItem('unlockVeniceTransitFavorites.v1')||'null'),
      canonicalPrefs:JSON.parse(localStorage.getItem(UVIdentityStores.KEYS.preferences)||'null'),
      legacyPrefs:JSON.parse(localStorage.getItem('unlockVeniceTransitPrefs.v1')||'null'),
      aliases:{
        identity:!!stores.IdentityStore,places:!!stores.SavedPlacesStore,routes:!!stores.SavedRoutesStore,
        prefs:!!stores.PreferencesStore,consent:!!stores.ConsentStore
      },
      defaultAnalytics,defaultMarketing,safe
    };
  });

  assert(/^guest:[0-9a-f-]{36}$/i.test(result.guest.id));
  assert.equal(result.guest.id,result.guestAgain.id,'guest identity changed in same storage context');
  assert.equal(result.guest.state,'guest');
  assert.equal(result.migration.schemaVersion,1);
  assert.equal(result.migration.legacyRetained,true);
  assert.deepEqual(result.canonicalFavorites,result.legacyFavorites);
  assert.deepEqual(result.canonicalPrefs,result.legacyPrefs);
  assert(Object.values(result.aliases).every(Boolean),'named storage interfaces missing');
  assert.equal(result.defaultAnalytics.status,'unset');
  assert.equal(result.defaultMarketing.status,'unset');
  assert.equal(result.safe.properties.identity_state,'guest');
  assert.equal(result.safe.properties.gps_quality,'good');
  assert.equal(result.safe.properties.query,undefined);
  assert.equal(result.safe.properties.lat,undefined);
  assert.equal(result.safe.properties.lon,undefined);
  assert.equal(result.safe.properties.guest_id,undefined);
  assert.equal(identityRequests.length,0,'identity foundation unexpectedly made network requests: '+JSON.stringify(identityRequests));

  console.log(JSON.stringify({result:'ok',gate:'M9-identity',guestState:result.guest.state,migrated:true,identityNetworkRequests:identityRequests.length}));
  await browser.close();
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
