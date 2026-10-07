/* U.Venice 9.0 M10 — versioned local profile snapshot.
   This module never performs network I/O. */
(function(g){'use strict';

const SCHEMA_VERSION=1;
function freeze(x){return Object.freeze(x)}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v))}
function create(options={}){
  const stores=options.stores||g.UVIdentityStores?.defaults?.();
  const clock=typeof options.clock==='function'?options.clock:Date.now;
  if(!stores)throw new Error('Identity stores unavailable');
  function collect(){
    return freeze({
      schemaVersion:SCHEMA_VERSION,
      generatedAt:Number(clock()),
      profile:freeze({
        savedRoutes:clone(stores.savedRoutes.load()),
        savedStops:clone(stores.savedStops.load()),
        savedPlaces:clone(stores.savedPlaces.load([])),
        savedJourneys:clone(stores.savedJourneys.load([])),
        preferences:clone(stores.preferences.load({})),
        navigationPreferences:clone(stores.navigationPreferences.load({}))
      })
    });
  }
  function validate(snapshot){
    return !!snapshot&&snapshot.schemaVersion===SCHEMA_VERSION&&snapshot.profile&&typeof snapshot.profile==='object';
  }
  function apply(snapshot){
    if(!validate(snapshot))throw new TypeError('Invalid profile sync snapshot');
    const p=snapshot.profile;
    if(Array.isArray(p.savedRoutes))stores.savedRoutes.save(clone(p.savedRoutes));
    if(Array.isArray(p.savedStops))stores.savedStops.save(clone(p.savedStops));
    if(Array.isArray(p.savedPlaces))stores.savedPlaces.save(clone(p.savedPlaces));
    if(Array.isArray(p.savedJourneys))stores.savedJourneys.save(clone(p.savedJourneys));
    if(p.preferences&&typeof p.preferences==='object'&&!Array.isArray(p.preferences))stores.preferences.save(clone(p.preferences));
    if(p.navigationPreferences&&typeof p.navigationPreferences==='object'&&!Array.isArray(p.navigationPreferences))stores.navigationPreferences.save(clone(p.navigationPreferences));
    return collect();
  }
  return freeze({collect,validate,apply});
}

g.UVProfileSync=freeze({SCHEMA_VERSION,create});
})(typeof window!=='undefined'?window:globalThis);
