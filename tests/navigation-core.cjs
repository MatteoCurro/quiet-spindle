const assert=require('assert');
for(const p of ['../js/navigation/maneuvers.js','../js/navigation/location-provider.js','../js/navigation/navigation-session.js','../js/navigation/route-cache.js','../js/navigation/analytics.js']){
  delete require.cache[require.resolve(p)];require(p);
}

const M=globalThis.UVNavigationManeuvers;
assert.equal(M.fromValhallaType(1),'start');
assert.equal(M.fromValhallaType(15),'turn_left');
assert.equal(M.fromValhallaType(10),'turn_right');
assert.equal(M.fromValhallaType(40),'stairs');
assert.equal(M.fromValhalla({providerType:15,distanceMeters:42,streetNames:['Calle Test'],instruction:'Svolta'}).streetName,'Calle Test');

const L=globalThis.UVLocationProvider;
let watcher=null,cleared=null;
const geo={
 watchPosition(ok,err,opts){watcher={ok,err,opts};return 77},
 clearWatch(id){cleared=id}
};
const fixes=[],errors=[];
const sub=L.createWeb({geolocation:geo}).subscribe({onFix:x=>fixes.push(x),onError:x=>errors.push(x)});
assert.equal(watcher.opts.enableHighAccuracy,true);
watcher.ok({coords:{latitude:45.44,longitude:12.33,accuracy:8,heading:90,speed:1.2},timestamp:1234});
assert.equal(fixes[0].lat,45.44);assert.equal(fixes[0].accuracyM,8);
sub.stop();assert.equal(cleared,77);

const S=globalThis.UVNavigationSession;
let now=1000;const s=S.create({clock:()=>now++});
assert.equal(s.snapshot().state,'IDLE');
let snap=s.start({id:'x',legs:[{mode:'walk'},{mode:'transit'},{mode:'walk'}]});
assert.equal(snap.state,'PREPARING');
assert.equal(s.dispatch({type:'READY'}).state,'WALKING');
assert.equal(s.dispatch({type:'ADVANCE_LEG'}).state,'WAITING_TRANSIT');
assert.equal(s.dispatch({type:'BOARDING'}).state,'BOARDING');
assert.equal(s.dispatch({type:'BOARD'}).state,'RIDING');
assert.equal(s.dispatch({type:'ALIGHT'}).state,'ALIGHTING');
assert.equal(s.dispatch({type:'ADVANCE_LEG'}).state,'WALKING');
assert.equal(s.dispatch({type:'REROUTE_START'}).state,'REROUTING');
assert.equal(s.dispatch({type:'REROUTE_OK'}).state,'WALKING');
assert.equal(s.dispatch({type:'PAUSE'}).state,'PAUSED');
assert.equal(s.dispatch({type:'RESUME'}).state,'WALKING');
assert.equal(s.dispatch({type:'ADVANCE_LEG'}).state,'ARRIVED');
assert.equal(s.snapshot().terminal,true);

const m=S.create({clock:(()=>{let n=0;return()=>++n})()});
m.start({legs:[{mode:'transit'},{mode:'transit'}]});
assert.equal(m.dispatch({type:'WALK'}).state,'WALKING','explicit guided walk must represent access/egress walking');
assert.equal(m.dispatch({type:'WAIT_TRANSIT'}).state,'WAITING_TRANSIT','explicit wait transition must restore transit waiting without changing leg');
assert.equal(m.snapshot().legIndex,0);
console.log('explicit guided walk/wait transitions passed');

const C=globalThis.UVNavigationRouteCache;
let cacheNow=1000;const cache=C.create({maxEntries:2,ttlMs:1000,clock:()=>cacheNow});
cache.set('a',{id:1});assert.equal(cache.get('a').id,1);
cache.set('b',{id:2});cache.set('c',{id:3});
assert.equal(cache.get('a'),null);assert.equal(cache.summary().persistent,false);
cacheNow=2201;assert.equal(cache.get('c'),null);

const A=globalThis.UVNavigationAnalytics;
const safe=A.event('navigation_started',{language:'it',provider:'valhalla',lat:45.44,lon:12.33,coordinates:[12,45],reason:'user'});
assert.equal(safe.properties.language,'it');
assert.equal(safe.properties.provider,'valhalla');
assert.equal('lat' in safe.properties,false);
assert.equal('coordinates' in safe.properties,false);
console.log('navigation-core tests passed');
