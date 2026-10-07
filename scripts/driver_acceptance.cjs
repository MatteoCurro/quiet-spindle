const assert=require('assert');
const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');
const executablePath=process.env.CHROME_PATH;
const base=process.env.UV_STAGING_URL||'https://unlockvenice.com/t-sand/';
const out=process.env.UV_MOBILE_ARTIFACTS||'mobile-artifacts';
if(!executablePath)throw new Error('CHROME_PATH missing');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));

 // Separate workflows can overlap: wait until the staging HTML itself is on the veil-first revision.
 const readyDeadline=Date.now()+90000;let ready=false,lastHtml='';
 while(Date.now()<readyDeadline&&!ready){
  const res=await context.request.get(base+'?driver-ready-check='+Date.now(),{headers:{'Cache-Control':'no-cache'}});
  lastHtml=await res.text();
  ready=lastHtml.includes('class="profile-card driver-profile-card"')&&lastHtml.includes('id="driverScheduledTime"')&&lastHtml.includes('id="driverDelayStatus"')&&!lastHtml.includes('id="developerMenu"')&&!lastHtml.includes('id="driverReached"')&&!lastHtml.includes('id="driverGuideSelection"');
  if(!ready)await new Promise(r=>setTimeout(r,2000));
 }
 assert(ready,'staging HTML did not reach veil-first driver revision');

 // Utility Autista is a production profile surface in 8.13.
 await page.goto(base+'?driver-profile-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.UVTransitDriverCodes&&window.UVTransitDriverUtility,{timeout:20000});
 await page.waitForSelector('#driverToolsBtn',{state:'attached'});
 assert(await page.locator('#driverToolsBtn').evaluate(el=>!el.hidden),'driver profile card must be enabled without a dev flag');

 // Driver utility is directly exposed in Profile.
 await page.locator('#navProfile').click();
 assert(await page.locator('#driverToolsBtn').isVisible(),'driver profile card should be visible directly in Profile');
 await page.locator('#driverToolsBtn').click();
 await page.waitForFunction(()=>document.body.dataset.panel==='driver-home');
 assert(await page.locator('#driverUploadBtn').isVisible(),'photo contribution should remain available on staging');
 const full=await page.evaluate(()=>{const d=document.querySelector('#drawer').getBoundingClientRect();return {h:d.height,vh:innerHeight,dock:getComputedStyle(document.querySelector('.app-dock')).display}});
 assert(full.h>=full.vh-4,'driver drawer is not full height: '+JSON.stringify(full));
 assert(full.dock==='none','driver mode must hide tourist dock');

 // Display-code catalogue. A selected veil is now the entry point to the GPS reminder.
 await page.locator('#driverCodesBtn').click();await page.selectOption('#driverCodeRoute','8AE');await page.fill('#driverCodeSearch','2205');
 const card=page.locator('#driverCodeResults .driver-code-card').filter({hasText:'2205'}).first();
 assert(await card.isVisible(),'2205 card missing');
 const txt=await card.innerText();assert(/CASALE/i.test(txt),'2205 CASALE text missing');assert(!/2026-03-20|Extraurbano|Aesys|Ameli|Plurimus/i.test(txt),'source metadata must not be shown in the catalogue');
 assert.equal(await page.locator('#driverReached').count(),0,'manual reached control must not exist');
 assert.equal(await page.locator('#driverPrevStop').count(),0,'manual previous-stop control must not exist');

 // Deterministic scheduled runs: the cockpit must choose by veil + GPS + current timetable, without realtime.
 await page.evaluate(()=>{
   let current={latitude:45.482,longitude:12.231,accuracy:20},watchCb=null,watchId=0;
   const packet=()=>({coords:{...current}});
   Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
     watchPosition:(ok)=>{watchCb=ok;const id=++watchId;setTimeout(()=>watchCb&&watchCb(packet()),0);return id;},
     clearWatch:()=>{watchCb=null;},
     getCurrentPosition:(ok)=>setTimeout(()=>ok(packet()),0)
   }});
   window.__driverSetGps=(latitude,longitude)=>{current={latitude,longitude,accuracy:20};if(watchCb)watchCb(packet())};

   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
   const today=parts.year+parts.month+parts.day,nowSec=(+parts.hour)*3600+(+parts.minute)*60+(+parts.second);
   const stops=[
    {id:'A',code:'A1',name:'Mestre FS',lat:45.482,lon:12.231},
    {id:'B',code:'B2',name:'Mogliano FS',lat:45.561,lon:12.236},
    {id:'C',code:'C3',name:'Casale sul Sile',lat:45.597,lon:12.326},
    {id:'X',code:'X1',name:'Mirano Centro',lat:45.494,lon:12.108},
    {id:'Y',code:'Y2',name:'Mirano Ospedale',lat:45.493,lon:12.115}
   ];
   const core={
    schema:1,network:'aut',
    routes:[{id:'R8',short:'8AE',long:'Linea 8AE',desc:'UM',type:3}],
    stops,
    trips:[
     {id:'driver-far',routeId:'R8',directionId:'0',headsign:'MOGLIANO FS prosegue per CASALE',shapeId:'SF',blockId:''},
     {id:'driver-near',routeId:'R8',directionId:'0',headsign:'MOGLIANO FS prosegue per CASALE',shapeId:'SN',blockId:''}
    ]
   };
   const schedule={
    schema:2,network:'aut',timezone:'Europe/Rome',
    routes:[['R8','8AE',3]],stops:stops.map(s=>[s.id,s.name,s.lat,s.lon,'']),
    snapshotByDay:{[today]:'synthetic'},
    chunksData:{[today]:{trips:[
     ['driver-far','R8','MOGLIANO FS prosegue per CASALE','SF',[
      ['X',1,nowSec-600,nowSec-590,true,true],['Y',2,nowSec-180,nowSec-170,true,true]
     ]],
     ['driver-near','R8','MOGLIANO FS prosegue per CASALE','SN',[
      ['A',1,nowSec-600,nowSec-590,true,true],['B',2,nowSec-180,nowSec-170,true,true],['C',3,nowSec+300,nowSec+310,true,true]
     ]]
    ]}}
   };
   const plan=window.UVTransitServicePlan.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{synthetic:core}});
   const expectedPosition=window.UVTransitExpectedPosition.createExpectedPositionModel({
    servicePlan:plan,shapesBySnapshot:{synthetic:{
     SF:[[45.494,12.108],[45.493,12.115]],
     SN:[[45.482,12.231],[45.561,12.236],[45.597,12.326]]
    }}
   });
   const identityResolver=window.UVTransitIdentityResolver.createIdentityResolver({servicePlan:plan,expectedPosition});
   const delayPosition=window.UVTransitDelayPosition.createDelayPositionModel({servicePlan:plan,expectedPosition});
   const motionState=window.UVTransitMotionState.createMotionStateModel({servicePlan:plan,expectedPosition,delayPosition});
   const transitStateEngine=window.UVTransitState.createTransitStateEngine({servicePlan:plan,expectedPosition,identityResolver,delayPosition,motionState});
   const driverStateAdapter=window.UVTransitDriverState.createDriverStateAdapter({servicePlan:plan,expectedPosition,identityResolver,transitStateEngine});
   const syntheticProvider=Object.freeze({...window.UVTransitProvider,loadDriverStateAdapter:async()=>({plan,expectedPosition,identityResolver,delayPosition,motionState,transitStateEngine,driverStateAdapter})});
   window.UVTransitProvider=syntheticProvider;
   window.UVTransitRead=window.UVTransitReadAPI.create({source:syntheticProvider});
 });
 await card.locator('.driver-start-guide').click();
 await page.waitForFunction(()=>document.body.dataset.panel==='driver-guide'&&!document.querySelector('#driverSession').hidden);
 assert.equal(await page.locator('#driverTripChoices .driver-trip-choice').count(),0,'scheduled runs should be resolved automatically, not shown as a second choice');
 assert.equal(await page.locator('#view-driver-guide .driver-code-card').count(),0,'selected veil must not be duplicated above the cockpit');
 assert.equal((await page.locator('#driverCurrentCode').innerText()).trim(),'2205');
 assert(/^\d{2}:\d{2}$/.test((await page.locator('#driverClock').innerText()).trim()),'current clock missing');
 assert(/^\d{2}:\d{2}$/.test((await page.locator('#driverScheduledTime').innerText()).trim()),'scheduled next-stop time missing');
 assert(/MOGLIANO FS prosegue per CASALE/i.test(await page.locator('#driverCurrentCodeText').innerText()));
 await page.waitForFunction(()=>/Mestre FS/i.test(document.querySelector('#driverCurrentStop').textContent),{timeout:10000});
 assert(/GPS/i.test(await page.locator('#driverGpsStatus').innerText()),'GPS status missing');

 // Moving the mocked device near the following stop advances the reminder automatically.
 await page.evaluate(()=>window.__driverSetGps(45.561,12.236));
 await page.waitForFunction(()=>/Mogliano FS/i.test(document.querySelector('#driverCurrentStop').textContent),{timeout:10000});
 await page.waitForFunction(()=>document.querySelector('#driverDelayStatus')?.classList.contains('late'),{timeout:10000});
 const delayState=await page.locator('#driverDelayStatus').evaluate(el=>({text:el.textContent,className:el.className}));assert(/late/.test(delayState.className),'punctuality state is not late: '+JSON.stringify(delayState));
 assert.equal((await page.locator('#driverCurrentCode').innerText()).trim(),'2205','veil code must stay fixed while stops advance');
 assert(/MOGLIANO FS prosegue per CASALE/i.test(await page.locator('#driverCurrentCodeText').innerText()),'veil text must stay fixed while stops advance');
 assert(/Poi: Casale sul Sile/i.test(await page.locator('#driverFollowingStop').innerText()),'following scheduled stop missing');
 await page.screenshot({path:path.join(out,'driver-utility.png'),fullPage:true});

 // Back from the reminder returns to the utility; another back returns directly to Profile.
 await page.locator('#panelBack').click();
 assert.equal(await page.evaluate(()=>document.body.dataset.panel),'driver-home','back from driver guide must return to driver home');
 await page.locator('#panelBack').click();
 assert.equal(await page.evaluate(()=>document.body.dataset.panel),'profile','back from driver home must return directly to Profile');
 assert(await page.locator('#driverToolsBtn').isVisible(),'driver profile card should remain available after returning to Profile');

 assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));
 console.log(JSON.stringify({result:'ok',panel:full,code:'2205',gpsAdvancedTo:'Mogliano FS',veilStayedFixed:true,commonEngineTripResolved:true,punctualityShown:true,noDuplicateVeil:true,directProfileEntry:true,publicProfileEntry:true,stagingUploadVisible:true,backStack:true}));
 await browser.close();
})().catch(async e=>{console.error(e.stack||e);process.exit(1)});
