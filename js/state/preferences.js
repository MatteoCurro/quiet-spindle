/* Unlock Venice Transit — persistent client preferences
   Storage-only module. It has no knowledge of DOM, Leaflet or GTFS. */
(function(global){
  'use strict';

  const KEY='unlockVeniceTransitPrefs.v1';
  const MAX_BUSES=8;
  const DEFAULTS=Object.freeze({
    tramFilter:'ALL',
    buses:[],
    busColors:{},
    layers:{
      routes:true,
      stops:true,
      next:true,
      user:true,
      prediction:true,
      gps:false
    },
    debug:false
  });

  function clone(x){ return JSON.parse(JSON.stringify(x)); }

  function normalize(input){
    const p=input||{};
    return {
      tramFilter:['ALL','T1','T2','OFF'].includes(p.tramFilter) ? p.tramFilter : DEFAULTS.tramFilter,
      buses:Array.isArray(p.buses) ? p.buses.slice(0,MAX_BUSES).map(String) : [],
      busColors:(p.busColors && typeof p.busColors==='object') ? {...p.busColors} : {},
      layers:{...DEFAULTS.layers,...(p.layers||{})},
      debug:!!p.debug
    };
  }

  function store(){ try{return global.UVIdentityStores?.defaults?.().preferences||null}catch(_){return null} }

  function load(){
    try{
      const s=store();
      if(s)return normalize(s.load(DEFAULTS));
      const raw=localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : clone(DEFAULTS);
    }catch(_){
      return clone(DEFAULTS);
    }
  }

  function save(value){
    const normalized=normalize(value);
    try{
      const s=store();
      if(s)s.save(normalized);
      else localStorage.setItem(KEY,JSON.stringify(normalized));
    }catch(_){}
    return normalized;
  }

  function clear(){
    try{
      const s=store();
      if(s)s.clear();
      else localStorage.removeItem(KEY);
    }catch(_){}
  }

  global.UVTransitPreferences=Object.freeze({KEY,MAX_BUSES,DEFAULTS,load,save,clear,normalize});
})(window);
