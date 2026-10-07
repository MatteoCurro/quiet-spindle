/* U.Venice Transport — prediction accuracy evaluator.
   Observes immutable TransitState snapshots and measures predicted_live outcomes.
   It never calls, mutates or feeds back into UVTransitPrediction / MotionState. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=freeze({
    sampleRetentionSec:600,
    forecastExpirySec:90,
    directOutcomeLagSec:20,
    interpolationMaxGapSec:45,
    maxForecasts:4000,
    maxResults:4000,
    maxSamplesPerTrip:24
  });

  function haversineM(a,b){
    if(!a||!b)return null;
    const lat1=finite(a.lat),lon1=finite(a.lon),lat2=finite(b.lat),lon2=finite(b.lon);
    if([lat1,lon1,lat2,lon2].some(v=>v===null))return null;
    const R=6371008.8,rad=Math.PI/180;
    const p1=lat1*rad,p2=lat2*rad,dP=(lat2-lat1)*rad,dL=(lon2-lon1)*rad;
    const h=Math.sin(dP/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dL/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }

  function percentile(values,p){
    const rows=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!rows.length)return null;
    if(rows.length===1)return rows[0];
    const i=(rows.length-1)*clamp(Number(p)||0,0,1),lo=Math.floor(i),hi=Math.ceil(i);
    return rows[lo]+(rows[hi]-rows[lo])*(i-lo);
  }

  function mean(values){
    const rows=(values||[]).filter(Number.isFinite);
    return rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:null;
  }

  function rounded(v,digits=1){
    return Number.isFinite(v)?Number(v.toFixed(digits)):null;
  }

  function forecastId(row){
    const motion=row?.motion||{},at=finite(motion.generatedAt??row?.generatedAt);
    const target=at??finite(row?.generatedAt)??0;
    const method=motion.predictionMethod||motion.position?.details?.method||'unknown';
    const anchor=motion.anchorObservationId||motion.position?.details?.observationId||'none';
    return [row?.tripInstanceId||'unknown',target,method,anchor].join('|');
  }

  function forecastFromRow(row){
    if(!row||row.motionMode!=='predicted_live')return null;
    const motion=row.motion||{},position=motion.position?.value;
    const targetAt=finite(motion.generatedAt??row.generatedAt);
    if(!position||targetAt===null||finite(position.lat)===null||finite(position.lon)===null)return null;
    const anchorObservedAt=finite(motion.predictedFromObservedAt??motion.position?.observedAt);
    return freeze({
      id:forecastId(row),
      provider:row.provider||null,
      network:row.network||null,
      tripInstanceId:row.tripInstanceId,
      routeId:row.routeId||null,
      targetAt,
      method:motion.predictionMethod||motion.position?.details?.method||'unknown',
      confidence:clamp(Number(motion.position?.confidence)||0,0,1),
      anchorObservationId:motion.anchorObservationId||motion.position?.details?.observationId||null,
      anchorObservedAt,
      predictionAgeSec:anchorObservedAt===null?null:Math.max(0,targetAt-anchorObservedAt),
      position:freeze({lat:Number(position.lat),lon:Number(position.lon)}),
      shapeProgress:finite(motion.shapeProgress?.value)
    });
  }

  function liveSampleFromRow(row){
    if(!row||row.motionMode!=='live')return null;
    const motion=row.motion||{},position=motion.position?.value;
    const observedAt=finite(motion.position?.observedAt??row.freshestObservedAt);
    if(!position||observedAt===null||finite(position.lat)===null||finite(position.lon)===null)return null;
    return freeze({
      tripInstanceId:row.tripInstanceId,
      observedAt,
      position:freeze({lat:Number(position.lat),lon:Number(position.lon)}),
      shapeProgress:finite(motion.shapeProgress?.value),
      observationId:motion.anchorObservationId||motion.position?.details?.observationId||null
    });
  }

  function interpolateSample(before,after,targetAt){
    if(!before||!after)return null;
    const span=after.observedAt-before.observedAt;
    if(span<=0||targetAt<before.observedAt||targetAt>after.observedAt)return null;
    const t=(targetAt-before.observedAt)/span;
    const shapeProgress=before.shapeProgress!==null&&after.shapeProgress!==null
      ?before.shapeProgress+(after.shapeProgress-before.shapeProgress)*t
      :null;
    return freeze({
      observedAt:targetAt,
      position:freeze({
        lat:before.position.lat+(after.position.lat-before.position.lat)*t,
        lon:before.position.lon+(after.position.lon-before.position.lon)*t
      }),
      shapeProgress,
      method:'interpolated_live',
      lagSec:0,
      bracketSpanSec:span
    });
  }

  class PredictionAccuracySnapshot{
    constructor({provider,network,generatedAt,pending,results,stats}){
      this.provider=provider||null;
      this.network=network||null;
      this.generatedAt=finite(generatedAt);
      this.pending=freeze(pending);
      this.results=freeze(results);
      this.stats=freeze({...stats});
      Object.freeze(this);
    }

    summary(){
      const errors=this.results.map(x=>x.spatialErrorM).filter(Number.isFinite);
      const byMethod={};
      for(const row of this.results){
        const key=row.method||'unknown';
        (byMethod[key]||(byMethod[key]=[])).push(row.spatialErrorM);
      }
      const methodSummary={};
      for(const [method,values] of Object.entries(byMethod)){
        methodSummary[method]=freeze({
          settled:values.length,
          meanErrorM:rounded(mean(values)),
          medianErrorM:rounded(percentile(values,.5)),
          p90ErrorM:rounded(percentile(values,.9))
        });
      }
      return freeze({
        provider:this.provider,
        network:this.network,
        generatedAt:this.generatedAt,
        forecastsRecorded:this.stats.forecastsRecorded,
        pending:this.pending.length,
        settled:this.results.length,
        expired:this.stats.expired,
        deduplicatedForecasts:this.stats.deduplicatedForecasts,
        liveSamples:this.stats.liveSamples,
        meanErrorM:rounded(mean(errors)),
        medianErrorM:rounded(percentile(errors,.5)),
        p90ErrorM:rounded(percentile(errors,.9)),
        meanOutcomeLagSec:rounded(mean(this.results.map(x=>Math.abs(x.outcomeLagSec)))),
        byMethod:freeze(methodSummary)
      });
    }
  }

  class PredictionAccuracyEngine{
    constructor(options={}){
      this.options={...DEFAULTS,...options};
      this._forecasts=new Map();
      this._results=[];
      this._samplesByTrip=new Map();
      this._sampleIds=new Set();
      this._stats={
        forecastsRecorded:0,
        deduplicatedForecasts:0,
        expired:0,
        liveSamples:0
      };
      this.provider=null;
      this.network=null;
      this.generatedAt=null;
    }

    ingest(snapshot){
      if(!snapshot||!Array.isArray(snapshot.tripStates))
        throw new Error('PredictionAccuracyEngine: TransitState snapshot non valido');

      this.provider=snapshot.provider||this.provider;
      this.network=snapshot.network||this.network;
      this.generatedAt=finite(snapshot.generatedAt)??Date.now()/1000;
      this._ingestLiveSamples(snapshot.tripStates);
      this._settle(this.generatedAt);
      this._recordForecasts(snapshot.tripStates);
      this._expire(this.generatedAt);
      this._pruneSamples(this.generatedAt);
      this._trim();
      return this.snapshot();
    }

    _ingestLiveSamples(rows){
      for(const row of rows||[]){
        const sample=liveSampleFromRow(row);
        if(!sample)continue;
        const sid=[sample.tripInstanceId,sample.observedAt,sample.observationId||'none'].join('|');
        if(this._sampleIds.has(sid))continue;
        this._sampleIds.add(sid);
        const list=this._samplesByTrip.get(sample.tripInstanceId)||[];
        list.push(sample);
        list.sort((a,b)=>a.observedAt-b.observedAt);
        while(list.length>this.options.maxSamplesPerTrip){
          const removed=list.shift();
          this._sampleIds.delete([removed.tripInstanceId,removed.observedAt,removed.observationId||'none'].join('|'));
        }
        this._samplesByTrip.set(sample.tripInstanceId,list);
        this._stats.liveSamples++;
      }
    }

    _recordForecasts(rows){
      for(const row of rows||[]){
        const forecast=forecastFromRow(row);
        if(!forecast)continue;
        if(this._forecasts.has(forecast.id)){
          this._stats.deduplicatedForecasts++;
          continue;
        }
        this._forecasts.set(forecast.id,forecast);
        this._stats.forecastsRecorded++;
      }
    }

    _outcomeFor(forecast){
      const samples=this._samplesByTrip.get(forecast.tripInstanceId)||[];
      if(!samples.length)return null;

      let before=null,after=null,nearest=null,nearestAbs=Infinity;
      for(const sample of samples){
        if(sample.observedAt<=forecast.targetAt)before=sample;
        if(sample.observedAt>=forecast.targetAt&&!after)after=sample;
        const abs=Math.abs(sample.observedAt-forecast.targetAt);
        if(abs<nearestAbs){nearest=sample;nearestAbs=abs}
      }

      if(before&&after&&after.observedAt-before.observedAt<=this.options.interpolationMaxGapSec){
        const interpolated=interpolateSample(before,after,forecast.targetAt);
        if(interpolated)return interpolated;
      }

      if(nearest&&nearestAbs<=this.options.directOutcomeLagSec){
        return freeze({
          observedAt:nearest.observedAt,
          position:nearest.position,
          shapeProgress:nearest.shapeProgress,
          method:'nearest_live_sample',
          lagSec:nearest.observedAt-forecast.targetAt,
          bracketSpanSec:null
        });
      }
      return null;
    }

    _settle(now){
      for(const [id,forecast] of [...this._forecasts]){
        const outcome=this._outcomeFor(forecast);
        if(!outcome)continue;
        const spatialErrorM=haversineM(forecast.position,outcome.position);
        if(spatialErrorM===null)continue;
        const progressErrorM=forecast.shapeProgress!==null&&outcome.shapeProgress!==null
          ?Math.abs(forecast.shapeProgress-outcome.shapeProgress)
          :null;
        this._results.push(freeze({
          id,
          tripInstanceId:forecast.tripInstanceId,
          routeId:forecast.routeId,
          targetAt:forecast.targetAt,
          method:forecast.method,
          confidence:forecast.confidence,
          predictionAgeSec:forecast.predictionAgeSec,
          outcomeMethod:outcome.method,
          outcomeLagSec:outcome.lagSec,
          bracketSpanSec:outcome.bracketSpanSec,
          spatialErrorM,
          progressErrorM
        }));
        this._forecasts.delete(id);
      }
    }

    _expire(now){
      for(const [id,forecast] of [...this._forecasts]){
        if(now-forecast.targetAt>this.options.forecastExpirySec){
          this._forecasts.delete(id);
          this._stats.expired++;
        }
      }
    }

    _pruneSamples(now){
      const cutoff=now-this.options.sampleRetentionSec;
      for(const [tripId,list] of [...this._samplesByTrip]){
        const kept=list.filter(x=>x.observedAt>=cutoff);
        for(const sample of list){
          if(sample.observedAt<cutoff)
            this._sampleIds.delete([sample.tripInstanceId,sample.observedAt,sample.observationId||'none'].join('|'));
        }
        if(kept.length)this._samplesByTrip.set(tripId,kept);
        else this._samplesByTrip.delete(tripId);
      }
    }

    _trim(){
      if(this._forecasts.size>this.options.maxForecasts){
        const drop=[...this._forecasts.values()]
          .sort((a,b)=>a.targetAt-b.targetAt)
          .slice(0,this._forecasts.size-this.options.maxForecasts);
        for(const row of drop){this._forecasts.delete(row.id);this._stats.expired++}
      }
      if(this._results.length>this.options.maxResults)
        this._results.splice(0,this._results.length-this.options.maxResults);
    }

    snapshot(){
      const pending=[...this._forecasts.values()].sort((a,b)=>a.targetAt-b.targetAt);
      return new PredictionAccuracySnapshot({
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        pending,results:[...this._results],stats:{...this._stats}
      });
    }

    clear(){
      this._forecasts.clear();this._results.length=0;this._samplesByTrip.clear();this._sampleIds.clear();
    }
  }

  function createPredictionAccuracyEngine(options){return new PredictionAccuracyEngine(options)}

  global.UVTransitPredictionAccuracy=freeze({
    DEFAULTS,
    PredictionAccuracyEngine,
    PredictionAccuracySnapshot,
    createPredictionAccuracyEngine,
    _test:freeze({
      haversineM,percentile,mean,forecastFromRow,liveSampleFromRow,interpolateSample
    })
  });
})(window);
