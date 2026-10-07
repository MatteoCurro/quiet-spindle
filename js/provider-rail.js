/* U.Venice Transport — Veneto rail open-data bootstrap.
   The source is activated only when runtime-data manifest contains a provisioned
   rail GTFS network. Until then we expose only an honest catalog descriptor. */
(function(global){
  'use strict';

  const C=global.UVTransitCapabilities;
  if(!C)return;
  const registry=global.UVTransitSourceRegistry||C.createRegistry();
  const register=source=>registry.get(source.id)||registry.register(source);
  const actv=global.UVTransitProvider;

  const catalog=register(C.createSourceAdapter({
    id:'rail:veneto-open-data',
    providerId:'trenitalia-veneto',
    network:'rail',
    mode:'rail',
    kind:'catalog',
    label:'Ferrovia Veneto',
    capabilities:['external_timetable'],
    delegate:{},
    metadata:{
      official:true,
      operator:'Trenitalia',
      region:'Veneto',
      runtimeNetwork:'rail',
      provisioningEnv:'UV_RAIL_NETEX_URL',
      publicRuntimeProvisioned:false,
      napCatalog:'https://nap-1926.it/nap/mmtis/public/static/multimodal',
      dataSemantics:'U.Venice ingests the official Trenitalia NeTEx L1 dataset from the Italian NAP and converts the timetable subset to the existing GTFS/runtime pipeline. Scheduled simulation remains schedule-only; no rail realtime is implied.'
    }
  }));

  async function bootstrap(){
    if(!actv||!global.UVTransitScheduledProvider||!global.UVTransitReadAPI)return null;
    let manifest;
    try{manifest=await actv.loadRuntimeManifest()}catch(_e){return null}
    if(!manifest?.networks?.rail?.core?.file)return null;

    const runtimeDelegate={
      loadRuntimeManifest:actv.loadRuntimeManifest,
      loadRuntimeCore:actv.loadRuntimeCore,
      loadRuntimeShapes:actv.loadRuntimeShapes,
      loadRuntimeSchedule:actv.loadRuntimeSchedule
    };
    const delegate=global.UVTransitScheduledProvider.createScheduledProvider({
      providerId:'trenitalia-veneto',
      network:'rail',
      runtimeDelegate
    });
    const source=register(C.createSourceAdapter({
      id:'rail:veneto',
      providerId:'trenitalia-veneto',
      network:'rail',
      mode:'rail',
      kind:'source',
      label:'Ferrovia Veneto',
      capabilities:['static_schedule','canonical_state','scheduled_simulation','external_timetable'],
      delegate,
      metadata:{
        official:true,
        operator:'Trenitalia',
        region:'Veneto',
        parentCatalogId:'rail:veneto-open-data',
        runtimeNetwork:'rail',
        publicRuntimeProvisioned:true,
        realtimePublic:false,
        dataSemantics:'Open-data schedule source. Canonical state is schedule-only unless a separate verified realtime rail source is added later.'
      }
    }));
    global.UVTransitSourceRegistry=registry;
    global.UVTransitSourceReads=Object.freeze({
      ...(global.UVTransitSourceReads||{}),
      'rail:veneto':global.UVTransitReadAPI.create({source})
    });
    return source;
  }

  global.UVTransitSourceRegistry=registry;
  global.UVTransitRail=Object.freeze({
    catalog,
    bootstrap,
    bootstrapPromise:bootstrap()
  });
})(window);
