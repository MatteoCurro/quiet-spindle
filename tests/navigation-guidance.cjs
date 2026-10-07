const assert=require('assert');
globalThis.window=globalThis;
globalThis.UVTransitI18n={
  t(key,vars={},fallback=''){
    const dict={
      'navigation.guidance.turnLeft':'Turn left',
      'navigation.guidance.turnLeft.street':'Turn left onto {{street}}',
      'navigation.guidance.turnRight':'Turn right',
      'navigation.guidance.turnRight.street':'Turn right onto {{street}}',
      'navigation.guidance.bridge':'Cross the bridge',
      'navigation.guidance.bridge.street':'Cross {{street}}',
      'navigation.guidance.then':'{{first}}, then immediately {{second}}',
      'navigation.guidance.squareHint':'Across the square, keep the indicated direction.'
    };
    let out=dict[key]||fallback||key;
    for(const [k,v] of Object.entries(vars))out=out.replaceAll('{{'+k+'}}',String(v));
    return out;
  }
};
for(const p of ['../js/navigation/route-progress.js','../js/navigation/guidance.js']){
  delete require.cache[require.resolve(p)];require(p);
}
const G=globalThis.UVNavigationGuidance;
const model=globalThis.UVNavigationProgress.prepare([
  {lat:45,lon:12},{lat:45.0001,lon:12},{lat:45.0001,lon:12.0001},{lat:45.0002,lon:12.0001}
]);
const ms=[
 {type:'turn_right',beginShapeIndex:1,streetName:'Calle A',providerText:'',providerVerbalText:'',metadata:{derived:true}},
 {type:'turn_left',beginShapeIndex:2,streetName:'Campo B',providerText:'',providerVerbalText:'',metadata:{derived:true}}
];
const groups=G.group(ms,model,{microDistanceM:20});
assert.equal(groups.length,1,'micro turns should be grouped');
assert.equal(groups[0].then.type,'turn_left');
const nav=G.next(groups,model,0);
assert(nav.text.includes('Turn right onto Calle A'));
assert(nav.text.includes('then immediately'));
assert(nav.text.includes('Across the square'));

const bridge=G.enrich({type:'continue',streetName:'Ponte della Costituzione',providerText:'Cross the bridge',metadata:{}});
assert.equal(bridge.type,'bridge');
const bridgeText=G.render(bridge,{preferProvider:false});
assert.equal(bridgeText.text,'Cross Ponte della Costituzione');

const provider=G.render({type:'turn_left',streetName:'X',providerText:'Provider localized narrative',providerVerbalText:'Provider voice',metadata:{}});
assert.equal(provider.provider,true);
assert.equal(provider.text,'Provider localized narrative');
assert.equal(G.render({type:'turn_left',streetName:'X',providerText:'Provider localized narrative',providerVerbalText:'Provider voice',metadata:{}},{voice:true}).voiceText,'Provider voice');
console.log('navigation-guidance tests passed');
