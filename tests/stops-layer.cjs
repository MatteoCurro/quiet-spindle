const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');

const added=[],removed=[];
const map={hasLayer:()=>true,removeLayer:m=>removed.push(m)};
const L={
  divIcon:o=>o,
  marker:(latlng,opts)=>{
    const m={latlng,opts,events:{},addTo(){added.push(this);return this},on(n,fn){this.events[n]=fn;return this},bindTooltip(){return this}};
    return m;
  }
};
const context={window:null,L,Map,Set,console};context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/map/stops-layer.js'),'utf8'),context);
const S=context.UVTransitStopsLayer;
const stops=new Map([
 ['A',{id:'A',name:'Alpha',lat:45,lon:12}],
 ['B',{id:'B',name:'Beta',lat:45.01,lon:12.01}],
 ['C',{id:'C',name:'Gamma',lat:45.02,lon:12.02}]
]);
const routeStopIds=new Map([['1',new Set(['A','B'])],['2',new Set(['C'])]]);
const tripInfo=new Map([['T1',{routeShort:'1'}]]);
const tripUpdates=new Map([['T1',{updates:[{stopId:'A'}]}]]);
let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};
S.render({map,visible:true,tripUpdates,tripInfo,stops,routeStopIds,selectedByFilters:r=>r==='1'});
check('static selected-line stop renders even without realtime update',()=>assert.deepEqual(added.map(x=>x.latlng),[[45,12],[45.01,12.01]]));
check('unselected route stop is not rendered',()=>assert(!added.some(x=>x.latlng[0]===45.02)));
check('realtime stop is additive without duplicating static marker',()=>assert.equal(added.length,2));
S.render({map,visible:true,tripUpdates,tripInfo,stops,routeStopIds,selectedByFilters:r=>r==='1'});
check('stable realtime tick does not recreate static markers',()=>{assert.equal(added.length,2);assert.equal(removed.length,0)});
S.render({map,visible:true,tripUpdates,tripInfo,stops,routeStopIds,selectedByFilters:r=>r==='2'});
check('line filter diff removes old markers and adds only new route stops',()=>{assert.equal(added.length,3);assert.equal(removed.length,2);assert.deepEqual(added.at(-1).latlng,[45.02,12.02])});
console.log(`RESULT: ${n} stops-layer checks passed.`);
