const assert=require('assert');
for(const p of ['../js/navigation/maneuvers.js','../js/navigation/route-progress.js','../js/navigation/maneuver-fallback.js']){
  delete require.cache[require.resolve(p)];require(p);
}
const P=globalThis.UVNavigationProgress;
const model=P.prepare([
  {lat:45.0000,lon:12.0000},
  {lat:45.0010,lon:12.0000},
  {lat:45.0010,lon:12.0010}
]);
assert(model.totalM>180&&model.totalM<220);
const hit=P.project(model,{lat:45.0005,lon:12.0001});
assert(hit&&hit.progressM>40&&hit.progressM<80);
assert(hit.distanceM<15);
assert(P.pointAt(model,0).lat===45);
assert(P.progressAtIndex(model,1)>100);
const split=P.splitGeoJSON(model,model.totalM/2);
assert(split.features.some(x=>x.properties.part==='past'));
assert(split.features.some(x=>x.properties.part==='future'));

const D=globalThis.UVNavigationManeuverFallback;
const ms=D.derive(model.points);
assert.equal(ms[0].type,'start');
assert(ms.some(x=>x.type==='turn_right'));
assert.equal(ms.at(-1).type,'arrive');
console.log('navigation-progress tests passed');
