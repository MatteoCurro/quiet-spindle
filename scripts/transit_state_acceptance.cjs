const assert=require('assert');
const {chromium}=require('playwright-core');

const executablePath=process.env.CHROME_PATH;
const base=process.env.UV_STAGING_URL||'https://unlockvenice.com/t-sand/';
if(!executablePath)throw new Error('CHROME_PATH missing');

(async()=>{
  const browser=await chromium.launch({
    headless:true,
    executablePath,
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));

  await page.goto(base+'?transit-gate='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(
    ()=>window.UVTransitDiagnostics?.transitStateSmoke&&window.UVTransitDiagnostics?.transitMetricsSmoke&&window.UVTransitDiagnostics?.sourceQualitySmoke&&window.UVTransitDiagnostics?.derivedEventSmoke,
    {timeout:30000}
  );

  const result=await page.evaluate(async()=>{
    const D=window.UVTransitDiagnostics;
    const out={};
    for(const network of ['aut','nav']){
      out[network]={
        transit:await D.transitStateSmoke(network),
        derived:await D.derivedEventSmoke(network)
      };
    }
    return out;
  });

  for(const network of ['aut','nav']){
    const transit=result[network]?.transit;
    const derived=result[network]?.derived;
    assert(transit&&derived,network+' smoke result missing');
    assert.equal(transit.network,network);
    assert.equal(derived.network,network);
    assert.equal(transit.checks?.noCoordinates,true,network+' transit smoke leaked coordinates');
    assert.equal(transit.checks?.validModes,true,network+' transit smoke has invalid motion modes');
    assert.equal(transit.checks?.provenancePresent,true,network+' transit smoke missing provenance');
    assert.equal(transit.checks?.coverageAccounting,true,network+' transit coverage accounting invalid');
    assert.equal(transit.checks?.qualityDimensioned,true,network+' source quality dimensions missing');
    assert(transit.coverage,network+' transit coverage summary missing');
    assert(transit.sourceQuality,network+' source quality summary missing');
    assert(Number.isFinite(Number(transit.coverage.expected)),network+' expected metric missing');
    assert(Number.isFinite(Number(transit.coverage.observed)),network+' observed metric missing');
    assert(Number.isFinite(Number(transit.coverage.missing)),network+' missing metric missing');
    assert(['healthy','degraded','poor','idle'].includes(transit.sourceQuality.status),network+' source quality status invalid');
    assert.equal(derived.checks?.noCoordinates,true,network+' derived smoke leaked coordinates');
    assert.equal(derived.checks?.allDerived,true,network+' derived smoke contains non-derived events');
    assert.equal(derived.checks?.diagnosticOnly,true,network+' derived smoke exposed user-visible events');
    assert.equal(derived.checks?.officialSeparation,true,network+' derived/official provenance mixed');
    assert(Number.isFinite(Number(transit.generatedAt)),network+' transit generatedAt missing');
    assert(Number.isFinite(Number(derived.generatedAt)),network+' derived generatedAt missing');
  }

  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));
  const compact=Object.fromEntries(['aut','nav'].map(network=>[network,{
    transitSummary:result[network].transit.summary,
    transitCoverage:result[network].transit.coverage,
    sourceQuality:result[network].transit.sourceQuality,
    transitActive:result[network].transit.active.length,
    derivedSummary:result[network].derived.summary,
    derivedActive:result[network].derived.active.length,
    transitChecks:result[network].transit.checks,
    derivedChecks:result[network].derived.checks
  }]));
  console.log(JSON.stringify({result:'ok',gate:'A',networks:compact}));
  await browser.close();
})().catch(async e=>{console.error(e.stack||e);process.exit(1)});
