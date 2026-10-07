const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'js/alerts.js'),'utf8');
const php=fs.readFileSync(path.join(root,'api/service-alerts.php'),'utf8');
const staging=fs.readFileSync(path.join(root,'.github/workflows/deploy-staging.yml'),'utf8');
const production=fs.readFileSync(path.join(root,'.github/workflows/deploy-production.yml'),'utf8');

assert(js.includes("api/service-alerts.php"),'alerts client must use local freshness endpoint');
assert(js.includes("runtime-data/alerts/current.json"),'alerts client must retain static feed fallback');
assert(js.includes('staticFeedUrl'),'static fallback helper missing');
assert(js.includes("cache:'no-store'"),'alerts fetch must bypass browser cache');

assert(php.includes('const UV_ALERT_MAX_AGE = 240'),'runtime freshness window must be four minutes');
assert(php.includes("'/usr/bin/python3'"),'runtime must use fixed local Python path');
assert(php.includes("'/srv/data/web/vhosts/unlockvenice.com/private/uv-transit/build_service_alerts.py'"),'runtime must execute private canonical collector outside htdocs');
assert(php.includes('LOCK_EX | LOCK_NB'),'runtime refresh must use a non-blocking exclusive lock');
assert(php.includes('uv_alert_valid_file'),'runtime refresh must validate generated JSON');
assert(php.includes("header('Cache-Control: no-store"),'runtime response must disable caching');
assert(php.includes('rename($tmp, $current)'),'runtime refresh must atomically publish generated feed');
assert(!php.includes('$_GET')&&!php.includes('$_POST'),'runtime collector command must not accept user-controlled arguments');

for(const [name,wf] of [['staging',staging],['production',production]]){
  assert(wf.includes('cp server/build_service_alerts.py dist/_private/build_service_alerts.py'),name+' must package canonical alert collector privately');
  assert(wf.includes('/lamp0/web/vhosts/unlockvenice.com/private/uv-transit/build_service_alerts.py'),name+' must deploy collector outside public web root');
}

console.log('RESULT: alert runtime freshness contracts passed.');
