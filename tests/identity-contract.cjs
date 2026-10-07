const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const analytics=fs.readFileSync(path.join(root,'js/analytics/event-model.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'js/identity/migration.js'),'utf8');

for(const file of ['storage.js','stores.js','guest.js','consent.js','migration.js']){
  assert(index.includes('js/identity/'+file+'?v='),'index missing '+file);
}
assert(index.includes('js/analytics/event-model.js?v='));
assert(index.indexOf('js/identity/storage.js')<index.indexOf('js/state/preferences.js'),'identity boundary must load before legacy state modules');
assert(index.indexOf('js/identity/migration.js')<index.indexOf('UVIdentityMigration.run()'),'migration module must load before bootstrap');
assert(index.includes('UVGuestIdentity.getOrCreate()'),'guest identity must bootstrap locally');
for(const file of ['storage.js','stores.js','guest.js','consent.js','migration.js']){
  const source=fs.readFileSync(path.join(root,'js/identity',file),'utf8');
  assert(!source.includes('fetch('),file+' identity foundation module must stay client-only');
  assert(!source.includes('XMLHttpRequest'),file+' identity foundation must not use XHR');
  assert(!source.includes('document.cookie'),file+' identity foundation must not create cookies');
  assert(!source.includes('.php'),file+' identity foundation must not use PHP');
}
assert(!analytics.includes('fetch('),'event model must not transmit analytics');
assert(!analytics.includes('XMLHttpRequest'),'event model must not use XHR');
assert(!analytics.includes('document.cookie'),'event model must not create cookies');
assert(analytics.includes('guest_id')&&analytics.includes('user_id'),'analytics must explicitly forbid raw identity identifiers');
console.log('identity-contract tests passed');
