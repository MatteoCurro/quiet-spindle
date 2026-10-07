/* Unlock Venice Transit — favorites store
   Pure local state. No DOM, Leaflet or network dependencies. */
(function(global){
  'use strict';

  const KEY='unlockVeniceTransitFavorites.v1';
  const DEFAULTS=Object.freeze({routes:[],stops:[]});

  function normalize(value){
    const src=value && typeof value==='object' ? value : {};
    return {
      routes:[...new Set(Array.isArray(src.routes)?src.routes.map(String).filter(Boolean):[])],
      stops:[...new Set(Array.isArray(src.stops)?src.stops.map(String).filter(Boolean):[])]
    };
  }

  function store(){ try{return global.UVIdentityStores?.defaults?.().favorites||null}catch(_){return null} }

  function load(){
    try{
      const s=store();
      if(s)return normalize(s.load(DEFAULTS));
      const raw=localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : normalize(DEFAULTS);
    }catch(_){
      return normalize(DEFAULTS);
    }
  }

  function save(value){
    const clean=normalize(value);
    const previous=load();
    const adds=clean.routes.some(x=>!previous.routes.includes(x))||clean.stops.some(x=>!previous.stops.includes(x));
    if(adds&&global.UVAccountSaveGate&&!global.UVAccountSaveGate.request('favorite'))return previous;
    let stored=true;
    try{
      const s=store();
      if(s)s.save(clean);
      else localStorage.setItem(KEY,JSON.stringify(clean));
    }catch(_){stored=false}
    if(stored){
      try{ global.dispatchEvent(new CustomEvent('uv:favorites',{detail:clean})); }catch(_){}
    }
    return clean;
  }

  function hasRoute(route){ return load().routes.includes(String(route)); }
  function hasStop(stopId){ return load().stops.includes(String(stopId)); }

  function toggleRoute(route){
    const id=String(route||'');
    if(!id) return load();
    const state=load();
    if(state.routes.includes(id)){
      state.routes=state.routes.filter(x=>x!==id);
      return save(state);
    }
    if(global.UVAccountSaveGate&&!global.UVAccountSaveGate.request('route'))return state;
    state.routes=[...state.routes,id];
    return save(state);
  }

  function toggleStop(stopId){
    const id=String(stopId||'');
    if(!id) return load();
    const state=load();
    if(state.stops.includes(id)){
      state.stops=state.stops.filter(x=>x!==id);
      return save(state);
    }
    if(global.UVAccountSaveGate&&!global.UVAccountSaveGate.request('stop'))return state;
    state.stops=[...state.stops,id];
    return save(state);
  }

  function clear(){ return save(DEFAULTS); }

  global.UVTransitFavorites=Object.freeze({
    KEY,DEFAULTS,load,save,hasRoute,hasStop,toggleRoute,toggleStop,clear
  });
})(window);
