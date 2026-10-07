const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const base=process.env.UV_STAGING_URL||'https://www.unlockvenice.com/t-sand/';
const executablePath=process.env.CHROME_PATH;
if(!executablePath)throw Error('CHROME_PATH missing');

// Live deployment gate, deliberately independent of the ACTV realtime feed.
// No email is sent and no real account is created by CI.
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'it-IT'});
  const page=await context.newPage();
  const accountRequests=[];
  page.on('request',r=>{if(new URL(r.url()).hostname.endsWith('.supabase.co'))accountRequests.push(r.method()+' '+new URL(r.url()).pathname)});
  for(const file of ['config/account.json','config/privacy.json','privacy.html','assets/vendor/supabase-2.117.2.js']){
   const r=await context.request.get(new URL(file,base).href);
   assert.equal(r.status(),200,'missing deployed M10 asset: '+file);
  }
  const config=await (await context.request.get(new URL('config/account.json',base).href)).json();
  const privacy=await (await context.request.get(new URL('config/privacy.json',base).href)).json();
  assert.equal(config.enabled,true);assert.equal(config.environment,'tsand');
  assert.equal(config.noticeVersion,privacy.version);
  const auth=await context.request.get(config.url+'/auth/v1/settings',{headers:{apikey:config.publishableKey}});
  assert.equal(auth.status(),200,'Supabase Auth is unreachable');
  assert.equal((await auth.json()).external.email,true,'Email Auth disabled');

  await page.goto(base+'?lang=it&account-gate='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.cookie-layer').waitFor({state:'visible',timeout:30000});
  await page.getByRole('button',{name:'Solo necessari',exact:true}).click();
  await page.locator('#navProfile').click();
  await page.locator('#profileGuestAccount').waitFor({state:'visible',timeout:30000});
  assert.equal(await page.locator('#view-profile').isVisible(),true,'profile must remain separate from auth');
  assert.equal(await page.locator('#accountWizard').isVisible(),false,'account form must not be embedded in profile');
  assert.equal(await page.locator('#accountManageBtn').isVisible(),false,'guest must not see authenticated account entry');
  assert.equal(await page.locator('#accountLoginBtn').isVisible(),true,'guest login entry missing');
  assert.equal(await page.locator('#accountRegisterBtn').isVisible(),true,'guest registration entry missing');

  // Login and registration are separate first-class entry points.
  await page.locator('#accountLoginBtn').click();
  assert.equal(await page.locator('#view-account').isVisible(),true,'dedicated login view missing');
  await page.locator('#accountWizard input[type=email]').waitFor({state:'visible',timeout:30000});
  assert.equal(await page.locator('#accountWizard input[type=password]').count(),1,'login must request one password');
  assert.equal(await page.getByRole('button',{name:'Accedi',exact:true}).isVisible(),true,'primary login action missing');
  const fullscreen=await page.evaluate(()=>{
   const drawer=document.querySelector('#drawer').getBoundingClientRect(),dock=document.querySelector('.app-dock').getBoundingClientRect();
   return {heading:getComputedStyle(document.querySelector('.app-heading')).visibility,header:getComputedStyle(document.querySelector('.site-header')).visibility,top:drawer.top,bottom:drawer.bottom,dockTop:dock.top};
  });
  assert.equal(fullscreen.heading,'hidden','map Bus/Vaporetto chrome must be hidden in account workspace');
  assert.equal(fullscreen.header,'hidden','site header must be hidden in account workspace');
  assert(fullscreen.top<=2,'fullscreen workspace must start at viewport top');
  assert(Math.abs(fullscreen.bottom-fullscreen.dockTop)<=3,'fullscreen workspace must end at the persistent dock');
  await page.locator('#panelBack').click();

  await page.locator('#accountRegisterBtn').click();
  assert.equal(await page.locator('#view-account').isVisible(),true,'dedicated registration view missing');
  assert.equal(await page.evaluate(()=>document.body.dataset.panel),'account');
  await page.locator('#accountWizard input[type=email]').waitFor({state:'visible',timeout:30000});
  assert.equal(await page.locator('#accountWizard input[type=password]').count(),2,'registration must request and confirm password');
  assert.equal(await page.locator('#accountWizard .account-auth-surface').count(),1,'dedicated account registration surface missing');
  assert.equal(await page.getByRole('button',{name:'Crea account',exact:true}).isVisible(),true,'primary registration action missing');
  const guest=await page.evaluate(()=>({gate:UVAccountSaveGate.snapshot(),consent:UVConsent.instance().get('analytics')}));
  assert.equal(guest.gate.accountAvailable,true);assert.equal(guest.gate.canCreate,false);
  assert.equal(guest.consent.status,'denied');assert.equal(guest.consent.policy_version,privacy.version);
  assert.equal(accountRequests.length,0,'guest browsing must not contact Supabase');
  await page.locator('#panelBack').click();
  assert.equal(await page.locator('#view-profile').isVisible(),true,'back from account must return to profile');

  // A guest save request must expose the auth choice instead of forcing registration.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('uv:account-open-request',{detail:{reason:'save',kind:'route'}})));
  await page.locator('#profileGuestAccount').waitFor({state:'visible',timeout:5000});
  assert.equal(await page.locator('#view-profile').isVisible(),true,'guest save gate must land on auth choice');
  assert.equal(await page.locator('#view-account').isVisible(),false,'guest save gate must not force registration');

  // A prior decision must remain editable, including withdrawal of consent.
  await page.locator('#cookieSettingsBtn').click();
  const analytics=page.getByLabel('Analisi d’uso opzionale',{exact:true});
  assert.equal(await analytics.isChecked(),false);
  await analytics.check();
  await page.getByRole('button',{name:'Salva preferenze',exact:true}).click();
  assert.equal(await page.evaluate(()=>UVConsent.instance().get('analytics').status),'granted');
  await page.locator('#cookieSettingsBtn').click();
  assert.equal(await analytics.isChecked(),true);
  await page.getByRole('button',{name:'Solo necessari',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.UVCookieConsent&&window.UVAccountRuntime?.available(),null,{timeout:30000});
  assert.equal(await page.locator('.cookie-layer').count(),0,'cookie decision lost on reload');
  assert.equal(await page.evaluate(()=>UVConsent.instance().get('analytics').status),'denied');
  await page.locator('#navProfile').click();
  await page.locator('#profileGuestAccount').waitFor({state:'visible',timeout:30000});
  await page.locator('#accountRegisterBtn').click();
  assert.equal(await page.locator('#view-account').isVisible(),true);
  assert.equal(await page.locator('#accountWizard input[type=email]').isVisible(),true);
  assert.equal(await page.locator('#accountWizard input[type=password]').count(),2);
  assert.equal(await page.evaluate(()=>UVAccountSaveGate.canCreate()),false);
  assert.equal(accountRequests.length,0,'reload must remain guest without background auth');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,'mobile page overflows horizontally');
  console.log(JSON.stringify({result:'ok',gate:'M10-live-guest',assets:true,authEndpoint:true,separateLoginRegister:true,fullscreenWorkspace:true,mapChromeHidden:true,accountVisible:true,guestSaveGate:true,cookiePersisted:true,consentEditable:true,withdrawal:true,noGuestAuthRequests:true,passwordAuthEndToEnd:'manual checkpoint required'}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
