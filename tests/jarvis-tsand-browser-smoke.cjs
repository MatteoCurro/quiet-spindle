/** Read-only browser-level smoke for the PUBLIC login page of TSAND Jarvis preview. */
const assert = require('node:assert/strict');
const {mkdirSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require('/tmp/jarvis-playwright/node_modules/playwright-core');

(async()=>{
  const url = 'https://xiiexzvuvzsiacbmwras.supabase.co/functions/v1/jarvis-preview';
  const browser = await chromium.launch({
    executablePath:process.env.GOOGLE_CHROME || '/usr/bin/google-chrome',
    headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  const tests = [
    {name:'mobile',width:390,height:844,isMobile:true},
    {name:'desktop',width:1280,height:800,isMobile:false},
  ];
  mkdirSync('output', {recursive:true});
  try {
    for(const v of tests){
      const context = await browser.newContext({
        viewport:{width:v.width,height:v.height},
        isMobile:v.isMobile,deviceScaleFactor:1
      });
      const page=await context.newPage();
      const exceptions=[];
      page.on('pageerror',error=>exceptions.push(String(error.message).slice(0,260)));
      const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      assert.equal(response?.status(),200,'preview must be accessible');
      await page.locator('#githubLogin').waitFor({state:'visible',timeout:10000});
      assert.equal(await page.locator('#app').isVisible(),false,'private dashboard cannot appear anonymously');
      const metrics=await page.evaluate(()=>({
        viewportWidth:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,
        hasForm:!!document.querySelector('#magicForm'),
        hasLogin:!!document.querySelector('#login'),
      }));
      assert.ok(metrics.scrollWidth<=metrics.viewportWidth+2,
        v.name+' horizontal overflow: '+JSON.stringify(metrics));
      assert.ok(metrics.hasForm&&metrics.hasLogin);
      await page.screenshot({path:path.join('output','jarvis-tsand-'+v.name+'.png'),fullPage:true});
      console.log(JSON.stringify({viewport:v.name,width:v.width,layout_ok:true,
        anonymous_dashboard_hidden:true,page_exceptions:exceptions}));
      assert.equal(exceptions.length,0,'Browser module produced uncaught errors');
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
