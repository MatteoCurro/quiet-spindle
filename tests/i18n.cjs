const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const langs=['it','en','fr','de'];
const catalogs=Object.fromEntries(langs.map(lang=>[
  lang,
  JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'),'utf8'))
]));

const baseKeys=Object.keys(catalogs.it).sort();
assert(baseKeys.length>=400,'Italian source catalog unexpectedly small');

function placeholders(value){
  return [...String(value).matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)].map(m=>m[1]).sort();
}

for(const lang of langs){
  const keys=Object.keys(catalogs[lang]).sort();
  assert.deepStrictEqual(keys,baseKeys,lang+' locale keys differ from Italian source catalog');
  for(const key of baseKeys){
    assert.strictEqual(typeof catalogs[lang][key],'string',lang+': '+key+' must be a string');
    assert(catalogs[lang][key].trim().length>0,lang+': '+key+' is empty');
    assert.deepStrictEqual(
      placeholders(catalogs[lang][key]),
      placeholders(catalogs.it[key]),
      lang+': '+key+' placeholder mismatch'
    );
  }
}

const runtime=fs.readFileSync(path.join(root,'js','i18n.js'),'utf8');
new vm.Script(runtime,{filename:'js/i18n.js'});

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
assert(html.includes('id="languageSelect"'),'language selector missing');
assert(html.includes('js/i18n.js?v='+version),'i18n runtime not versioned in index');
assert(html.indexOf('js/i18n.js?v='+version)<html.indexOf('js/config.js?v='+version),'i18n must load before app modules');
assert(html.includes('data-i18n="common.language"'),'language selector label must use an explicit i18n key');

for(const required of [
  'journey.find','alerts.title','profile.title','driver.offRoute','driverMap.ready',
  'location.denied','water.unavailable','storage.saveError','nav.trips',
  'app.dataActvUpdated','app.lastUpdateSeconds','journey.timesReady',
  'lines.busSelected','lines.searchAll','lines.selectedAriaAll','nearby.metaMultiple','water.selectedMany'
]){
  assert(baseKeys.includes(required),'critical i18n key missing: '+required);
}

for(const key of ["lines.selectedCount","lines.remove","lines.line","lines.selectedSummary","lines.busCount"]){
  for(const lang of langs){
    assert(!/(?<!\\{)\\{[a-zA-Z0-9_.-]+\\}(?!\\})/.test(catalogs[lang][key]),lang+': '+key+' uses unsupported single-brace placeholder');
  }
}

for(const lang of ['en','fr','de']){
  const changed=baseKeys.filter(key=>catalogs[lang][key]!==catalogs.it[key]).length;
  assert(changed/baseKeys.length>0.85,lang+' catalog contains too many untranslated source values');
}

console.log('i18n: '+baseKeys.length+' keys × '+langs.length+' locales, placeholder parity OK');
