const assert=require('node:assert/strict');

global.window=globalThis;
const listeners=new Map();
global.addEventListener=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)};
global.removeEventListener=(name,fn)=>listeners.get(name)?.delete(fn);
global.dispatchEvent=event=>{for(const fn of listeners.get(event.type)||[])fn(event);return true};
global.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};

const mem=new Map();
global.localStorage={
 getItem:k=>mem.has(String(k))?mem.get(String(k)):null,
 setItem:(k,v)=>mem.set(String(k),String(v)),
 removeItem:k=>mem.delete(String(k))
};
global.UVTransitI18n={t:k=>k==='account.saveRequiresAccount'?'ACCOUNT_REQUIRED':k};

require('../js/identity/account-save-gate.js');
require('../js/state/favorites.js');
require('../js/state/places.js');
require('../js/state/journeys.js');

let openRequests=0;
addEventListener('uv:account-open-request',()=>openRequests++);

// Rollout safety: before Account is enabled, current local saving still works.
UVTransitFavorites.toggleRoute('4L');
assert.equal(UVTransitFavorites.hasRoute('4L'),true);

// Once Account is enabled, guest can remove legacy data but cannot create new data.
dispatchEvent(new CustomEvent('uv:account-availability',{detail:{enabled:true}}));
dispatchEvent(new CustomEvent('uv:account-state',{detail:{state:'guest'}}));
UVTransitFavorites.toggleRoute('4L');
assert.equal(UVTransitFavorites.hasRoute('4L'),false);
UVTransitFavorites.toggleRoute('5');
assert.equal(UVTransitFavorites.hasRoute('5'),false);
assert.equal(openRequests,1);

assert.throws(()=>UVTransitSavedPlaces.save({
 name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'both'
}),e=>e?.code==='ACCOUNT_REQUIRED_TO_SAVE');

assert.throws(()=>UVTransitSavedJourneys.save({
 network:'all',
 origin:{name:'Casa',place:true,lat:45.49,lon:12.24},
 destination:{name:'Venezia',place:true,lat:45.44,lon:12.32}
}),e=>e?.code==='ACCOUNT_REQUIRED_TO_SAVE');

// Authenticated users may create saved items (remote-first bridge is a later pre-go-live gate).
dispatchEvent(new CustomEvent('uv:account-state',{detail:{state:'user'}}));
UVTransitFavorites.toggleStop('S1');
assert.equal(UVTransitFavorites.hasStop('S1'),true);
const place=UVTransitSavedPlaces.save({name:'Casa',point:{name:'Casa',lat:45.49,lon:12.24,place:true},role:'both'});
assert(place.id);
const journey=UVTransitSavedJourneys.save({
 network:'all',
 origin:{name:'Casa',place:true,lat:45.49,lon:12.24},
 destination:{name:'Venezia',place:true,lat:45.44,lon:12.32}
});
assert(journey.id);

console.log('account-save-gate: rollout safety, guest create block, legacy removal and user save passed');
