/* U.Venice Transport — provider-neutral expected/observed/missing metrics.
   Pure consumer of immutable TransitState snapshots. It never mutates core state
   and keeps strict observation coverage separate from projected-live evidence. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=(n,d)=>d>0?Math.round((n/d)*1000)/10:null;

  const PRIMARY_STATUSES=freeze([
    'observed','predicted_live','awaiting_observation',
    'expected_unobserved','likely_missing','cancelled'
  ]);

  function emptyCounts(){
    return {
      expected:0,
      observed:0,
      predictedLive:0,
      awaiting:0,
      expectedUnobserved:0,
      likelyMissing:0,
      missing:0,
      cancelled:0,
      otherActive:0
    };
  }

  function classify(row,counts){
    if(!row)return counts;
    if(row.status==='cancelled'){
      counts.cancelled++;
      return counts;
    }
    if(!row.active)return counts;

    counts.expected++;
    switch(row.status){
      case 'observed': counts.observed++; break;
      case 'predicted_live': counts.predictedLive++; break;
      case 'awaiting_observation': counts.awaiting++; break;
      case 'expected_unobserved':
        counts.expectedUnobserved++; counts.missing++; break;
      case 'likely_missing':
        counts.likelyMissing++; counts.missing++; break;
      default:
        counts.otherActive++; break;
    }
    return counts;
  }

  function ratesFor(counts){
    const evidence=counts.observed+counts.predictedLive;
    const assessedExpected=Math.max(0,counts.expected-counts.awaiting-counts.otherActive);
    return freeze({
      observedCoveragePct:pct(counts.observed,counts.expected),
      liveEvidenceCoveragePct:pct(evidence,counts.expected),
      missingPct:pct(counts.missing,counts.expected),
      likelyMissingPct:pct(counts.likelyMissing,counts.expected),
      awaitingPct:pct(counts.awaiting,counts.expected),
      assessedExpected,
      assessedEvidence:evidence,
      assessedCoveragePct:pct(evidence,assessedExpected)
    });
  }

  function frozenCounts(source){
    return freeze({...source});
  }

  function routeRows(snapshot){
    const groups=new Map();
    for(const row of snapshot?.tripStates||[]){
      if(!row?.active&&row?.status!=='cancelled')continue;
      const routeId=String(row.routeId??'').trim()||'unknown';
      if(!groups.has(routeId))groups.set(routeId,emptyCounts());
      classify(row,groups.get(routeId));
    }
    return freeze([...groups].map(([routeId,counts])=>freeze({
      routeId,
      counts:frozenCounts(counts),
      rates:ratesFor(counts)
    })).sort((a,b)=>
      b.counts.expected-a.counts.expected||
      b.counts.missing-a.counts.missing||
      a.routeId.localeCompare(b.routeId)
    ));
  }

  function statusCounts(snapshot){
    const out={};
    for(const row of snapshot?.tripStates||[]){
      const status=String(row?.status||'unknown');
      out[status]=(out[status]||0)+1;
    }
    return freeze(out);
  }

  function vehicleCounts(snapshot){
    const out={total:0,matched:0,unresolved:0,statuses:{}};
    for(const row of snapshot?.vehicleStates||[]){
      const status=String(row?.status||'unknown');
      out.total++;
      out.statuses[status]=(out.statuses[status]||0)+1;
      if(status==='matched')out.matched++;
      else out.unresolved++;
    }
    return freeze({
      total:out.total,
      matched:out.matched,
      unresolved:out.unresolved,
      statuses:freeze({...out.statuses})
    });
  }

  class TransitCoverageMetrics{
    constructor({provider,network,generatedAt,counts,rates,byRoute,byStatus,vehicles,input}){
      this.provider=provider||null;
      this.network=network||null;
      this.generatedAt=num(generatedAt)||null;
      this.counts=frozenCounts(counts);
      this.rates=rates;
      this.byRoute=byRoute;
      this.byStatus=byStatus;
      this.vehicles=vehicles;
      this.input=freeze({...input});
      Object.freeze(this);
    }

    summary(){
      return freeze({
        provider:this.provider,
        network:this.network,
        generatedAt:this.generatedAt,
        expected:this.counts.expected,
        observed:this.counts.observed,
        predictedLive:this.counts.predictedLive,
        missing:this.counts.missing,
        expectedUnobserved:this.counts.expectedUnobserved,
        likelyMissing:this.counts.likelyMissing,
        awaiting:this.counts.awaiting,
        cancelled:this.counts.cancelled,
        observedCoveragePct:this.rates.observedCoveragePct,
        liveEvidenceCoveragePct:this.rates.liveEvidenceCoveragePct,
        missingPct:this.rates.missingPct,
        assessedCoveragePct:this.rates.assessedCoveragePct
      });
    }
  }

  function fromSnapshot(snapshot){
    if(!snapshot||!Array.isArray(snapshot.tripStates))
      throw new Error('TransitMetrics: TransitState snapshot non valido');

    const counts=emptyCounts();
    for(const row of snapshot.tripStates)classify(row,counts);

    return new TransitCoverageMetrics({
      provider:snapshot.provider||null,
      network:snapshot.network||null,
      generatedAt:snapshot.generatedAt,
      counts,
      rates:ratesFor(counts),
      byRoute:routeRows(snapshot),
      byStatus:statusCounts(snapshot),
      vehicles:vehicleCounts(snapshot),
      input:snapshot.inputSummary||{}
    });
  }

  global.UVTransitMetrics=freeze({
    PRIMARY_STATUSES,
    TransitCoverageMetrics,
    fromSnapshot,
    _test:freeze({classify,ratesFor,routeRows,statusCounts,vehicleCounts,pct})
  });
})(window);
