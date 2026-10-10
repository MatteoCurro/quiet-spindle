/** Read-only browser-level smoke for the PUBLIC login page of TSAND Jarvis preview. */
const assert = require('node:assert/strict');
const {mkdirSync,readFileSync} = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('/tmp/jarvis-playwright/node_modules/playwright-core');

(async()=>{
  // Supabase intentionally rewrites HTML served on its shared domains to
  // text/plain. Test the SAME PR HTML in an ephemeral local HTTP server.
  const edgeSource=readFileSync(path.join(__dirname,'../supabase/functions/jarvis/index.ts'),'utf8');
  const encoded=edgeSource.match(/^const HTML=("(?:[^"\\]|\\.)*");/s);
  assert.ok(encoded,'Expected embedded frontend HTML in TSAND PR source');
  const html=JSON.parse(encoded[1]);
  const server=http.createServer((req,res)=>{
    if(req.url!=='/'){res.writeHead(404);res.end();return}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/';
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
      const debug=await page.evaluate(()=>({
        title:document.title,
        contentType:document.contentType,
        url:location.href,
        buttonCount:document.querySelectorAll('#githubLogin').length,
        visibleText:(document.body?.innerText||'').slice(0,220),
        htmlStart:document.documentElement?.outerHTML.slice(0,140),
      }));
      console.log('BROWSER_DIAGNOSTIC',v.name,JSON.stringify(debug));
      await page.screenshot({path:path.join('output','jarvis-tsand-'+v.name+'-initial.png'),fullPage:true});
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
      // VISUAL FIXTURE ONLY. This locally reveals the dashboard DOM; it does not
      // authenticate, read live run records, or alter the deployed frontend.
      await page.evaluate(()=>{
        const $=id=>document.getElementById(id);
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        $('runTitle').textContent='Run di test · Jarvis TSAND';
        $('runStatus').textContent='success';
        $('runStatus').className='status success';
        $('phase').textContent='done';
        $('activeCount').textContent='0';
        $('tokens').textContent='220';
        $('cost').textContent='$0,00';
        $('updated').textContent='Ultimo evento: 10/10/2026, 19:00';
        $('interaction').textContent='Nessuna azione richiesta';
        $('agents').innerHTML='<div class="agent"><span class="dot"></span>Engineering</div><div class="agent"><span class="dot"></span>UX Critic</div><div class="agent"><span class="dot"></span>Release Reviewer</div>';
        $('timeline').innerHTML='<div class="event"><time>19:00:00</time><span class="who">Reviewer</span><span class="msg">Verifica completata</span></div><div class="event"><time>18:59:50</time><span class="who">UX Critic</span><span class="msg">Interazione e accessibilità verificate</span></div>';
        $('runs').innerHTML='<div class="run"><b>#38073982335</b><span class="status success">success</span></div>';
      });
      const dashboardMetrics=await page.evaluate(()=>({
        viewportWidth:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth
      }));
      assert.ok(dashboardMetrics.scrollWidth<=dashboardMetrics.viewportWidth+2,
        'Synthetic dashboard overflow: '+JSON.stringify(dashboardMetrics));
      await page.screenshot({path:path.join('output','jarvis-tsand-'+v.name+'-synthetic-dashboard.png'),fullPage:true});
      console.log(JSON.stringify({viewport:v.name,synthetic_dashboard_layout_ok:true}));
      assert.equal(exceptions.length,0,'Browser module produced uncaught errors');
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
