/* U.Venice 9.0 M9 — product analytics event model.
   Defines a privacy-safe contract only; it does not send data anywhere. */
(function(g){'use strict';

const EVENTS=Object.freeze([
  'app_open','entity_search','entity_selected','journey_search','journey_result_opened','journey_started',
  'poi_opened','stop_opened','route_selected','route_unselected','route_saved','place_saved',
  'deep_link_opened','seo_landing_opened','seo_to_journey','editorial_link_opened','stay_cta_clicked',
  'airport_route_requested','external_booking_clicked','account_prompt_shown','account_created',
  'navigation_started','navigation_leg_started','navigation_maneuver','navigation_offroute_uncertain',
  'navigation_rerouted','navigation_transit_board','navigation_transit_alight','navigation_gps_degraded',
  'navigation_voice_enabled','navigation_completed','navigation_abandoned'
]);
const ALLOWED=new Set([
  'language','entity_id','provider','network','ref','campaign','device_class','identity_state',
  'route_id','place_id','mode','source','reason','maneuver_type','gps_quality','duration_bucket',
  'distance_bucket','confidence_bucket','leg_type','motion_mode','result_type','position_bucket'
]);
const FORBIDDEN=/^(lat|lon|lng|latitude|longitude|coord|coordinates|position|positions|gps|trace|track|polyline|shape|query|raw_query|email|guest_id|user_id)$/i;
function freeze(x){return Object.freeze(x)}
function scalar(v){return v===null||['string','number','boolean'].includes(typeof v)}
function sanitize(properties={}){
  const out={};
  for(const [key,value] of Object.entries(properties||{})){
    const normalized=String(key).replace(/[A-Z]/g,m=>'_'+m.toLowerCase());
    if(FORBIDDEN.test(normalized)||!ALLOWED.has(normalized)||!scalar(value))continue;
    out[normalized]=value;
  }
  return freeze(out);
}
function event(name,properties={}){
  if(!EVENTS.includes(name))throw new TypeError('Unknown product analytics event: '+name);
  return freeze({schemaVersion:1,name,properties:sanitize(properties)});
}
function identityState(){
  return g.UVGuestIdentity?.current?.()?.state||'anonymous';
}
function createEmitter(options={}){
  const sink=typeof options.sink==='function'?options.sink:()=>{};
  const consent=options.consentStore||g.UVConsent?.instance?.()||null;
  const requireConsent=options.requireConsent!==false;
  return freeze({
    emit(name,properties={}){
      const payload=event(name,{identityState:properties.identityState||identityState(),...properties});
      const allowed=!requireConsent||consent?.allows?.('analytics')===true;
      if(allowed)sink(payload);
      return freeze({payload,delivered:allowed});
    }
  });
}

g.UVProductAnalytics=freeze({EVENTS,ALLOWED,sanitize,event,identityState,createEmitter});
})(typeof window!=='undefined'?window:globalThis);
