/* Unlock Venice Transit — startup self-tests.
   Tiny local tests: zero network requests. */
(function(global){
  'use strict';

  function run(){
    const errors=[];

    if(!global.UVTransitGTFS){
      errors.push('GTFS utilities non disponibili');
    }else{
      const sample='a,b\n1,2\n3,4\n';
      const rows=global.UVTransitGTFS.parseCSV(sample);
      if(rows.length!==2 || rows[0].a!=='1' || rows[1].b!=='4'){
        errors.push('Parser CSV GTFS non valido');
      }
    }

    const cfg=global.UVTransitConfig && global.UVTransitConfig.map;
    if(!cfg || !cfg.apiKey || !String(cfg.apiKey).trim()){
      errors.push('CARTO API key assente');
    }

    if(!global.UVTransitMap || !global.UVTransitMap.getTileUrl){
      errors.push('Map view non disponibile');
    }else{
      const effective=String(global.UVTransitMap.getTileUrl()||'');
      const matches=effective.match(/[?&]key=([^&]+)/g) || [];
      if(matches.length!==1){
        errors.push('URL CARTO effettivo deve contenere una sola API key');
      }
      if(!effective.includes('/rastertiles/voyager/')){
        errors.push('URL CARTO Voyager inatteso');
      }
    }

    for(const name of [
      'UVTransitRoutesLayer',
      'UVTransitStopsLayer',
      'UVTransitVehiclesLayer',
      'UVTransitControls',
      'UVTransitNearbyPanel'
    ]){
      if(!global[name]) errors.push(name+' non disponibile');
    }

    if(!global.UVTransitPrediction?.acceptProgressFix) errors.push('Prediction acceptProgressFix non disponibile');
    if(!global.UVTransitPrediction?.reanchorVehicle) errors.push('Prediction reanchorVehicle non disponibile');
    if(!global.UVTransitRedesign?.syncViewport) errors.push('Viewport manager non disponibile');
    if(!document.getElementById('viewportWarning')) errors.push('Viewport warning non disponibile');
    if(!document.getElementById('copyDiagnosticsBtn')) errors.push('Diagnostica copiabile non disponibile');

    if(errors.length){
      console.error('[UV Transit self-test]', errors);
      return {ok:false,errors};
    }

    console.info('[UV Transit self-test] OK');
    return {ok:true,errors:[]};
  }

  global.UVTransitSelfTest=Object.freeze({run});
})(window);
