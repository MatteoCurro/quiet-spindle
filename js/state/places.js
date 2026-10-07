/* Local places repository. Replace this boundary with authenticated storage later. */
(function(g){'use strict';
const KEY='unlockVeniceTransitPlaces.v1';
function clean(row){const p=row?.point;if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180||!row.name?.trim())return null;return {id:String(row.id||''),name:row.name.trim().slice(0,60),point:{name:String(p.name||row.name).slice(0,300),lat:p.lat,lon:p.lon,place:true},role:['origin','destination','both'].includes(row.role)?row.role:'both'};}
function store(){try{return g.UVIdentityStores?.defaults?.().savedPlaces||null}catch(_){return null}}
function load(){try{const s=store();const list=s?s.load([]):JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(list)?list.map(clean).filter(Boolean).slice(0,40):[];}catch(_){return [];}}
function write(rows){try{const s=store();if(s)s.save(rows);else localStorage.setItem(KEY,JSON.stringify(rows));}catch(_){throw Error('Salvataggio non riuscito. Controlla lo spazio del dispositivo.');}g.dispatchEvent?.(new CustomEvent('uv:saved-places'));}
function save(row){const item=clean(row);if(!item)throw Error('Scegli un luogo e assegnagli un nome.');const current=load(),exists=!!item.id&&current.some(r=>r.id===item.id);if(!exists&&g.UVAccountSaveGate)g.UVAccountSaveGate.requireAccount('place');if(!item.id)item.id='place-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);const rows=current.filter(r=>r.id!==item.id);if(rows.length>=40)throw Error('Puoi conservare fino a 40 luoghi.');write([item,...rows]);return item;}
function remove(id){write(load().filter(r=>r.id!==id));}
g.UVTransitSavedPlaces=Object.freeze({load,save,remove,KEY});
})(window);
