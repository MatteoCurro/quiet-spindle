/* U.Venice Transport — on-demand mobility source catalog.
   Registers taxi / water-taxi / NCC services without pretending they expose
   timetable or GTFS realtime data. */
(function(global){
  'use strict';

  const C=global.UVTransitCapabilities;
  if(!C)return;
  const registry=global.UVTransitSourceRegistry||C.createRegistry();
  const register=source=>registry.get(source.id)||registry.register(source);

  const landTaxi=register(C.createSourceAdapter({
    id:'taxi:venice-land',
    providerId:'radiotaxi-venezia',
    network:'venice-land',
    mode:'taxi',
    kind:'catalog',
    label:'Radiotaxi Venezia',
    capabilities:['on_demand','booking','fare_info','airport_connection'],
    delegate:{},
    metadata:{
      official:true,
      website:'https://www.radiotaxivenezia.com/',
      bookingUrl:'https://shop.radiotaxivenezia.com/',
      phone:'+39 041 5964',
      airportCodes:['VCE'],
      serviceAreas:['Venezia Mestre','Venezia Piazzale Roma','Aeroporto Marco Polo'],
      realtimePublic:false,
      structuredPublicFeed:null,
      dataSemantics:'Authorized on-demand road taxi service; booking/fare catalog only.'
    }
  }));

  const waterTaxi=register(C.createSourceAdapter({
    id:'water-taxi:venice',
    providerId:'consorzio-motoscafi-venezia',
    network:'venice-lagoon',
    mode:'water_taxi',
    kind:'catalog',
    label:'Consorzio Motoscafi Venezia',
    capabilities:['on_demand','booking','fare_info','airport_connection'],
    delegate:{},
    metadata:{
      official:true,
      website:'https://www.motoscafivenezia.com/',
      bookingUrl:'https://www.motoscafivenezia.com/',
      phone:'+39 041 5222303',
      airportCodes:['VCE'],
      serviceAreas:['Laguna di Venezia','Aeroporto Marco Polo'],
      realtimePublic:false,
      structuredPublicFeed:null,
      dataSemantics:'Private water taxi/NCC service; booking/fare catalog only.'
    }
  }));

  const airportNcc=register(C.createSourceAdapter({
    id:'ncc:venice-airport',
    providerId:'venice-airport-ncc',
    network:'venice-airport',
    mode:'ncc',
    kind:'catalog',
    label:'NCC Aeroporto Venezia',
    capabilities:['on_demand','booking','fare_info','airport_connection'],
    delegate:{},
    metadata:{
      officialDirectory:true,
      directoryUrl:'https://www.veneziaairport.it/it_it/trasporti',
      airportCodes:['VCE'],
      realtimePublic:false,
      structuredPublicFeed:null,
      dataSemantics:'Airport-authorized chauffeur/private-transfer directory; no single structured fleet feed.'
    }
  }));

  global.UVTransitSourceRegistry=registry;
  global.UVTransitOnDemandSources=Object.freeze({landTaxi,waterTaxi,airportNcc});
})(window);
