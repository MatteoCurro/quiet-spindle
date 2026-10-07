/* Unlock Venice Transit — runtime configuration
   Production: paste your CARTO Basemaps key below and restrict it by Referer
   to unlockvenice.com / www.unlockvenice.com in the CARTO dashboard. */
(function(global){
  'use strict';
  global.UVTransitConfig = Object.freeze({
    map: Object.freeze({
      provider: 'carto',
      apiKey: 'cb1_3k48_1_14c1be39f0b2d6473cd81768',
      tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    })
  });
})(window);
