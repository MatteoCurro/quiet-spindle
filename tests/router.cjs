const fs=require('fs'),vm=require('vm'),assert=require('assert');const ctx={console,Intl,Date,Map,Set};vm.createContext(ctx);for(const f of ['schedule','router'])vm.runInContext(fs.readFileSync(__dirname+'/../js/journey/'+f+'.js','utf8'),ctx);const {Schedule}=ctx.UVTransitSchedule,R=ctx.UVTransitRouter;
const now=Date.parse('2026-09-21T08:00:00+02:00')/1000,day='20260921';let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function make(stops,trips){const s=new Schedule();s.loadRuntime({schema:1,timezone:'Europe/Rome',days:[day],routes:trips.map(t=>({id:t[0],name:t[0]})),stops:stops.map(s=>({id:s[0],name:s[0],lat:s[1],lon:s[2]})),trips:trips.map(t=>({id:t[0],routeId:t[0],dates:[day],stops:[[t[1],1,t[3]*60,t[3]*60,1,0],[t[2],2,t[4]*60,t[4]*60,0,1]]}))},now);return s;}
const aut=make([['a',45.5,12.2],['b',45.44,12.32],['c',45.42,12.37],['d',45.40,12.37]],[['1','a','b',490,500],['2','c','d',530,540]]);
const nav=make([['b',45.439,12.32],['c',45.42,12.371],['d',45.40,12.371],['e',45.37,12.4]],[['1','b','c',510,520],['17','d','e',550,570]]);
const e=R.merge([['aut',aut],['nav',nav]]),plan=opts=>R.plan(e,[{id:'aut:a'}],[{id:'nav:e'}],now,opts);
test('colliding stop and trip IDs remain independent',()=>{assert.equal(e.trips.size,4);assert.equal(e.stops.size,8);assert.equal(e.trips.get('nav:1').network,'nav');});
test('three transfers combine land water land ferry',()=>{const r=plan()[0];assert.equal(r.legs.length,4);assert.deepEqual(Array.from(r.legs,l=>l.network),['aut','nav','aut','nav']);assert.equal(r.arrival,now+90*60);assert.equal(r.verified,false);});
const links=plan()[0].legs.filter(l=>l.transfer).map(l=>({...l.transfer,seconds:180,verified:true,points:[[l.transfer.from.lat,l.transfer.from.lon],[l.transfer.to.lat,l.transfer.to.lon]]}));
test('verified pedestrian changes produce a publishable route',()=>{const r=plan({walkLinks:links})[0];assert(r.verified);assert.equal(r.walkSeconds,540);});
test('unwalkable canal crossing removes impossible itinerary',()=>assert.equal(plan({walkLinks:links.map(l=>({...l,blocked:true}))}).length,0));
test('actual walking time can make a connection impossible',()=>assert.equal(plan({walkLinks:links.map(l=>({...l,seconds:1000}))}).length,0));
test('limiting boarding rounds cannot silently add a fourth leg',()=>assert.equal(plan({maxLegs:3}).length,0));
test('reverse direction is not invented',()=>assert.equal(R.plan(e,[{id:'nav:e'}],['aut:a'],now).length,0));
test('longer access walk cannot catch departed bus',()=>assert.equal(R.plan(e,[{id:'aut:a',seconds:700}],['nav:e'],now).length,0));
test('cross-stop forbidden transfer rule is respected',()=>{e.transferRules.push({from_stop_id:'aut:b',to_stop_id:'nav:b',transfer_type:'3'});assert.equal(plan({walkLinks:links}).length,0);e.transferRules=[];});
test('minimum transfer time is counted from alighting',()=>{e.transferRules.push({from_stop_id:'aut:b',to_stop_id:'nav:b',transfer_type:'2',min_transfer_time:'900'});assert.equal(plan({walkLinks:links}).length,0);e.transferRules=[];});
test('nearby search includes routes beyond the six closest platforms',()=>{for(let i=0;i<12;i++)e.stops.set('near'+i,{id:'near'+i,name:'Near',lat:45.5+i*.0001,lon:12.2,lines:['same']});e.stops.set('useful',{id:'useful',name:'Useful',lat:45.51,lon:12.2,lines:['express']});assert(R.nearby(e,{lat:45.5,lon:12.2}).some(s=>s.id==='useful'));});
test('tourist score can prefer a slightly slower direct journey',()=>{
 const direct={arrival:now+31*60,walkSeconds:120,legs:[{departure:now+60,arrival:now+31*60}]};
 const fragile={arrival:now+28*60,walkSeconds:120,legs:[{departure:now+60,arrival:now+8*60},{departure:now+9*60,arrival:now+18*60},{departure:now+19*60,arrival:now+28*60}]};
 assert(R.journeyScore(direct)<R.journeyScore(fragile));
});
test('station-adjacent boarding beats a modest time saving that requires a longer initial walk',()=>{
 const station={arrival:now+30*60,walkSeconds:180,walk:{seconds:180},originBaseline:180,legs:[{departure:now+5*60,arrival:now+30*60}]};
 const remote={arrival:now+23*60,walkSeconds:420,walk:{seconds:420},originBaseline:180,legs:[{departure:now+8*60,arrival:now+23*60}]};
 assert(R.journeyScore(station)<R.journeyScore(remote));
 const materiallyFaster={...remote,arrival:now+18*60,legs:[{departure:now+8*60,arrival:now+18*60}]};
 assert(R.journeyScore(materiallyFaster)<R.journeyScore(station));
});
test('naturally remote origins do not receive the station-detour fixed penalty',()=>{
 const remoteOrigin={arrival:now+35*60,walkSeconds:480,walk:{seconds:480},originBaseline:480,legs:[{departure:now+10*60,arrival:now+35*60}]};
 const sameWithoutBaseline={...remoteOrigin,originBaseline:0};
 assert(R.walkDiscomfortSeconds(remoteOrigin)<R.walkDiscomfortSeconds(sameWithoutBaseline));
});
test('very long destination walk loses to a slightly slower transit continuation',()=>{
 const longWalk={arrival:now+52*60,walkSeconds:1800,walk:{seconds:0},egress:{seconds:1800},originBaseline:0,legs:[{departure:now+5*60,arrival:now+22*60}]};
 const boat={arrival:now+55*60,walkSeconds:480,walk:{seconds:360},egress:{seconds:120},originBaseline:360,legs:[{arrival:now+22*60},{departure:now+30*60,arrival:now+53*60,transfer:{seconds:0}}]};
 assert(R.journeyScore(boat)<R.journeyScore(longWalk));
});
test('tight transfers receive an explicit reliability penalty',()=>{
 const safe={legs:[{arrival:now+600},{departure:now+960,transfer:{seconds:60}}]};
 const tight={legs:[{arrival:now+600},{departure:now+690,transfer:{seconds:60}}]};
 assert.equal(R.transferRiskSeconds(safe),0);assert(R.transferRiskSeconds(tight)>0);
});
test('second transfer is deliberately more expensive than the first',()=>{
 assert.equal(R.changePenaltySeconds(1),600);assert.equal(R.changePenaltySeconds(2),1140);assert(R.changePenaltySeconds(3)>R.changePenaltySeconds(2));
});
test('sibling platforms share a rejection group without sharing exact timings',()=>{
 const a={id:'nav:a1',parent:'nav:A'},a2={id:'nav:a2',parent:'nav:A'},b={id:'nav:b1',parent:'nav:B'};
 assert.equal(R.transferGroupKey(a,b),R.transferGroupKey(a2,b));assert.notEqual(R.edgeKey(a.id,b.id),R.edgeKey(a2.id,b.id));
});
console.log('RESULT: '+count+' multimodal routing cases passed.');
