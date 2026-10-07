const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../js/water/realtime.js'),'utf8');
const now=Math.floor(Date.now()/1000);
function prepareShape(points){points=[...points].sort((a,b)=>a.seq-b.seq);const cum=[0];for(let i=1;i<points.length;i++)cum.push(cum[i-1]+100);return {pts:points,cum,total:cum[cum.length-1]}}
function projectToShape(shape,pos){return {distance:3.5,progress:50,point:pos}}
const core={schema:1,network:'nav',routes:[{id:'R1',short:'1',type:4}],trips:[{id:'T1',routeId:'R1',shapeId:'S1'}],stops:[]};
const shapes={schema:1,network:'nav',shapes:{S1:[[45.43,12.33],[45.44,12.34]]}};
const vp={header:{timestamp:now},entity:[{id:'V1',vehicle:{trip:{tripId:'T1'},position:{latitude:45.435,longitude:12.335},timestamp:now}},{id:'V2',vehicle:{trip:{tripId:'UNKNOWN',routeId:'R1'},position:{latitude:45.4,longitude:12.3},timestamp:now}}]};
const tu={header:{timestamp:now},entity:[{tripUpdate:{trip:{tripId:'T1'},stopTimeUpdate:[]}},{tripUpdate:{trip:{tripId:'UNKNOWN'},stopTimeUpdate:[]}}]};
let wsArgs=null,events=[];
const provider={
  loadRuntimeManifest:async()=>({schema:1,networks:{nav:{core:{file:'n'},shapes:{file:'s'}}}}),
  loadRuntimeCore:async()=>({data:core}),loadRuntimeShapes:async()=>({data:shapes}),
  loadVehiclePositions:async n=>{assert.equal(n,'nav');return vp},loadTripUpdates:async n=>{assert.equal(n,'nav');return tu},
  loadStatus:async()=>({namespace:'actv-nav',feeds:{vehicle_positions:{count:2},trip_updates:{count:2}}}),
  connect:(network,onTick,handlers)=>{wsArgs={network,onTick};handlers.onOpen?.();return {close(){}}}
};
const context={window:null,document:{readyState:'loading'},UVTransitProvider:provider,UVTransitGTFS:{prepareShape,projectToShape},
  console,Date,JSON,Map,Object,Number,Math,Array,String,Promise,setTimeout,clearTimeout,setInterval,clearInterval,
  CustomEvent:function(type,init){this.type=type;this.detail=init.detail},dispatchEvent:e=>events.push(e),addEventListener:()=>{}};
context.window=context;vm.createContext(context);vm.runInContext(src,context);
(async()=>{
 const W=context.UVTransitWaterRealtime;assert(W);
 const s=await W.start();
 let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};
 check('network remains nav',()=>assert.equal(s.network,'nav'));
 check('water UI not rendered',()=>assert.equal(s.uiRendered,false));
 check('movement engine not applied',()=>assert.equal(s.movementEngineApplied,false));
 check('static route/trip/shape indexed',()=>{assert.equal(s.static.routes,1);assert.equal(s.static.trips,1);assert.equal(s.static.shapes,1);assert.equal(s.static.routeTypes['4'],1)});
 check('vehicle trip mapping measured',()=>{assert.equal(s.vehiclePositions.entities,2);assert.equal(s.vehiclePositions.mappedTrip,1);assert.equal(s.vehiclePositions.tripCoveragePct,50)});
 check('route-only water vehicle remains displayable',()=>{assert.equal(s.vehiclePositions.routeOnly,1);assert.equal(s.vehiclePositions.displayable,2);assert.equal(s.vehiclePositions.displayCoveragePct,100);assert.equal(s.vehiclePositions.renderCandidates,2)});
 check('shape snap measured',()=>{assert.equal(s.vehiclePositions.snap.tested,1);assert.equal(s.vehiclePositions.snap.p50M,3.5);assert.equal(s.vehiclePositions.snap.within100Pct,100)});
 check('trip update mapping measured',()=>{assert.equal(s.tripUpdates.updates,2);assert.equal(s.tripUpdates.mappedTrip,1);assert.equal(s.tripUpdates.tripCoveragePct,50)});
 check('freshness measured',()=>assert.equal(s.vehiclePositions.freshness.state,'fresh'));
 check('nav websocket connected',()=>assert.equal(wsArgs.network,'nav'));
 check('diagnostic event published',()=>assert(events.some(e=>e.type==='uv:water-realtime')));
 W.stop();
 console.log(`RESULT: ${n} water realtime checks passed.`);
})().catch(e=>{console.error(e);process.exit(1)});
