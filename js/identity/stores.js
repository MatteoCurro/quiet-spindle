/* U.Venice 9.0 M9 — identity/profile storage boundaries. */
(function(g){'use strict';

function freeze(x){return Object.freeze(x)}
const KEYS=freeze({
  guest:'uv.identity.guest.v1',
  consent:'uv.identity.consent.v1',
  migration:'uv.identity.migration.v1',
  favorites:'uv.profile.favorites.v1',
  places:'uv.profile.places.v1',
  journeys:'uv.profile.journeys.v1',
  preferences:'uv.profile.preferences.v1',
  navigationPreferences:'uv.profile.navigation.v1'
});
const LEGACY=freeze({
  favorites:freeze(['unlockVeniceTransitFavorites.v1']),
  places:freeze(['unlockVeniceTransitPlaces.v1']),
  journeys:freeze(['unlockVeniceTransitJourneys.v1']),
  preferences:freeze(['unlockVeniceTransitPrefs.v1']),
  navigationPreferences:freeze(['uv-navigation-preferences-v1'])
});
function create(options={}){
  const adapter=options.adapter||g.UVIdentityStorage?.createLocal?.();
  if(!adapter)throw new Error('Identity storage adapter unavailable');
  const profile=name=>g.UVIdentityStorage.createMirror(adapter,{key:KEYS[name],legacyKeys:LEGACY[name]||[]});
  const exact=key=>freeze({
    key,
    load:fallback=>adapter.read(key,fallback),
    save:value=>adapter.write(key,value),
    clear:()=>adapter.remove(key),
    exists:()=>adapter.has(key)
  });
  const identity=exact(KEYS.guest);
  const consent=exact(KEYS.consent);
  const migration=exact(KEYS.migration);
  const favorites=profile('favorites');
  const savedPlaces=profile('places');
  const savedJourneys=profile('journeys');
  const preferences=profile('preferences');
  const navigationPreferences=profile('navigationPreferences');
  const favoriteState=()=>favorites.load({routes:[],stops:[]})||{routes:[],stops:[]};
  const savedRoutes=freeze({
    load:()=>Array.isArray(favoriteState().routes)?favoriteState().routes.slice():[],
    save:routes=>{const state=favoriteState();favorites.save({...state,routes:Array.isArray(routes)?routes.slice():[]});return Array.isArray(routes)?routes.slice():[]},
    clear:()=>{const state=favoriteState();favorites.save({...state,routes:[]})}
  });
  const savedStops=freeze({
    load:()=>Array.isArray(favoriteState().stops)?favoriteState().stops.slice():[],
    save:stops=>{const state=favoriteState();favorites.save({...state,stops:Array.isArray(stops)?stops.slice():[]});return Array.isArray(stops)?stops.slice():[]},
    clear:()=>{const state=favoriteState();favorites.save({...state,stops:[]})}
  });
  return freeze({
    adapter,
    identity,consent,migration,favorites,savedPlaces,savedJourneys,preferences,navigationPreferences,
    savedRoutes,savedStops,
    IdentityStore:identity,
    SavedPlacesStore:savedPlaces,
    SavedRoutesStore:savedRoutes,
    SavedStopsStore:savedStops,
    SavedJourneysStore:savedJourneys,
    PreferencesStore:preferences,
    NavigationPreferencesStore:navigationPreferences,
    ConsentStore:consent
  });
}
let defaultStores=null;
function defaults(){
  if(defaultStores)return defaultStores;
  defaultStores=create();return defaultStores;
}

g.UVIdentityStores=freeze({KEYS,LEGACY,create,defaults});
})(typeof window!=='undefined'?window:globalThis);
