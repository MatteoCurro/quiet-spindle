/* Optional profile answers. No inference, tracking or network I/O. */
(function(g){'use strict';
const choices={language:['it','en','fr','de'],local_relation:['resident','commuter','visitor','planning'],stay_interest:['looking','booked','not_now'],travel_period:['soon','later','unsure']};
function normalize(raw={}){
 const out={};
 const displayName=typeof raw.display_name==='string'?raw.display_name.trim().replace(/\s+/g,' ').slice(0,80):'';
 out.display_name=displayName||null;
 for(const [key,values] of Object.entries(choices))out[key]=values.includes(raw[key])?raw[key]:null;
 out.country=typeof raw.country==='string'&&/^[A-Z]{2}$/.test(raw.country)?raw.country:null;
 out.is_driver=typeof raw.is_driver==='boolean'?raw.is_driver:null;
 return out;
}
function consent(raw={},version){
 if(typeof version!=='string'||!version.trim())throw new Error('ACCOUNT_NOTICE_REQUIRED');
 return {marketing_email:raw.marketing_email===true,profiling:raw.profiling===true,notice_version:version};
}
function mayTarget(preferences){return preferences?.marketing_email===true&&preferences?.profiling===true}
g.UVAccountOnboarding=Object.freeze({normalize,consent,mayTarget,choices});
})(typeof window!=='undefined'?window:globalThis);
