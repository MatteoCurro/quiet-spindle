/* U.Venice Transport — ATVO scheduled-source bootstrap.
   Fail-closed: catalog metadata is always available from provider-tourism; the
   structured source is registered only when runtime manifest actually contains
   an ATVO network built from a provisioned NeTEx/GTFS source. */
(function(global){
  'use strict';

  const C=global.UVTransitCapabilities;
  const base=global.UVTransitProvider;
  if(!C||!base)return;

  const registry=global.UVTransitSourceRegistry||C.createRegistry();

  async function bootstrap(){
    if(!global.UVTransitScheduledProvider||!global.UVTransitReadAPI)return null;
    let manifest;
    try{manifest=await base.loadRuntimeManifest()}catch(_e){return null}
    if(!manifest?.networks?.atvo?.core?.file)return null;

    const runtimeDelegate={
      loadRuntimeManifest:base.loadRuntimeManifest,
      loadRuntimeCore:base.loadRuntimeCore,
      loadRuntimeShapes:base.loadRuntimeShapes,
      loadRuntimeSchedule:base.loadRuntimeSchedule
    };
    const delegate=global.UVTransitScheduledProvider.createScheduledProvider({
      providerId:'atvo',
      network:'atvo',
      runtimeDelegate
    });
    const source=C.createSourceAdapter({
      id:'atvo:schedule',
      providerId:'atvo',
      network:'atvo',
      mode:'bus',
      kind:'source',
      label:'ATVO',
      capabilities:['static_schedule','canonical_state','scheduled_simulation','airport_connection','ticketing'],
      delegate,
      metadata:{
        official:true,
        operator:'ATVO S.p.A.',
        parentCatalogId:'atvo:airport',
        airportCodes:['VCE','TSF'],
        realtimePublic:false,
        dynamicStandard:'SIRI',
        dataSemantics:'Structured ATVO planning source activated only from a built runtime network. Canonical state is schedule-only.'
      }
    });
    if(!registry.get(source.id))registry.register(source);
    global.UVTransitSourceRegistry=registry;
    global.UVTransitSourceReads=Object.freeze({
      ...(global.UVTransitSourceReads||{}),
      'atvo:schedule':global.UVTransitReadAPI.create({source:registry.get(source.id)})
    });
    return registry.get(source.id);
  }

  global.UVTransitATVO=Object.freeze({bootstrap,bootstrapPromise:bootstrap()});
})(window);
