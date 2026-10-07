/* Unlock Venice Transit — data freshness monitor
   No network requests. It evaluates the timestamp already present in GTFS-RT. */
(function(global){
  'use strict';

  const DEFAULTS = Object.freeze({
    warnAfterSec: 30,
    offlineAfterSec: 60
  });

  function evaluate(feedTimestamp, opts){
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const ts = Number(feedTimestamp || 0);

    if (!Number.isFinite(ts) || ts <= 0) {
      return { state:'unknown', ageSec:null, label:'in attesa del feed' };
    }

    const ageSec = Math.max(0, Date.now()/1000 - ts);

    if (ageSec >= cfg.offlineAfterSec) {
      return {
        state:'offline',
        ageSec,
        label:`realtime fermo da ${Math.round(ageSec)}s`
      };
    }

    if (ageSec >= cfg.warnAfterSec) {
      return {
        state:'stale',
        ageSec,
        label:`dati vecchi di ${Math.round(ageSec)}s`
      };
    }

    return {
      state:'fresh',
      ageSec,
      label:`dati aggiornati ${Math.round(ageSec)}s fa`
    };
  }

  global.UVTransitHealth = Object.freeze({
    DEFAULTS,
    evaluate
  });
})(window);
