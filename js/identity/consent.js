/* U.Venice 9.0 M9 — versioned consent records. */
(function(g){'use strict';

const SCHEMA_VERSION=1;
const TYPES=Object.freeze(['account_service','analytics','marketing','profiling']);
const STATUSES=Object.freeze(['unset','granted','denied']);
function freeze(x){return Object.freeze(x)}
function cleanRecord(type,row){
  if(!TYPES.includes(type))throw new TypeError('Unknown consent type: '+type);
  const status=STATUSES.includes(row?.status)?row.status:'unset';
  return freeze({
    type,status,
    timestamp:Number.isFinite(Number(row?.timestamp))?Number(row.timestamp):null,
    policy_version:String(row?.policy_version||''),
    source:String(row?.source||'')
  });
}
function create(options={}){
  const store=options.store||g.UVIdentityStores?.defaults?.().consent;
  const clock=typeof options.clock==='function'?options.clock:()=>Date.now();
  if(!store)throw new Error('ConsentStore unavailable');
  function load(){
    const raw=store.load({schemaVersion:SCHEMA_VERSION,records:{}});
    const records={};
    for(const type of TYPES)records[type]=cleanRecord(type,raw?.records?.[type]);
    return freeze({schemaVersion:SCHEMA_VERSION,records:freeze(records)});
  }
  function get(type){return load().records[type]||cleanRecord(type,null)}
  function set(type,status,meta={}){
    if(!TYPES.includes(type))throw new TypeError('Unknown consent type: '+type);
    if(!['granted','denied'].includes(status))throw new TypeError('Consent status must be granted or denied');
    const state=load();
    const record=cleanRecord(type,{
      status,timestamp:Number(clock()),
      policy_version:meta.policyVersion||meta.policy_version||'',
      source:meta.source||'app'
    });
    const next={schemaVersion:SCHEMA_VERSION,records:{...state.records,[type]:record}};
    store.save(next);return record;
  }
  function unset(type,meta={}){
    if(!TYPES.includes(type))throw new TypeError('Unknown consent type: '+type);
    const state=load();
    const record=cleanRecord(type,{
      status:'unset',timestamp:Number(clock()),
      policy_version:meta.policyVersion||meta.policy_version||'',
      source:meta.source||'app'
    });
    store.save({schemaVersion:SCHEMA_VERSION,records:{...state.records,[type]:record}});
    return record;
  }
  function allows(type){return get(type).status==='granted'}
  return freeze({load,get,set,unset,allows});
}
let singleton=null;
function instance(){return singleton||(singleton=create())}

g.UVConsent=freeze({SCHEMA_VERSION,TYPES,STATUSES,create,instance});
})(typeof window!=='undefined'?window:globalThis);
