const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const journey=fs.readFileSync(path.join(root,'js/journey/ui.js'),'utf8');
const controller=fs.readFileSync(path.join(root,'js/navigation/controller.js'),'utf8');
const navMap=fs.readFileSync(path.join(root,'js/navigation/navigation-map.js'),'utf8');
const driver=fs.readFileSync(path.join(root,'js/driver/map.js'),'utf8');
const style=fs.readFileSync(path.join(root,'js/navigation/map-style.js'),'utf8');
const provider=fs.readFileSync(path.join(root,'js/navigation/navigation-provider.js'),'utf8');
const navigationConfig=JSON.parse(fs.readFileSync(path.join(root,'data/navigation.json'),'utf8'));
const configRuntime=fs.readFileSync(path.join(root,'js/navigation/config.js'),'utf8');
const nginx=fs.readFileSync(path.join(root,'server/valhalla/nginx-cors.conf'),'utf8');
const compose=fs.readFileSync(path.join(root,'server/valhalla/docker-compose.yml'),'utf8');

assert(index.includes('assets/navigation-9.0.css?v='));
assert(index.includes('js/navigation/controller.js?v='));
assert(index.indexOf('js/walk/local.js')<index.indexOf('js/navigation/controller.js'),'local walking fallback must load before navigation controller');
assert(index.indexOf('js/navigation/maplibre-runtime.js')<index.indexOf('js/navigation/navigation-map.js'),'MapLibre runtime must load before navigation map');
assert(journey.includes("g.UVTransitNavigation?.enabled?.()"),'navigation CTA must remain feature-gated');
assert(journey.includes("r.walkOnly?g.UVTransitNavigation.startFromJourney"),'walk-only journeys must still use T1 walking controller');
assert(journey.includes("g.UVTransitJourneyNavigation?.start?."),'multimodal journeys must use T3 controller');
assert(controller.includes("get('navdev')==='1'"),'T1 must remain hidden without navdev=1');
assert(controller.includes('UVNavigationProvider.createDefault'),'controller must use provider abstraction');
assert(controller.includes('highAccuracy:true'),'navigation GPS must request high accuracy');
assert(controller.includes('UVNavigationProgress.project'),'controller must map progress onto route');
assert(controller.includes("UVNavigationManeuverFallback.derive"),'local fallback must still produce simplified maneuvers');
assert(navMap.includes('UVNavigationBasemap.resolve'),'navigation map must choose basemap through provider');
assert(navMap.includes('UVNavigationMapStyle.create'),'local navigation map must use shared style');
assert(navMap.includes('e?.originalEvent'),'automatic camera rotations must not enter free-look');
assert(navMap.includes('ResizeObserver'),'navigation map must react to mobile viewport changes');
assert(navMap.includes('instance.resize()'),'navigation map must explicitly resize after opening');
assert(navMap.includes('openFreeMap()'),'local PMTiles failure must fall back to OpenFreeMap');
assert(navMap.includes('diagnostics'),'navigation map must expose staging diagnostics');
assert(driver.includes('UVNavigationMapStyle.create'),'Driver Utility must share navigation style');
assert(style.includes("routeSourceId||'navigation-route'"),'shared style must support separate route source IDs');
assert(provider.includes('createDefault')&&provider.includes('createFallback'),'routing must expose remote + local fallback factory');
assert(!provider.includes('.php'),'navigation provider must not depend on PHP');
assert(!controller.includes('.php'),'navigation controller must not depend on PHP');
assert(configRuntime.includes("data/navigation.json"),'navigation config must be static JSON');
const mapRuntime=fs.readFileSync(path.join(root,'js/navigation/maplibre-runtime.js'),'utf8');
assert(mapRuntime.includes('await loadCss()'),'MapLibre CSS must be awaited before renderer init');
assert.equal(navigationConfig.remoteEnabled,false,'remote routing must default to disabled until controlled endpoint exists');
assert.equal(navigationConfig.localFallback,true);
assert(nginx.includes('Access-Control-Allow-Origin')&&nginx.includes('proxy_pass http://127.0.0.1:8002/route'),'Valhalla edge must be direct CORS reverse proxy');
assert(!fs.existsSync(path.join(root,'api/navigation-route.php')),'M8 must not add PHP route jobs');
assert(!fs.existsSync(path.join(root,'api/navigation-health.php')),'M8 must not add PHP health jobs');
assert(compose.includes('ghcr.io/valhalla/valhalla-scripted:3.8.3'));
assert(compose.includes('nord-est-latest.osm.pbf'));

for(const lang of ['it','en','fr','de']){
  const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'),'utf8'));
  for(const key of ['navigation.start','navigation.title','navigation.exit','navigation.recenter','navigation.preparing','navigation.waitingGps','navigation.turnLeft','navigation.turnRight','navigation.arrive','navigation.degraded']){
    assert(locale[key],lang+' missing '+key);
  }
}
console.log('navigation-t1 contracts passed');
