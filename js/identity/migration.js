/* U.Venice 9.0 M9 — idempotent migration from legacy local keys.
   Legacy keys are deliberately retained and mirrored for rollback compatibility. */
(function(g){'use strict';

const SCHEMA_VERSION=1;
function freeze(x){return Object.freeze(x)}
function create(options={}){
  const stores=options.stores||g.UVIdentityStores?.defaults?.();
  const clock=typeof options.clock==='function'?options.clock:()=>Date.now();
  if(!stores)throw new Error('Identity stores unavailable');
  const profile=[
    ['favorites',stores.favorites],
    ['places',stores.savedPlaces],
    ['journeys',stores.savedJourneys],
    ['preferences',stores.preferences],
    ['navigationPreferences',stores.navigationPreferences]
  ];
  function run(){
    const previous=stores.migration.load(null);
    const results=profile.map(([name,store])=>freeze({name,...store.migrate()}));
    const record=freeze({
      schemaVersion:SCHEMA_VERSION,
      completedAt:Number(clock()),
      legacyRetained:true,
      results:freeze(results)
    });
    stores.migration.save(record);
    return freeze({previous,record});
  }
  return freeze({run});
}
let singleton=null;
function instance(){return singleton||(singleton=create())}

g.UVIdentityMigration=freeze({SCHEMA_VERSION,create,instance,run:()=>instance().run()});
})(typeof window!=='undefined'?window:globalThis);
