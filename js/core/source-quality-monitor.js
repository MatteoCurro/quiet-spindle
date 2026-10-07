/* U.Venice Transport — provider-neutral Source Quality Monitor.
   Evaluates canonical pipeline health from TransitState + TransitCoverageMetrics.
   It reports dimensions instead of a synthetic score and never mutates live state. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const pct=(n,d)=>d>0?Math.round((n/d)*1000)/10:null;
  const DEFAULTS=freeze({
    freshnessHealthySec:120,
    freshnessDegradedSec:300,
    coverageHealthyPct:70,
    coverageDegradedPct:40,
    resolutionHealthyPct:75,
    resolutionDegradedPct:50
  });
  const BAND_RANK=freeze({healthy:0,idle:0,degraded:1,poor:2,unavailable:-1});

  function bandFor(value,healthyAt,degradedAt){
    if(value===null||value===undefined)return 'unavailable';
    if(value>=healthyAt)return 'healthy';
    if(value>=degradedAt)return 'degraded';
    return 'poor';
  }

  function freshnessBand(ageSec,hasExpected){
    if(ageSec===null)return hasExpected?'poor':'unavailable';
    if(ageSec<=0)return 'healthy';
    return null;
  }

  function newestObservationAt(snapshot){
    let newest=null;
    for(const row of snapshot?.tripStates||[]){
      const at=finite(row?.freshestObservedAt);
      if(at!==null&&(newest===null||at>newest))newest=at;
    }
    for(const row of snapshot?.vehicleStates||[]){
      const at=finite(row?.lastSeenAt)??finite(row?.latestObservedAt);
      if(at!==null&&(newest===null||at>newest))newest=at;
    }
    return newest;
  }

  function freshnessDimension(snapshot,metrics,options){
    const generatedAt=finite(snapshot?.generatedAt);
    const newestAt=newestObservationAt(snapshot);
    const expected=Number(metrics?.counts?.expected||0);
    const ageSec=generatedAt!==null&&newestAt!==null?Math.max(0,generatedAt-newestAt):null;
    let band=freshnessBand(ageSec,expected>0);
    if(band===null){
      band=ageSec<=options.freshnessHealthySec
        ?'healthy'
        :ageSec<=options.freshnessDegradedSec?'degraded':'poor';
    }
    return freeze({
      band,
      newestObservedAt:newestAt,
      ageSec,
      healthyWithinSec:options.freshnessHealthySec,
      degradedWithinSec:options.freshnessDegradedSec,
      reason:newestAt===null&&expected>0?'no_observation_evidence':null
    });
  }

  function validityDimension(snapshot,metrics){
    const input=snapshot?.inputSummary||{};
    const counts=metrics?.counts||{};
    const checks={
      snapshotShape:!!snapshot&&Array.isArray(snapshot.tripStates)&&Array.isArray(snapshot.vehicleStates),
      generatedAt:finite(snapshot?.generatedAt)!==null,
      expectedAccounting:
        Number(counts.expected||0)===
        Number(counts.observed||0)+Number(counts.predictedLive||0)+
        Number(counts.awaiting||0)+Number(counts.missing||0)+Number(counts.otherActive||0),
      missingAccounting:
        Number(counts.missing||0)===
        Number(counts.expectedUnobserved||0)+Number(counts.likelyMissing||0),
      nonNegativeInputs:['observations','resolutions','matchedResolutions','freshMatchedTrips'].every(k=>{
        const v=finite(input[k]);
        return v===null||v>=0;
      }),
      matchedWithinResolutions:
        finite(input.matchedResolutions)===null||finite(input.resolutions)===null||
        Number(input.matchedResolutions)<=Number(input.resolutions)
    };
    const ok=Object.values(checks).every(Boolean);
    return freeze({band:ok?'healthy':'poor',ok,checks:freeze(checks)});
  }

  function coverageDimension(metrics,options){
    const expected=Number(metrics?.counts?.expected||0);
    const assessedExpected=Number(metrics?.rates?.assessedExpected||0);
    const value=finite(metrics?.rates?.assessedCoveragePct);
    const band=assessedExpected===0
      ?(expected===0?'unavailable':'poor')
      :bandFor(value,options.coverageHealthyPct,options.coverageDegradedPct);
    return freeze({
      band,
      expected,
      assessedExpected,
      observed:Number(metrics?.counts?.observed||0),
      predictedLive:Number(metrics?.counts?.predictedLive||0),
      missing:Number(metrics?.counts?.missing||0),
      valuePct:value,
      liveEvidenceCoveragePct:finite(metrics?.rates?.liveEvidenceCoveragePct),
      healthyAtPct:options.coverageHealthyPct,
      degradedAtPct:options.coverageDegradedPct
    });
  }

  function resolutionDimension(snapshot,metrics,options){
    const input=snapshot?.inputSummary||metrics?.input||{};
    const resolutions=Math.max(0,Number(input.resolutions||0));
    const matched=Math.max(0,Number(input.matchedResolutions||0));
    const observations=Math.max(0,Number(input.observations||0));
    const value=pct(Math.min(matched,resolutions),resolutions);
    let band;
    if(resolutions===0){
      band=observations>0?'poor':'unavailable';
    }else{
      band=bandFor(value,options.resolutionHealthyPct,options.resolutionDegradedPct);
    }
    return freeze({
      band,
      observations,resolutions,matchedResolutions:matched,
      valuePct:value,
      healthyAtPct:options.resolutionHealthyPct,
      degradedAtPct:options.resolutionDegradedPct
    });
  }

  function overallBand(dimensions,metrics){
    const expected=Number(metrics?.counts?.expected||0);
    const observations=Number(metrics?.input?.observations||0);
    if(expected===0&&observations===0)return 'idle';
    if(dimensions.validity.band==='poor')return 'poor';
    let worst=0,seen=false;
    for(const key of ['freshness','coverage','resolution']){
      const rank=BAND_RANK[dimensions[key]?.band];
      if(rank>=0){seen=true;worst=Math.max(worst,rank)}
    }
    if(!seen)return 'idle';
    return worst>=2?'poor':worst===1?'degraded':'healthy';
  }

  class SourceQualitySnapshot{
    constructor({provider,network,generatedAt,status,dimensions,reasons}){
      this.provider=provider||null;
      this.network=network||null;
      this.generatedAt=finite(generatedAt);
      this.status=status;
      this.dimensions=freeze({...dimensions});
      this.reasons=freeze([...(reasons||[])]);
      Object.freeze(this);
    }
    summary(){
      return freeze({
        provider:this.provider,
        network:this.network,
        generatedAt:this.generatedAt,
        status:this.status,
        freshness:this.dimensions.freshness.band,
        freshnessAgeSec:this.dimensions.freshness.ageSec,
        validity:this.dimensions.validity.band,
        coverage:this.dimensions.coverage.band,
        coveragePct:this.dimensions.coverage.valuePct,
        resolution:this.dimensions.resolution.band,
        resolutionRatePct:this.dimensions.resolution.valuePct,
        reasons:this.reasons
      });
    }
  }

  function fromState({snapshot,metrics,options}={}){
    if(!snapshot||!metrics)throw new Error('SourceQualityMonitor: snapshot e metrics richiesti');
    const cfg={...DEFAULTS,...(options||{})};
    const dimensions=freeze({
      freshness:freshnessDimension(snapshot,metrics,cfg),
      validity:validityDimension(snapshot,metrics),
      coverage:coverageDimension(metrics,cfg),
      resolution:resolutionDimension(snapshot,metrics,cfg)
    });
    const status=overallBand(dimensions,metrics);
    const reasons=[];
    if(dimensions.freshness.reason)reasons.push(dimensions.freshness.reason);
    if(dimensions.validity.band==='poor')reasons.push('canonical_validity_failed');
    if(dimensions.coverage.band==='poor'&&Number(metrics.counts.expected||0)>0)reasons.push('low_assessed_coverage');
    if(dimensions.resolution.band==='poor')reasons.push('low_resolution_rate');
    return new SourceQualitySnapshot({
      provider:snapshot.provider||metrics.provider||null,
      network:snapshot.network||metrics.network||null,
      generatedAt:snapshot.generatedAt,
      status,dimensions,reasons
    });
  }

  global.UVTransitSourceQuality=freeze({
    DEFAULTS,
    SourceQualitySnapshot,
    fromState,
    _test:freeze({
      bandFor,newestObservationAt,freshnessDimension,validityDimension,
      coverageDimension,resolutionDimension,overallBand
    })
  });
})(window);
