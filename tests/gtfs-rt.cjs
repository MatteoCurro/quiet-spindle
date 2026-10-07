const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');

function v(n){
  let x=BigInt.asUintN(64,BigInt(n)),a=[];
  do{let b=Number(x&0x7fn);x>>=7n;if(x)b|=0x80;a.push(b)}while(x);
  return Buffer.from(a);
}
function key(field,wire){return v((field<<3)|wire)}
function bytes(field,b){b=Buffer.from(b);return Buffer.concat([key(field,2),v(b.length),b])}
function str(field,s){return bytes(field,Buffer.from(s))}
function uint(field,n){return Buffer.concat([key(field,0),v(n)])}
function sint32(field,n){return Buffer.concat([key(field,0),v(BigInt.asUintN(64,BigInt(n)))])}
function flt(field,n){const b=Buffer.alloc(4);b.writeFloatLE(n);return Buffer.concat([key(field,5),b])}
function msg(field,parts){return bytes(field,Buffer.concat(parts))}

const header=msg(1,[str(1,'2.0'),uint(3,1780000000)]);
const trip=msg(1,[str(1,'UPSTREAM-42'),str(2,'08:15:00'),str(3,'20260928'),str(5,'RAW-R'),uint(6,1)]);
const arr=msg(2,[sint32(1,-45),uint(2,1780000300)]);
const stu=msg(2,[uint(1,7),arr,str(4,'STOP7')]);
const vehicleDesc=msg(3,[str(1,'BUS-12'),str(2,'12')]);
const tu=msg(3,[trip,stu,vehicleDesc,uint(4,1780000001),sint32(5,-30)]);
const entityTu=msg(2,[str(1,'tu-1'),tu]);

const vpTrip=msg(1,[str(1,'UPSTREAM-42'),str(5,'RAW-R'),uint(6,1)]);
const position=msg(2,[flt(1,45.493),flt(2,12.244),flt(3,123.5),flt(5,8.25)]);
const vp=msg(4,[vpTrip,position,uint(3,7),uint(4,2),uint(5,1780000002),str(7,'STOP7'),msg(8,[str(1,'BUS-12')])]);
const entityVp=msg(2,[str(1,'vp-1'),vp]);

const feed=Buffer.concat([header,entityTu,entityVp]);
const context={window:null,TextDecoder,Uint8Array,ArrayBuffer,DataView,BigInt,console};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/core/gtfs-rt.js'),'utf8'),context);
const out=context.UVTransitGTFSRT.decodeFeed(feed);
let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};
check('header decoded',()=>{assert.equal(out.header.gtfsRealtimeVersion,'2.0');assert.equal(out.header.timestamp,1780000000)});
check('two entities decoded',()=>assert.equal(out.entity.length,2));
check('trip descriptor decoded',()=>{const t=out.entity[0].tripUpdate.trip;assert.equal(t.tripId,'UPSTREAM-42');assert.equal(t.startTime,'08:15:00');assert.equal(t.startDate,'20260928');assert.equal(t.routeId,'RAW-R');assert.equal(t.directionId,1)});
check('negative delays decoded as int32',()=>{const tu=out.entity[0].tripUpdate;assert.equal(tu.delay,-30);assert.equal(tu.stopTimeUpdate[0].arrival.delay,-45)});
check('stop update decoded',()=>{const s=out.entity[0].tripUpdate.stopTimeUpdate[0];assert.equal(s.stopSequence,7);assert.equal(s.stopId,'STOP7');assert.equal(s.arrival.time,1780000300)});
check('vehicle position decoded',()=>{const p=out.entity[1].vehicle.position;assert(Math.abs(p.latitude-45.493)<0.0001);assert(Math.abs(p.longitude-12.244)<0.0001);assert(Math.abs(p.bearing-123.5)<0.01);assert(Math.abs(p.speed-8.25)<0.01)});
check('vehicle metadata decoded',()=>{const vp=out.entity[1].vehicle;assert.equal(vp.currentStopSequence,7);assert.equal(vp.currentStatus,2);assert.equal(vp.stopId,'STOP7');assert.equal(vp.vehicle.id,'BUS-12')});
console.log(`RESULT: ${n} GTFS-RT decoder checks passed.`);
