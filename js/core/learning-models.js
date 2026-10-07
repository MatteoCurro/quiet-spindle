/* U.Venice Transport — M7C first candidate learning models.
   All models run read-only/shadow-side. They only emit versioned predictions into
   UVTransitLearning stores and can never mutate ServicePlan or TransitState. */
(function(global){
  'use strict';

  const L=global.UVTransitLearning;
  if(!L)throw new Error('UVTransitLearning required before UVTransitLearningModels');

  const freeze=o=>Object.freeze(o);
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const text=v=>String(v??'').trim();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const sigmoid=x=>1/(1+Math.exp(-x));
  const VERSION=freeze({
    tripMatch:'trip-match-confidence-v1',
    missingTrip:'missing-trip-calibration-v1',
    segmentHistory:'segment-history-v1',
    eta:'eta-segment-history-v1'
  });

  function evidenceStats(resolution){
    let positive=0,negative=0,strongest=0;
    for(const row of resolution?.evidence||[]){
      const weight=finite(row?.weight)??0;
      if(weight>=0){positive+=weight;strongest=Math.max(strongest,weight)}
      else negative+=Math.abs(weight);
    }
    const alternatives=resolution?.alternatives||[];
    const bestAlt=finite(alternatives[0]?.score)??0,secondAlt=finite(alternatives[1]?.score)??0;
    return freeze({positive,negative,strongest,alternatives:alternatives.length,bestAlt,margin:Math.max(0,bestAlt-secondAlt)});
  }

  class TripMatchConfidenceModel{
    constructor(){this.modelVersion=VERSION.tripMatch}
    predict(resolution){
      if(!resolution)return null;
      const stats=evidenceStats(resolution),deterministicConfidence=clamp(Number(resolution.confidence)||0,0,1);
      const classBonus={
        exact:2.4,trip_matched:1.1,gps_shape_matched:.8,gps_stop_matched:.45,
        vehicle_correlated:.65,route_only:-.8,unknown:-1.5
      }[resolution.classification]??0;
      const z=-2.3+3.2*deterministicConfidence+Math.min(2,stats.positive/45)-
        Math.min(1.4,stats.negative/20)-Math.min(1,stats.alternatives*.18)+classBonus;
      const confidence=clamp(sigmoid(z),.01,.995);
      const value=resolution.tripInstanceId||resolution.alternatives?.[0]?.tripInstanceId||null;
      if(!value)return null;
      return freeze({
        task:'trip_match',modelVersion:this.modelVersion,confidence,value,
        features:freeze({
          deterministicConfidence,evidenceWeight:stats.positive,negativeWeight:stats.negative,
          alternatives:stats.alternatives,classification:text(resolution.classification),matched:!!resolution.matched
        })
      });
    }
  }

  class MissingTripCalibrationModel{
    constructor(){this.modelVersion=VERSION.missingTrip}
    predict(row,{generatedAt,observedCoveragePct}={}){
      if(!row||!['likely_missing','expected_unobserved','awaiting_observation'].includes(row.status))return null;
      const now=finite(generatedAt)??Date.now()/1000;
      const activeForSec=Math.max(0,now-(finite(row.plannedStart)??now));
      const observationAgeSec=finite(row.observationAgeSec);
      const coverage=finite(observedCoveragePct);
      const deterministicConfidence=clamp(Number(row.confidence)||0,0,1);
      let z=row.status==='likely_missing'?.95:row.status==='expected_unobserved'?-.15:-.8;
      z+=Math.min(1.2,activeForSec/900);
      if(observationAgeSec!==null)z+=Math.min(.8,observationAgeSec/300);
      if(coverage!==null)z+=(coverage-.5)*1.4;
      z+=(deterministicConfidence-.5)*.8;
      const probability=clamp(sigmoid(z),.01,.99);
      return freeze({
        task:'missing_trip',modelVersion:this.modelVersion,
        probability,confidence:clamp(Math.abs(probability-.5)*2,.05,.98),
        value:probability>=.5,
        features:freeze({
          status:row.status,activeForSec,observationAgeSec:observationAgeSec??0,
          observedCoveragePct:coverage??0,deterministicConfidence
        })
      });
    }
  }

  function aggregateMetric(historySnapshot,segmentKey,metric){
    let count=0,sum=0,min=Infinity,max=-Infinity,lastAt=null;
    for(const row of historySnapshot?.raw||[]){
      if(row.scope!=='segment'||row.key!==segmentKey)continue;
      const value=finite(row.metrics?.[metric]);if(value===null)continue;
      count++;sum+=value;min=Math.min(min,value);max=Math.max(max,value);lastAt=Math.max(lastAt??-Infinity,row.at);
    }
    for(const row of historySnapshot?.compact||[]){
      if(row.scope!=='segment'||row.key!==segmentKey)continue;
      const m=row.metrics?.[metric],n=Number(m?.count)||0,avg=finite(m?.mean);
      if(!n||avg===null)continue;
      count+=n;sum+=avg*n;
      const lo=finite(m.min),hi=finite(m.max);
      if(lo!==null)min=Math.min(min,lo);if(hi!==null)max=Math.max(max,hi);
      lastAt=Math.max(lastAt??-Infinity,row.bucketStart+row.bucketSec);
    }
    return freeze({
      count,mean:count?sum/count:null,min:count?min:null,max:count?max:null,
      lastAt:Number.isFinite(lastAt)?lastAt:null
    });
  }

  class SegmentHistoryModel{
    constructor({historyStore}={}){
      if(!historyStore)throw new Error('SegmentHistoryModel: historyStore richiesto');
      this.historyStore=historyStore;this.modelVersion=VERSION.segmentHistory;
    }
    estimate(segmentKey){
      segmentKey=text(segmentKey);if(!segmentKey)return null;
      const snapshot=this.historyStore.snapshot(false);
      const travel=aggregateMetric(snapshot,segmentKey,'travelTimeSec');
      const dwell=aggregateMetric(snapshot,segmentKey,'dwellTimeSec');
      const count=Math.max(travel.count,dwell.count);
      if(!count)return null;
      const confidence=clamp(.2+Math.log2(count+1)*.12,.2,.95);
      return freeze({
        modelVersion:this.modelVersion,segmentKey,confidence,sampleCount:count,
        travelTimeSec:travel.mean,dwellTimeSec:dwell.mean,
        travel:travel,dwell:dwell
      });
    }
  }

  function stopId(view){return text(view?.stopId||view?.id)}
  function segmentKey(routeId,a,b){return [text(routeId)||'route',text(a),text(b)].join('|')}

  class EtaCorrectionModel{
    constructor({segmentModel}={}){
      if(!segmentModel)throw new Error('EtaCorrectionModel: segmentModel richiesto');
      this.segmentModel=segmentModel;this.modelVersion=VERSION.eta;
    }
    predict({instance,row,now}={}){
      if(!instance||!row)return null;
      now=finite(now)??Date.now()/1000;
      if(now>=instance.plannedEnd||!Array.isArray(instance.stops)||instance.stops.length<2)return null;
      const nextId=stopId(row.expectedState?.nextStop);
      let nextIndex=nextId?instance.stops.findIndex(s=>s.id===nextId):-1;
      if(nextIndex<1)nextIndex=instance.stops.findIndex(s=>s.plannedArrival>=now);
      if(nextIndex<1)nextIndex=1;
      const scheduledRemainingSec=Math.max(0,instance.plannedEnd-now);
      let correctedRemainingSec=scheduledRemainingSec,used=0,confidenceSum=0,totalSegments=0;

      for(let i=nextIndex-1;i<instance.stops.length-1;i++){
        const from=instance.stops[i],to=instance.stops[i+1];
        const fullScheduledTravel=Math.max(1,to.plannedArrival-from.plannedDeparture);
        const scheduledPart=i===nextIndex-1
          ?Math.max(0,to.plannedArrival-now)
          :fullScheduledTravel;
        if(scheduledPart<=0&&i===nextIndex-1)continue;
        totalSegments++;
        const history=this.segmentModel.estimate(segmentKey(instance.route.id,from.id,to.id));
        if(!history?.travelTimeSec)continue;
        const fraction=i===nextIndex-1?clamp(scheduledPart/fullScheduledTravel,0,1):1;
        const historicalTravel=history.travelTimeSec*fraction;
        correctedRemainingSec+=historicalTravel-scheduledPart;
        if(i+1<instance.stops.length-1&&history.dwellTimeSec!==null){
          const plannedDwell=Math.max(0,to.plannedDeparture-to.plannedArrival);
          correctedRemainingSec+=history.dwellTimeSec-plannedDwell;
        }
        used++;confidenceSum+=history.confidence;
      }
      if(!used)return null;
      correctedRemainingSec=Math.max(0,correctedRemainingSec);
      const historyCoverage=totalSegments?used/totalSegments:0;
      const confidence=clamp((confidenceSum/used)*(.45+.55*historyCoverage),.05,.95);
      return freeze({
        task:'eta_arrival',modelVersion:this.modelVersion,confidence,
        value:now+correctedRemainingSec,
        correctionSec:correctedRemainingSec-scheduledRemainingSec,
        scheduledArrivalAt:instance.plannedEnd,
        targetStopId:instance.stops.at(-1).id,
        features:freeze({scheduledRemainingSec,segmentCount:totalSegments,historyCoverage})
      });
    }
  }

  function observedCoverage(snapshot){
    const rows=(snapshot?.tripStates||[]).filter(x=>x.active);
    if(!rows.length)return null;
    const observed=rows.filter(x=>['observed','predicted_live'].includes(x.status)).length;
    return observed/rows.length;
  }

  function strongOfficialResolution(resolution){
    if(!resolution?.matched||finite(resolution.confidence)<.99)return false;
    if(resolution.classification==='exact')return true;
    return (resolution.evidence||[]).some(x=>x?.type==='trip_id_exact'||x?.type==='trip_id_cross_generation');
  }

  class FirstLearningBundle{
    constructor({learningLayer}={}){
      if(!learningLayer)throw new Error('FirstLearningBundle: learningLayer richiesto');
      this.learningLayer=learningLayer;
      this.tripMatch=new TripMatchConfidenceModel();
      this.missingTrip=new MissingTripCalibrationModel();
      this.segmentHistory=new SegmentHistoryModel({historyStore:learningLayer.history});
      this.eta=new EtaCorrectionModel({segmentModel:this.segmentHistory});
      this._lastMissingAt=new Map();this._lastEtaAt=new Map();
      this._stats={snapshots:0,tripMatchPredictions:0,missingPredictions:0,etaPredictions:0,verifiedTripTruth:0};
      this._registerContracts();
    }

    _registerContracts(){
      const schemas=this.learningLayer.schemas,models=this.learningLayer.models;
      schemas.register({id:'trip-match-confidence',version:'1',features:{
        deterministicConfidence:{type:'number'},evidenceWeight:{type:'number'},negativeWeight:{type:'number'},
        alternatives:{type:'number'},classification:{type:'string'},matched:{type:'boolean'}
      }});
      schemas.register({id:'missing-trip-calibration',version:'1',features:{
        status:{type:'string'},activeForSec:{type:'number'},observationAgeSec:{type:'number'},
        observedCoveragePct:{type:'number'},deterministicConfidence:{type:'number'}
      }});
      schemas.register({id:'eta-segment-history',version:'1',features:{
        scheduledRemainingSec:{type:'number'},segmentCount:{type:'number'},historyCoverage:{type:'number'}
      }});
      models.register({task:'trip_match',version:VERSION.tripMatch,kind:'heuristic',status:'shadow',featureSchemaId:'trip-match-confidence',featureSchemaVersion:'1'});
      models.register({task:'missing_trip',version:VERSION.missingTrip,kind:'heuristic',status:'shadow',featureSchemaId:'missing-trip-calibration',featureSchemaVersion:'1'});
      models.register({task:'eta_arrival',version:VERSION.eta,kind:'heuristic',status:'shadow',featureSchemaId:'eta-segment-history',featureSchemaVersion:'1'});
    }

    _appendPrediction(input){
      try{this.learningLayer.predictions.append(input);return true}catch(_){return false}
    }

    _tripMatchPredictions({resolutions,observations,now}){
      const byObservation=new Map((observations||[]).map(o=>[o?.id,o]));
      for(const resolution of resolutions||[]){
        const observation=byObservation.get(resolution?.observationId),at=finite(observation?.observedAt)??now;
        const entityId=text(resolution?.observationId);if(!entityId)continue;
        const deterministicValue=resolution.tripInstanceId||resolution.alternatives?.[0]?.tripInstanceId||null;
        if(deterministicValue&&this._appendPrediction({
          task:'trip_match',truthKind:'trip_identity',entityId,
          modelVersion:'deterministic-trip-match-v1',generatedAt:at,targetAt:at,horizonSec:0,
          outcomeToleranceSec:30,confidence:resolution.confidence||0,value:deterministicValue,
          featureSchemaId:'transit-deterministic',featureSchemaVersion:'1',
          features:{confidence:Number(resolution.confidence)||0,horizonSec:0,routeId:resolution.routeId||''}
        }))this._stats.tripMatchPredictions++;

        const candidate=this.tripMatch.predict(resolution);
        if(candidate&&this._appendPrediction({
          task:candidate.task,truthKind:'trip_identity',entityId,
          modelVersion:candidate.modelVersion,generatedAt:at,targetAt:at,horizonSec:0,
          outcomeToleranceSec:30,confidence:candidate.confidence,value:candidate.value,
          featureSchemaId:'trip-match-confidence',featureSchemaVersion:'1',features:candidate.features
        }))this._stats.tripMatchPredictions++;

        if(strongOfficialResolution(resolution)&&resolution.tripInstanceId){
          const truth=this.learningLayer.truth.tryAdd({
            kind:'trip_identity',entityId,observedAt:at,sourceKind:'official_realtime',
            evidenceId:observation?.id||entityId,value:resolution.tripInstanceId,
            metadata:{classification:resolution.classification,routeId:resolution.routeId||null}
          });
          if(truth)this._stats.verifiedTripTruth++;
        }
      }
    }

    _missingPredictions({snapshot,now}){
      const coverage=observedCoverage(snapshot);
      for(const row of snapshot?.tripStates||[]){
        const candidate=this.missingTrip.predict(row,{generatedAt:now,observedCoveragePct:coverage});
        if(!candidate)continue;
        const last=this._lastMissingAt.get(row.tripInstanceId)||-Infinity;
        if(now-last<120)continue;
        this._lastMissingAt.set(row.tripInstanceId,now);
        const targetAt=now+300;
        const baselineValue=row.status==='likely_missing';
        const baselineConfidence=row.status==='likely_missing'
          ?clamp(Number(row.confidence)||.65,.5,.95)
          :clamp(1-(Number(row.confidence)||.5),.05,.8);
        if(this._appendPrediction({
          task:'missing_trip',truthKind:'missing_trip',entityId:row.tripInstanceId,
          modelVersion:'deterministic-missing-trip-v1',generatedAt:now,targetAt,horizonSec:300,
          outcomeToleranceSec:180,confidence:baselineConfidence,value:baselineValue,
          featureSchemaId:'transit-deterministic',featureSchemaVersion:'1',
          features:{confidence:baselineConfidence,horizonSec:300,routeId:row.routeId||''}
        }))this._stats.missingPredictions++;
        if(this._appendPrediction({
          task:'missing_trip',truthKind:'missing_trip',entityId:row.tripInstanceId,
          modelVersion:candidate.modelVersion,generatedAt:now,targetAt,horizonSec:300,
          outcomeToleranceSec:180,confidence:candidate.probability,value:candidate.value,
          featureSchemaId:'missing-trip-calibration',featureSchemaVersion:'1',features:candidate.features,
          metadata:{probability:candidate.probability}
        }))this._stats.missingPredictions++;
      }
    }

    _etaPredictions({snapshot,servicePlan,now}){
      if(!servicePlan||typeof servicePlan.get!=='function')return;
      for(const row of snapshot?.tripStates||[]){
        if(!row.active||['cancelled','completed'].includes(row.status))continue;
        const instance=servicePlan.get(row.tripInstanceId);if(!instance||instance.plannedEnd-now<30)continue;
        const last=this._lastEtaAt.get(row.tripInstanceId)||-Infinity;
        if(now-last<60)continue;
        this._lastEtaAt.set(row.tripInstanceId,now);
        const finalStopId=instance.stops.at(-1)?.id;if(!finalStopId)continue;
        const entityId=row.tripInstanceId+'|'+finalStopId;
        const baselineHorizon=Math.max(0,instance.plannedEnd-now);
        if(this._appendPrediction({
          task:'eta_arrival',truthKind:'arrival_time',entityId,
          modelVersion:'deterministic-schedule-eta-v1',generatedAt:now,targetAt:instance.plannedEnd,
          horizonSec:baselineHorizon,outcomeToleranceSec:900,confidence:.65,value:instance.plannedEnd,
          featureSchemaId:'transit-deterministic',featureSchemaVersion:'1',
          features:{confidence:.65,horizonSec:baselineHorizon,routeId:row.routeId||''}
        }))this._stats.etaPredictions++;

        const candidate=this.eta.predict({instance,row,now});
        if(!candidate)continue;
        const horizon=Math.max(0,candidate.value-now);
        if(this._appendPrediction({
          task:'eta_arrival',truthKind:'arrival_time',entityId,
          modelVersion:candidate.modelVersion,generatedAt:now,targetAt:candidate.value,
          horizonSec:horizon,outcomeToleranceSec:900,confidence:candidate.confidence,value:candidate.value,
          featureSchemaId:'eta-segment-history',featureSchemaVersion:'1',features:candidate.features,
          metadata:{correctionSec:candidate.correctionSec,scheduledArrivalAt:candidate.scheduledArrivalAt}
        }))this._stats.etaPredictions++;
      }
    }

    observe({snapshot,resolutions,observations,servicePlan,now}={}){
      now=finite(now??snapshot?.generatedAt)??Date.now()/1000;
      const modelState=this.learningLayer.models.snapshot();
      if(!modelState.enabled||modelState.killSwitch)return this.summary();
      this._stats.snapshots++;
      this._tripMatchPredictions({resolutions,observations,now});
      this._missingPredictions({snapshot,now});
      this._etaPredictions({snapshot,servicePlan,now});
      return this.summary();
    }

    summary(){
      return freeze({
        versions:VERSION,stats:freeze({...this._stats}),
        segmentHistoryModel:VERSION.segmentHistory,
        tripMatchModel:VERSION.tripMatch,missingTripModel:VERSION.missingTrip,etaModel:VERSION.eta
      });
    }
  }

  function createFirstLearningBundle(options){return new FirstLearningBundle(options)}

  global.UVTransitLearningModels=freeze({
    VERSION,TripMatchConfidenceModel,MissingTripCalibrationModel,SegmentHistoryModel,EtaCorrectionModel,
    FirstLearningBundle,createFirstLearningBundle,
    _test:freeze({evidenceStats,aggregateMetric,observedCoverage,strongOfficialResolution,segmentKey})
  });
})(window);
