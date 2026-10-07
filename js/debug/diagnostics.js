/* Unlock Venice Transit — diagnostics map layer
   Owns raw GPS markers and prediction-error lines. */
(function(global){
  'use strict';

  function create(options){
    const map=options && options.map;
    const rawFixIcon=options && options.rawFixIcon;
    if(!map) throw new Error('UVTransitDiagnostics: map richiesta');
    if(typeof rawFixIcon!=='function') throw new Error('UVTransitDiagnostics: rawFixIcon richiesta');

    const rawMarkers=new Map();
    const errorLines=new Map();

    function remove(id){
      const m=rawMarkers.get(id);
      if(m){ if(map.hasLayer(m)) map.removeLayer(m); rawMarkers.delete(id); }
      const l=errorLines.get(id);
      if(l){ if(map.hasLayer(l)) map.removeLayer(l); errorLines.delete(id); }
    }

    function update(vehicle,enabled){
      if(!vehicle) return;
      if(!enabled){ remove(vehicle.id); return; }
      if(!vehicle.raw || !Number.isFinite(vehicle.raw.lat) || !Number.isFinite(vehicle.raw.lon)) return;

      let m=rawMarkers.get(vehicle.id);
      if(!m){
        m=L.marker([vehicle.raw.lat,vehicle.raw.lon],{
          icon:rawFixIcon(),interactive:false,zIndexOffset:900
        }).addTo(map);
        rawMarkers.set(vehicle.id,m);
      }else{
        m.setLatLng([vehicle.raw.lat,vehicle.raw.lon]);
      }

      if(!Number.isFinite(vehicle.displayLat) || !Number.isFinite(vehicle.displayLon)) return;
      const pts=[[vehicle.raw.lat,vehicle.raw.lon],[vehicle.displayLat,vehicle.displayLon]];
      let l=errorLines.get(vehicle.id);
      if(!l){
        l=L.polyline(pts,{
          color:'#111',weight:1,opacity:.45,dashArray:'3 4',interactive:false
        }).addTo(map);
        errorLines.set(vehicle.id,l);
      }else{
        l.setLatLngs(pts);
      }
    }

    function clear(){
      for(const id of [...new Set([...rawMarkers.keys(),...errorLines.keys()])]) remove(id);
    }

    function getCounts(){
      return {rawMarkers:rawMarkers.size,errorLines:errorLines.size};
    }

    return Object.freeze({update,remove,clear,getCounts});
  }

  async function transitStateSmoke(network='aut'){
    if(!global.UVTransitRead?.diagnostics?.transitState)
      throw new Error('UVTransitDiagnostics: TransitState read API non disponibile');
    const result=await global.UVTransitRead.diagnostics.transitState(network);
    const snapshot=result?.snapshot;
    if(!snapshot)throw new Error('UVTransitDiagnostics: snapshot TransitState non disponibile');
    const metrics=result?.metrics||null;
    const quality=result?.quality||null;
    const active=snapshot.tripStates.filter(row=>row.active).slice(0,40).map(row=>Object.freeze({
      tripInstanceId:row.tripInstanceId,
      routeId:row.routeId,
      status:row.status,
      motionMode:row.motionMode,
      motionSource:row.motion?.position?.source||null,
      motionConfidence:row.motion?.position?.confidence??null,
      motionObservedAt:row.motion?.position?.observedAt??null,
      delaySource:row.delay?.source||null,
      delayValue:row.delay?.value??null,
      delayConfidence:row.delay?.confidence??null,
      freshestObservedAt:row.freshestObservedAt
    }));
    return Object.freeze({
      network,
      generatedAt:snapshot.generatedAt,
      summary:Object.freeze(snapshot.summary()),
      coverage:metrics?Object.freeze(metrics.summary()):null,
      sourceQuality:quality?Object.freeze(quality.summary()):null,
      active:Object.freeze(active),
      checks:Object.freeze({
        noCoordinates:true,
        validModes:active.every(row=>['live','predicted_live','scheduled_simulation','unavailable',null].includes(row.motionMode)),
        provenancePresent:active.every(row=>!row.motionMode||row.motionSource!==null),
        coverageAccounting:!metrics||(
          metrics.counts.expected>=metrics.counts.observed+
            metrics.counts.predictedLive+
            metrics.counts.awaiting+
            metrics.counts.missing
        ),
        qualityDimensioned:!quality||(
          !!quality.dimensions?.freshness&&
          !!quality.dimensions?.validity&&
          !!quality.dimensions?.coverage&&
          !!quality.dimensions?.resolution
        )
      })
    });
  }

  async function transitMetricsSmoke(network='aut'){
    if(!global.UVTransitRead?.diagnostics?.transitMetrics)
      throw new Error('UVTransitDiagnostics: TransitMetrics read API non disponibile');
    const metrics=await global.UVTransitRead.diagnostics.transitMetrics(network);
    if(!metrics)throw new Error('UVTransitDiagnostics: TransitCoverageMetrics non disponibili');
    return Object.freeze({
      network,
      generatedAt:metrics.generatedAt,
      summary:Object.freeze(metrics.summary()),
      routes:Object.freeze(metrics.byRoute.slice(0,40).map(row=>Object.freeze({
        routeId:row.routeId,
        expected:row.counts.expected,
        observed:row.counts.observed,
        predictedLive:row.counts.predictedLive,
        missing:row.counts.missing,
        likelyMissing:row.counts.likelyMissing,
        awaiting:row.counts.awaiting,
        liveEvidenceCoveragePct:row.rates.liveEvidenceCoveragePct
      }))),
      checks:Object.freeze({
        noCoordinates:true,
        expectedEqualsBuckets:
          metrics.counts.expected===
          metrics.counts.observed+metrics.counts.predictedLive+
          metrics.counts.awaiting+metrics.counts.missing+metrics.counts.otherActive,
        missingSplit:
          metrics.counts.missing===
          metrics.counts.expectedUnobserved+metrics.counts.likelyMissing
      })
    });
  }

  async function sourceQualitySmoke(network='aut'){
    if(!global.UVTransitRead?.diagnostics?.sourceQuality)
      throw new Error('UVTransitDiagnostics: SourceQuality read API non disponibile');
    const quality=await global.UVTransitRead.diagnostics.sourceQuality(network);
    if(!quality)throw new Error('UVTransitDiagnostics: SourceQuality snapshot non disponibile');
    const d=quality.dimensions;
    return Object.freeze({
      network,
      generatedAt:quality.generatedAt,
      summary:Object.freeze(quality.summary()),
      dimensions:Object.freeze({
        freshness:Object.freeze({
          band:d.freshness.band,
          ageSec:d.freshness.ageSec,
          newestObservedAt:d.freshness.newestObservedAt
        }),
        validity:Object.freeze({
          band:d.validity.band,
          ok:d.validity.ok,
          checks:Object.freeze({...d.validity.checks})
        }),
        coverage:Object.freeze({
          band:d.coverage.band,
          valuePct:d.coverage.valuePct,
          expected:d.coverage.expected,
          missing:d.coverage.missing
        }),
        resolution:Object.freeze({
          band:d.resolution.band,
          valuePct:d.resolution.valuePct,
          observations:d.resolution.observations,
          resolutions:d.resolution.resolutions,
          matchedResolutions:d.resolution.matchedResolutions
        })
      }),
      checks:Object.freeze({
        noCoordinates:true,
        noSyntheticScore:!Object.prototype.hasOwnProperty.call(quality.summary(),'score'),
        dimensionBands:['freshness','validity','coverage','resolution'].every(key=>
          ['healthy','degraded','poor','unavailable'].includes(d[key].band)
        )
      })
    });
  }

  async function derivedEventSmoke(network='aut'){
    if(!global.UVTransitRead?.diagnostics?.derivedEvents)
      throw new Error('UVTransitDiagnostics: DerivedEvent read API non disponibile');
    const official=global.UVTransitAlerts?.current?.()?.alerts||[];
    const result=await global.UVTransitRead.diagnostics.derivedEvents(network,{officialAlerts:official});
    const events=result?.events;
    if(!events)throw new Error('UVTransitDiagnostics: DerivedEvent snapshot non disponibile');
    const active=events.active.slice(0,60).map(event=>Object.freeze({
      id:event.id,
      type:event.type,
      severity:event.severity,
      confidence:event.confidence,
      sourceKind:event.sourceKind,
      userVisible:event.userVisible,
      firstSeenAt:event.firstSeenAt,
      lastSeenAt:event.lastSeenAt,
      routeIds:Object.freeze([...(event.scope?.routeIds||[])]),
      tripCount:event.scope?.tripInstanceIds?.length||0,
      officialOverlap:event.officialOverlap?.matched||false,
      officialAlertIds:Object.freeze([...(event.officialOverlap?.alertIds||[])])
    }));
    return Object.freeze({
      network,
      generatedAt:events.generatedAt,
      summary:Object.freeze(events.summary()),
      active:Object.freeze(active),
      checks:Object.freeze({
        noCoordinates:true,
        allDerived:active.every(event=>event.sourceKind==='derived'),
        diagnosticOnly:active.every(event=>event.userVisible===false),
        officialSeparation:active.every(event=>event.sourceKind!=='official')
      })
    });
  }

  global.UVTransitDiagnostics=Object.freeze({create,transitStateSmoke,transitMetricsSmoke,sourceQualitySmoke,derivedEventSmoke});
})(window);
