const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
let n=0;const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{console.log('PASS '+name);n++});
const now=Math.floor(Date.now()/1000);
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Map,Set,Promise};
ctx.window=ctx;ctx.document={readyState:'loading'};ctx.addEventListener=()=>{};ctx.dispatchEvent=()=>{};ctx.CustomEvent=function(type,o){this.type=type;this.detail=o?.detail};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'js/core/gtfs.js'),'utf8'),ctx);
ctx.UVTransitProvider={
  loadRuntimeManifest:async()=>({schema:1}),
  loadRuntimeCore:async()=>({data:{routes:[
    {id:'R1',short:'1',long:'P.le Roma - Lido',type:4,color:'1188AA',textColor:'FFFFFF'},
    {id:'R17',short:'17',long:'Ferry Tronchetto - Lido',type:4,color:'CC5500',textColor:'FFFFFF'}
  ],trips:[
    {id:'T1',routeId:'R1',headsign:'Lido',directionId:'0',shapeId:'S1'},
    {id:'T1B',routeId:'R1',headsign:'Lido',directionId:'0',shapeId:'S1'},
    {id:'T17',routeId:'R17',headsign:'Lido',directionId:'0',shapeId:'S17'}
  ]}}),
  loadRuntimeShapes:async()=>({data:{shapes:{
    S1:[[45.4300,12.3200],[45.4310,12.3210],[45.4320,12.3220]],
    S17:[[45.4400,12.3000],[45.4410,12.3010],[45.4420,12.3020]]
  }}}),
  loadVehiclePositions:async()=>({header:{timestamp:now},entity:[
    {id:'V1',vehicle:{trip:{tripId:'T1'},position:{latitude:45.43101,longitude:12.32101,bearing:42,speed:5},timestamp:now}},
    {id:'V17',vehicle:{trip:{tripId:'T17'},position:{latitude:45.44101,longitude:12.30101,bearing:70,speed:4},timestamp:now}},
    {id:'VOUT',vehicle:{trip:{tripId:'T1B'},position:{latitude:45.45,longitude:12.35,bearing:10,speed:3},timestamp:now}},
    {id:'VX',vehicle:{trip:{tripId:'UNKNOWN'},position:{latitude:45.43,longitude:12.32},timestamp:now}}
  ]}),
  loadTripUpdates:async()=>({header:{timestamp:now},entity:[]}),
  loadStatus:async()=>({ok:true}),
  connect:()=>({close(){}})
};
vm.runInContext(fs.readFileSync(path.join(root,'js/water/realtime.js'),'utf8'),ctx);
(async()=>{
  await ctx.UVTransitWaterRealtime.start();
  await check('line 1 exposed from nav core',()=>assert(ctx.UVTransitWaterRealtime.routes().some(r=>r.key==='1')));
  await check('ferry requires line 17 plus Tronchetto/Lido metadata',()=>{
    const routes=ctx.UVTransitWaterRealtime.routes();
    assert.strictEqual(routes.find(r=>r.key==='17').ferry,true);
    assert.strictEqual(ctx.UVTransitWaterRealtime._test.isReliableFerry({short:'17',long:'Lido only'}),false);
  });
  await check('near shape sample is snapped',()=>assert.strictEqual(ctx.UVTransitWaterRealtime.vehicles().find(v=>v.id==='V1').snapped,true));
  await check('far sample falls back instead of forced snapping',()=>{
    const v=ctx.UVTransitWaterRealtime.vehicles().find(v=>v.id==='VOUT');
    assert(v.snapDistanceM>180);assert.strictEqual(v.snapped,false);
  });
  await check('unmapped realtime vehicle is preserved but not invented',()=>{
    const v=ctx.UVTransitWaterRealtime.vehicles().find(v=>v.id==='VX');
    assert(v);assert.strictEqual(v.mapped,false);assert.strictEqual(v.route,'');
  });
  await check('shape geometry available by selected route',()=>assert(ctx.UVTransitWaterRealtime.routeGeometries('1')[0].points.length===3));
  await check('P7 UI state flags are explicit',()=>{
    ctx.UVTransitWaterRealtime.setUiState({uiRendered:true,movementEngineApplied:true});
    const s=ctx.UVTransitWaterRealtime.snapshot();assert.strictEqual(s.uiRendered,true);assert.strictEqual(s.movementEngineApplied,true);
  });
  console.log(`RESULT: ${n} water P7 checks passed.`);
})().catch(e=>{console.error(e);process.exit(1)});
