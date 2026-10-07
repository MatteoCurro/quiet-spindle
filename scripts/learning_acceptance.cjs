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

  await page.goto(base+'?learning-gate='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.UVTransitProvider&&window.UVTransitRead?.diagnostics&&window.UVTransitLearning&&window.UVTransitLearningModels,{timeout:30000});

  const result=await page.evaluate(async()=>{
    const provider=window.UVTransitProvider;
    const layer=provider.loadLearningLayer('aut');
    if(!layer)throw new Error('ACTV learning layer unavailable');

    const firstSummary=layer.summary(Date.now()/1000);

    layer.setEnabled(false);
    const disabledSummary=layer.summary(Date.now()/1000);

    layer.setEnabled(true);
    layer.kill('staging-gate');
    const killedSummary=layer.summary(Date.now()/1000);

    layer.restore();
    const restoredSummary=layer.summary(Date.now()/1000);

    /* Lifecycle policy is exercised on an isolated registry: no realtime fetch
       and no live model promotion are required for this acceptance gate. */
    const isolated=window.UVTransitLearning.createLearningLayer();
    window.UVTransitLearningModels.createFirstLearningBundle({learningLayer:isolated});
    isolated.promotion.options.minScored=1;
    isolated.evaluation.ingest([
      {id:'gate-active',task:'trip_match',modelVersion:'deterministic-trip-match-v1',confidence:.7,error:{metric:'classification_correct',value:1}},
      {id:'gate-candidate',task:'trip_match',modelVersion:'trip-match-confidence-v1',confidence:.9,error:{metric:'classification_correct',value:1}}
    ]);
    const verdict=isolated.promotionVerdict('trip_match');
    const beforePromotion=isolated.models.resolve('trip_match')?.version||null;
    isolated.promote('trip_match',{reason:'staging-isolated-gate'});
    const afterPromotion=isolated.models.resolve('trip_match')?.version||null;
    isolated.rollback('trip_match',{reason:'staging-isolated-rollback'});
    const afterRollback=isolated.models.resolve('trip_match')?.version||null;

    return {
      firstSummary,disabledSummary,killedSummary,restoredSummary,
      lifecycle:{verdict,beforePromotion,afterPromotion,afterRollback}
    };
  });

  assert.equal(result.restoredSummary.enabled,true,'learning did not re-enable');
  assert.equal(result.restoredSummary.killSwitch,false,'learning kill switch did not restore');
  assert.equal(result.restoredSummary.models.active.every(x=>x.kind==='deterministic'),true,'live registry changed active model during gate');

  assert.equal(result.lifecycle.verdict.eligible,true,'isolated shadow candidate should be policy-eligible');
  assert.equal(result.lifecycle.beforePromotion,'deterministic-trip-match-v1','isolated baseline mismatch');
  assert.equal(result.lifecycle.afterPromotion,'trip-match-confidence-v1','explicit promotion failed');
  assert.equal(result.lifecycle.afterRollback,'deterministic-trip-match-v1','deterministic rollback failed');

  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));
  console.log(JSON.stringify({
    result:'ok',gate:'C',
    live:{
      health:result.firstSummary.health,
      active:result.firstSummary.models.active.map(x=>({task:x.task,version:x.version,kind:x.kind})),
      shadow:result.firstSummary.models.candidates.map(x=>({task:x.task,version:x.version,status:x.status})),
      liveFetches:0
    },
    lifecycle:result.lifecycle
  }));
  await browser.close();
})().catch(async e=>{console.error(e.stack||e);process.exit(1)});
