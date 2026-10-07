const {chromium}=require('playwright-core');
const executablePath=process.env.CHROME_PATH;
const base=process.env.UV_STAGING_URL||'https://www.unlockvenice.com/t-sand/';
if(!executablePath)throw new Error('CHROME_PATH missing');

const points=[
 {id:'mestre-station',name:'Mestre FS',lat:45.4822,lon:12.2310},
 {id:'piazza-ferretto',name:'Piazza Ferretto',lat:45.4912,lon:12.2427},
 {id:'piazzale-roma',name:'Piazzale Roma',lat:45.4388,lon:12.3185},
 {id:'rialto',name:'Rialto',lat:45.4380,lon:12.3358},
 {id:'san-marco',name:'San Marco',lat:45.4342,lon:12.3385}
];

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 await page.goto(base+'?imagery-audit='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.UVStreetImagery?.createPanoramax,{timeout:20000});
 const result=await page.evaluate(async(points)=>{
   const provider=window.UVStreetImagery.createPanoramax();
   const out=[];
   for(const p of points){
     try{
       const rows=await provider.nearby({lat:p.lat,lon:p.lon,radiusM:180,limit:5});
       out.push({...p,ok:true,count:rows.length,nearest:rows[0]?{
         id:rows[0].id,source:rows[0].source,capturedAt:rows[0].capturedAt,
         thumbnail:!!rows[0].thumbnailUrl
       }:null});
     }catch(err){
       out.push({...p,ok:false,count:0,error:String(err?.message||err)});
     }
   }
   return out;
 },points);
 console.log(JSON.stringify({provider:'panoramax',radiusM:180,points:result},null,2));
 await browser.close();
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
