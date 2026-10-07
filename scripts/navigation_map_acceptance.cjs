const assert=require('assert');
const {chromium}=require('playwright-core');

const executablePath=process.env.CHROME_PATH;
const base=process.env.UV_STAGING_URL||'https://www.unlockvenice.com/t-sand/';
if(!executablePath)throw new Error('CHROME_PATH missing');

(async()=>{
  const browser=await chromium.launch({
    headless:true,executablePath,
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));

  await page.goto(base+'?navdev=1&nav-map-gate='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.UVNavigationMap&&window.UVNavigationProgress&&window.UVNavigationBasemap&&window.UVMapLibreRuntime,{timeout:30000});

  const result=await page.evaluate(async()=>{
    const host=document.createElement('div');
    host.id='navMapAcceptance';
    Object.assign(host.style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',zIndex:'99999'});
    document.body.append(host);

    const route={
      provider:'acceptance',
      shape:[
        {lat:45.4822,lon:12.2310},
        {lat:45.4830,lon:12.2332},
        {lat:45.4842,lon:12.2351}
      ],
      maneuvers:[],units:'metric'
    };
    const activated=await window.UVNavigationMap.activate({container:host,route,locale:'it'});
    await new Promise(r=>setTimeout(r,1200));
    window.UVNavigationMap.update({progressM:45,position:{lat:45.4827,lon:12.2322,accuracyM:10}});
    await new Promise(r=>setTimeout(r,500));
    const diagnostics=window.UVNavigationMap.diagnostics();
    const canvas=host.querySelector('canvas');
    const css=[...document.styleSheets].some(s=>String(s.href||'').includes('maplibre-gl.css'));
    const canvasStyle=canvas?getComputedStyle(canvas):null;
    const result={
      activated,diagnostics,css,
      canvasPresent:!!canvas,
      canvasBufferWidth:Number(canvas?.width)||0,
      canvasBufferHeight:Number(canvas?.height)||0,
      canvasDisplay:canvasStyle?.display||'',
      canvasVisibility:canvasStyle?.visibility||''
    };
    window.UVNavigationMap.deactivate();
    host.remove();
    return result;
  });

  assert(result.css,'MapLibre CSS was not loaded');
  assert(result.canvasPresent,'MapLibre canvas missing');
  assert(result.diagnostics.active,'navigation map did not become active');
  assert(result.activated?.basemap,'navigation basemap was not selected');
  assert(result.diagnostics.hostWidth>=380,'navigation host width too small: '+JSON.stringify(result));
  assert(result.diagnostics.hostHeight>=800,'navigation host height too small: '+JSON.stringify(result));
  assert(result.diagnostics.canvasWidth>=380,'navigation canvas width too small: '+JSON.stringify(result));
  assert(result.diagnostics.canvasHeight>=800,'navigation canvas height too small: '+JSON.stringify(result));
  assert(result.canvasBufferWidth>=700,'navigation WebGL buffer width too small: '+JSON.stringify(result));
  assert(result.canvasBufferHeight>=1500,'navigation WebGL buffer height too small: '+JSON.stringify(result));
  assert.equal(result.diagnostics.routeSource,true,'navigation route source missing');
  assert.equal(result.diagnostics.pointsSource,true,'navigation points source missing');
  assert.notEqual(result.canvasDisplay,'none','navigation canvas is display:none');
  assert.notEqual(result.canvasVisibility,'hidden','navigation canvas is hidden');
  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));

  console.log(JSON.stringify({result:'ok',gate:'M8-map',...result}));
  await browser.close();
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
