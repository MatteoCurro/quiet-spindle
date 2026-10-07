/* U.Venice Transport — airport/tourism provider registrations.
   Registers honest capability profiles: ACTV airport routes reuse ACTV realtime,
   Alilaguna uses its official GTFS schedule, ATVO remains catalog-only until a
   stable public structured feed (GTFS/NeTEx/SIRI) is available. */
(function(global){
  'use strict';

  const C=global.UVTransitCapabilities;
  if(!C)return;
  const registry=global.UVTransitSourceRegistry||C.createRegistry();
  const register=source=>registry.get(source.id)||registry.register(source);
  const actv=global.UVTransitProvider;

  if(actv&&global.UVTransitACTVSources?.aut){
    register(C.createSourceAdapter({
      id:'actv:airport-vce',
      providerId:'actv-official',
      network:'aut',
      mode:'airport_bus',
      kind:'profile',
      label:'ACTV aeroporto Marco Polo',
      capabilities:['airport_connection'],
      delegate:{},
      metadata:{
        official:true,
        airportCodes:['VCE'],
        parentSourceId:'actv:aut',
        routeShortNames:['5','15'],
        destinations:['Venezia Piazzale Roma','Venezia Mestre FS'],
        dataSemantics:'Profile of ACTV realtime road source; route scope is metadata, not a separate feed.'
      }
    }));
  }

  let alilaguna=null;
  if(actv){
    const runtimeDelegate={
      loadRuntimeManifest:actv.loadRuntimeManifest,
      loadRuntimeCore:actv.loadRuntimeCore,
      loadRuntimeShapes:actv.loadRuntimeShapes,
      loadRuntimeSchedule:actv.loadRuntimeSchedule
    };
    const scheduleDelegate=global.UVTransitScheduledProvider?.createScheduledProvider({
      providerId:'alilaguna',network:'ali',runtimeDelegate
    })||runtimeDelegate;
    alilaguna=register(C.createSourceAdapter({
      id:'alilaguna:water',
      providerId:'alilaguna',
      network:'ali',
      mode:'water',
      kind:'source',
      label:'Alilaguna',
      capabilities:['static_schedule','canonical_state','scheduled_simulation','airport_connection','ticketing'],
      delegate:scheduleDelegate,
      metadata:{
        official:true,
        airportCodes:['VCE'],
        staticGtfsOfficial:'http://www.alilaguna.it/attuale/alilaguna.zip',
        website:'https://www.alilaguna.it/',
        realtimePublic:false,
        dataSemantics:'Official GTFS schedule; no public realtime vessel positions verified.'
      }
    }));
  }

  const atvo=register(C.createSourceAdapter({
    id:'atvo:airport',
    providerId:'atvo',
    network:'atvo',
    mode:'airport_bus',
    kind:'catalog',
    label:'ATVO Airport Bus',
    capabilities:['external_timetable','airport_connection','ticketing'],
    delegate:{},
    metadata:{
      official:true,
      airportCodes:['VCE','TSF'],
      website:'https://www.atvo.it/',
      timetableUrl:'https://www.atvo.it/servizi-erogati/servizi-aereoportuali/venice-airport-bus-express',
      trevisoTimetableUrl:'https://www.atvo.it/servizi-erogati/servizi-aereoportuali/treviso-airport-bus-express',
      ticketingUrl:'https://webticketing.atvo.it/',
      structuredPublicFeed:null,
      candidateNapCheckedResource:'https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/180673/checkedResource',
      candidateNapStatus:'community-reference-not-independently-confirmed',
      napStaticIntegration:'officially-documented',
      realtimePublic:false,
      dynamicStandard:'SIRI',
      dataSemantics:'Regional MaaS documentation confirms ATVO planning data enters the Veneto platform and NAP integration was scheduled/implemented through NeTEx/SIRI. Asset 180673 is retained only as an unverified candidate pointer; it is not auto-ingested.'
    }
  }));

  global.UVTransitSourceRegistry=registry;
  global.UVTransitTourismSources=Object.freeze({
    actvAirport:registry.get('actv:airport-vce'),
    alilaguna,
    atvo
  });

  if(alilaguna&&global.UVTransitReadAPI){
    global.UVTransitSourceReads=Object.freeze({
      ...(global.UVTransitSourceReads||{}),
      'alilaguna:water':global.UVTransitReadAPI.create({source:alilaguna})
    });
  }

  global.UVTransitAirportProfiles=Object.freeze({
    VCE:Object.freeze({
      id:'airport:VCE',
      sourceIds:Object.freeze(['actv:airport-vce','atvo:airport','alilaguna:water']),
      actvRoutes:Object.freeze(['5','15'])
    }),
    TSF:Object.freeze({
      id:'airport:TSF',
      sourceIds:Object.freeze(['atvo:airport'])
    })
  });
})(window);
