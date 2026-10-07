const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const controller=fs.readFileSync(path.join(root,'js/navigation/journey-controller.js'),'utf8');
const assist=fs.readFileSync(path.join(root,'js/navigation/transit-assist.js'),'utf8');
const plan=fs.readFileSync(path.join(root,'js/navigation/journey-plan.js'),'utf8');
const provider=fs.readFileSync(path.join(root,'js/provider-actv.js'),'utf8');
const readApi=fs.readFileSync(path.join(root,'js/core/transit-read-api.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const journey=fs.readFileSync(path.join(root,'js/journey/ui.js'),'utf8');

assert(index.includes('js/navigation/journey-plan.js?v='));
assert(index.includes('js/navigation/transit-assist.js?v='));
assert(index.includes('js/navigation/journey-controller.js?v='));
assert(index.indexOf('js/navigation/transit-assist.js')<index.indexOf('js/navigation/journey-controller.js'));
assert(index.indexOf('js/navigation/journey-controller.js')<index.indexOf('js/journey/ui.js'));
assert(journey.includes('UVTransitJourneyNavigation?.start?.'),'multimodal CTA must call T3 controller');
assert(controller.includes("get('navdev')==='1'"),'T3 remains feature-gated');
assert(controller.includes('journey.cachedState'),'T3 must read only cached canonical state');
assert(controller.includes("'uv:transit-cache'"),'T3 must react to existing realtime cache events');
assert(!controller.includes('setInterval('),'T3 must not add a realtime polling timer');
assert(!controller.includes('actv-realtime.php'),'T3 must not call ACTV PHP proxy directly');
assert(!controller.includes('.journey.state('),'T3 must not trigger canonical-state realtime fetches');
assert(provider.includes('peekTransitState')&&provider.includes('peekRawRealtimePair'));
assert(readApi.includes('cachedTransitState')&&readApi.includes('cachedState:cachedTransitState'));
assert(assist.includes('matchTripState')&&assist.includes('prepareAlight'));
assert(plan.includes("type:'walk'")&&plan.includes("type:'transit'"));

for(const lang of ['it','en','fr','de']){
  const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'),'utf8'));
  for(const key of [
    'navigation.walkToStop','navigation.waitLine','navigation.imOnBoard',
    'navigation.prepareAlight','navigation.imOffBoard','navigation.connectionMissed',
    'navigation.scheduledFallback'
  ])assert(locale[key],lang+' missing '+key);
}
console.log('navigation-t3 contracts passed');
