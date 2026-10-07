const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {parseHTML}=require('linkedom');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const runtime=fs.readFileSync(path.join(root,'js','i18n.js'),'utf8');
const notifications=fs.readFileSync(path.join(root,'js','notifications.js'),'utf8');
const uiShell=fs.readFileSync(path.join(root,'js','ui','ui-shell.js'),'utf8');
const dom=parseHTML(html);
const document=dom.window.document;

Object.defineProperty(document,'baseURI',{value:'https://example.test/app/',configurable:true});
Object.defineProperty(document,'readyState',{value:'complete',configurable:true});
Object.defineProperty(dom.window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value||this.querySelector('option')?.getAttribute('value')||''},set(value){this._value=String(value)}});

const storage=new Map(),warnings=[],eventHandlers=new Map();
const sandbox={
  document,
  console:{log(){},info(){},warn(...args){warnings.push(args)},error(){}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
  history:{state:null,replaceState(){}},
  location:{search:'?lang=en',href:'https://example.test/app/?lang=en'},
  navigator:{languages:['en-US'],language:'en-US'},
  URL,
  URLSearchParams,
  Element:dom.window.Element,
  NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4},
  CustomEvent:dom.window.CustomEvent,
  Event:dom.window.Event,
  MutationObserver:class{constructor(cb){this.cb=cb}observe(){}disconnect(){}},
  addEventListener(type,fn){if(!eventHandlers.has(type))eventHandlers.set(type,new Set());eventHandlers.get(type).add(fn);},
  dispatchEvent(event){for(const fn of eventHandlers.get(event.type)||[])fn(event);return true;},
  fetch:async input=>{
    const url=String(input);
    const match=url.match(/\/locales\/([a-z]{2})\.json(?:\?|$)/);
    if(!match)return {ok:false,status:404,json:async()=>({})};
    const data=JSON.parse(fs.readFileSync(path.join(root,'locales',match[1]+'.json'),'utf8'));
    return {ok:true,status:200,json:async()=>data};
  },
  setTimeout,
  clearTimeout
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;

const context=vm.createContext(sandbox);
vm.runInContext(runtime,context,{filename:'js/i18n.js'});

(async()=>{
  await sandbox.__UV_I18N_READY__;
  assert.equal(document.documentElement.lang,'en',warnings.map(args=>args.map(x=>x&&x.stack?x.stack:String(x)).join(' ')).join('\n'));
  assert.equal(document.querySelector('h1').textContent,'From here, Venice.');
  assert.equal(document.getElementById('languageSelect').value,'en');
  assert(document.title.startsWith('Real-time transport'));
  assert.equal(sandbox.UVTransitI18n.translateSource('Dati ACTV aggiornati'),'ACTV data up to date');
  assert.equal(sandbox.UVTransitI18n.translateSource('Ultimo aggiornamento circa 12 secondi fa.'),'Last update about 12 seconds ago.');
  assert.equal(sandbox.UVTransitI18n.translateSource('Orari pronti · 123 fermate.'),'Timetables ready · 123 stops.');
  assert.equal(sandbox.UVTransitI18n.translateSource('Bus: 3 selezionati'),'Bus: 3 selected');
  assert.equal(sandbox.UVTransitI18n.translateSource('240 m in linea d’aria · Più paline vicine'),'240 m as the crow flies · Multiple nearby stops');
  assert.equal(sandbox.UVTransitI18n.translateSource('2 linee selezionate · massimo 8.'),'2 lines selected · maximum 8.');
  assert.equal(sandbox.UVTransitI18n.translateSource('Percorsi'),'Routes');

  vm.runInContext(notifications,context,{filename:'js/notifications.js'});
  vm.runInContext(uiShell,context,{filename:'js/ui/ui-shell.js'});
  sandbox.UVTransitUI.initNotificationUI();
  sandbox.UVTransitNotifications.setService({level:'success',title:'Dati ACTV aggiornati',message:'Ultimo aggiornamento circa 3 secondi fa.',visible:true});
  assert.equal(document.getElementById('liveStatus').textContent,'ACTV data up to date · Last update about 3 seconds ago.');

  await sandbox.UVTransitI18n.setLocale('de',{persist:false,updateUrl:false});
  assert.equal(document.documentElement.lang,'de');
  assert.equal(document.querySelector('h1').textContent,'Von hier nach Venedig.');
  assert.equal(document.getElementById('languageSelect').value,'de');

  const dynamic=document.createElement('div');
  dynamic.textContent='Posizione non disponibile. Riprova.';
  document.body.appendChild(dynamic);
  sandbox.UVTransitI18n.apply(dynamic);
  assert.equal(dynamic.textContent,'Position nicht verfügbar. Erneut versuchen.');

  await sandbox.UVTransitI18n.setLocale('fr',{persist:false,updateUrl:false});
  assert.equal(document.documentElement.lang,'fr');
  assert.equal(document.querySelector('h1').textContent,'D’ici, Venise.');
  assert.equal(document.getElementById('languageSelect').value,'fr');
  assert.equal(sandbox.UVTransitI18n.translateSource('Percorsi'),'Itinéraires');
  assert.equal(document.getElementById('liveStatus').textContent,'Données ACTV à jour · Dernière mise à jour il y a environ 3 secondes.');

  process.stdout.write('i18n runtime: URL locale, live switch and dynamic translation OK\n');
})().catch(error=>{process.stderr.write((error&&error.stack)||String(error));process.exitCode=1});
