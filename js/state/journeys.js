/* 8.9: saved searches, not stale departure snapshots. Independent of existing favorites. */
(function(g){'use strict';
const KEY='unlockVeniceTransitJourneys.v1',MAX=30;
function place(p){if(!p||typeof p.name!=='string')return null;const lat=Number(p.lat),lon=Number(p.lon);if(p.place){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;return {name:p.name.slice(0,300),place:true,lat,lon};}const ids=[...new Set((p.ids||[p.id]).filter(v=>v!==undefined&&v!==null).map(String))].slice(0,50);return ids.length?{name:p.name.slice(0,300),id:ids[0],ids,lat,lon,network:p.network,members:Array.isArray(p.members)?p.members.filter(s=>ids.includes(s.id)&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({id:s.id,lat:s.lat,lon:s.lon})):[]}:null;}
function clean(v){if(!v||!['aut','nav','all'].includes(v.network))return null;const origin=place(v.origin),destination=place(v.destination);if(!origin||!destination)return null;return {id:String(v.id||''),network:v.network,origin,destination,savedAt:Number(v.savedAt)||Date.now()};}
function key(v){const point=p=>p.place?[p.lat.toFixed(5),p.lon.toFixed(5)].join(','):(p.ids||[p.id]).slice().sort().join(',');return v.network+'|'+point(v.origin)+'|'+point(v.destination);}
function store(){try{return g.UVIdentityStores?.defaults?.().savedJourneys||null}catch(_){return null}}
function load(){try{const s=store();const a=s?s.load([]):JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a.map(clean).filter(Boolean).slice(0,MAX):[];}catch(_){return [];}}
function write(a){try{const s=store();if(s)s.save(a);else localStorage.setItem(KEY,JSON.stringify(a));}catch(_){throw Error('Impossibile salvare su questo dispositivo. Controlla lo spazio o le impostazioni del browser.');}g.dispatchEvent?.(new CustomEvent('uv:saved-journeys'));return a;}
function save(v){const c=clean(v);if(!c)throw Error('Scegli partenza e destinazione prima di salvare.');if(c.origin.place&&c.origin.name==='La mia posizione')c.origin.name='Posizione salvata';c.id=key(c);const current=load(),exists=current.some(x=>key(x)===c.id);if(!exists&&g.UVAccountSaveGate)g.UVAccountSaveGate.requireAccount('journey');return write([c,...current.filter(x=>key(x)!==c.id)].slice(0,MAX)),c;}
function remove(id){return write(load().filter(x=>x.id!==id));}
g.UVTransitSavedJourneys=Object.freeze({load,save,remove,KEY});
})(window);
