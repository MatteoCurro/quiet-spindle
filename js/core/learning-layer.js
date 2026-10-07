/* U.Venice Transport — M7C Learning & Calibration foundation.
   Read-only observer of canonical TransitState. Predictions, verified outcomes,
   compact history and model lifecycle remain isolated from the deterministic core. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const text=v=>String(v??'').trim();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const VERIFIED_SOURCES=freeze(['official_realtime','observed_live','operator_verified','manual_verified','verified_import']);
  const MODEL_STATUSES=freeze(new Set(['active','candidate','shadow','retired']));
  const MODEL_KINDS=freeze(new Set(['deterministic','heuristic','learned']));
  const DEFAULTS=freeze({
    predictionRetentionSec:21600,
    maxPredictions:12000,
    truthRetentionSec:21600,
    maxTruthEntries:12000,
    outcomeToleranceSec:45,
    maxOutcomes:12000,
    historyRetentionSec:1209600,
    historyCompactAfterSec:21600,
    historyBucketSec:900,
    maxHistoryEntries:20000,
    maxCompactBuckets:12000,
    horizonsSec:freeze([120,300,600,900])
  });

  function deepFreeze(value){
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    for(const v of Object.values(value))deepFreeze(v);
    return Object.freeze(value);
  }
  function stableValue(value){
    if(value===null||['string','number','boolean'].includes(typeof value))return value;
    if(Array.isArray(value))return freeze(value.map(stableValue));
    if(typeof value==='object'){
      const out={};
      for(const key of Object.keys(value).sort())out[key]=stableValue(value[key]);
      return freeze(out);
    }
    return String(value);
  }
  function haversineM(a,b){
    if(!a||!b)return null;
    const lat1=finite(a.lat),lon1=finite(a.lon),lat2=finite(b.lat),lon2=finite(b.lon);
    if([lat1,lon1,lat2,lon2].some(v=>v===null))return null;
    const R=6371008.8,rad=Math.PI/180,p1=lat1*rad,p2=lat2*rad;
    const dP=(lat2-lat1)*rad,dL=(lon2-lon1)*rad;
    const h=Math.sin(dP/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dL/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function mean(values){
    const rows=(values||[]).filter(Number.isFinite);
    return rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:null;
  }
  function rounded(value,digits=2){
    return Number.isFinite(value)?Number(value.toFixed(digits)):null;
  }
  function assertVerifiedSource(sourceKind){
    const source=text(sourceKind);
    if(!VERIFIED_SOURCES.includes(source))
      throw new Error('LearningLayer: ground truth source non verificata: '+source);
    return source;
  }

  class FeatureSchemaRegistry{
    constructor(){this._schemas=new Map()}
    register({id,version,features}={}){
      id=text(id);version=text(version);
      if(!id||!version||!features||typeof features!=='object')
        throw new Error('FeatureSchemaRegistry: id/version/features richiesti');
      const key=id+'@'+version;
      if(this._schemas.has(key))return this._schemas.get(key);
      const normalized={};
      for(const [name,spec] of Object.entries(features)){
        const row=typeof spec==='string'?{type:spec}:spec||{};
        if(!['number','string','boolean'].includes(row.type))
          throw new Error('FeatureSchemaRegistry: tipo non supportato per '+name);
        normalized[name]=freeze({type:row.type,required:row.required!==false});
      }
      const schema=deepFreeze({id,version,key,features:normalized});
      this._schemas.set(key,schema);return schema;
    }
    get(id,version){return this._schemas.get(text(id)+'@'+text(version))||null}
    validate(id,version,values={}){
      const schema=this.get(id,version);
      if(!schema)throw new Error('FeatureSchemaRegistry: schema sconosciuto '+id+'@'+version);
      const errors=[];
      for(const [name,spec] of Object.entries(schema.features)){
        const value=values[name];
        if((value===null||value===undefined||value==='')&&spec.required){errors.push(name+':required');continue}
        if(value===null||value===undefined||value==='')continue;
        if(spec.type==='number'&&!Number.isFinite(Number(value)))errors.push(name+':number');
        if(spec.type==='string'&&typeof value!=='string')errors.push(name+':string');
        if(spec.type==='boolean'&&typeof value!=='boolean')errors.push(name+':boolean');
      }
      return freeze({valid:errors.length===0,errors:freeze(errors)});
    }
    snapshot(){return freeze([...this._schemas.values()])}
  }

  class PredictionLog{
    constructor(options={}){
      this.options={retentionSec:DEFAULTS.predictionRetentionSec,maxEntries:DEFAULTS.maxPredictions,...options};
      this._rows=new Map();this._stats={appended:0,deduplicated:0,pruned:0};
    }
    append(input={}){
      if(Object.prototype.hasOwnProperty.call(input,'groundTruth')||Object.prototype.hasOwnProperty.call(input,'outcome'))
        throw new Error('PredictionLog: prediction e ground truth devono restare separati');
      const task=text(input.task),entityId=text(input.entityId),modelVersion=text(input.modelVersion);
      const generatedAt=finite(input.generatedAt),targetAt=finite(input.targetAt);
      if(!task||!entityId||!modelVersion||generatedAt===null||targetAt===null)
        throw new Error('PredictionLog: task/entityId/modelVersion/generatedAt/targetAt richiesti');
      const confidence=clamp(Number(input.confidence)||0,0,1);
      const horizonSec=finite(input.horizonSec)??Math.max(0,targetAt-generatedAt);
      const id=text(input.id)||[task,entityId,modelVersion,generatedAt,targetAt].join('|');
      if(this._rows.has(id)){this._stats.deduplicated++;return this._rows.get(id)}
      const row=deepFreeze({
        id,task,truthKind:text(input.truthKind)||task,entityId,modelVersion,
        generatedAt,targetAt,horizonSec,confidence,
        outcomeToleranceSec:finite(input.outcomeToleranceSec),
        featureSchemaId:text(input.featureSchemaId)||null,
        featureSchemaVersion:text(input.featureSchemaVersion)||null,
        features:stableValue(input.features||{}),
        value:stableValue(input.value),
        metadata:stableValue(input.metadata||{})
      });
      this._rows.set(id,row);this._stats.appended++;
      this.prune(generatedAt);this._enforceMax();return row;
    }
    prune(now=Date.now()/1000){
      const cutoff=(finite(now)??Date.now()/1000)-this.options.retentionSec;
      let removed=0;
      for(const [id,row] of this._rows)if(row.targetAt<cutoff){this._rows.delete(id);removed++}
      this._stats.pruned+=removed;return removed;
    }
    _enforceMax(){
      const excess=this._rows.size-this.options.maxEntries;
      if(excess<=0)return;
      const oldest=[...this._rows.values()].sort((a,b)=>a.targetAt-b.targetAt).slice(0,excess);
      for(const row of oldest)this._rows.delete(row.id);
      this._stats.pruned+=oldest.length;
    }
    snapshot(now=Date.now()/1000){
      this.prune(now);
      return freeze({
        generatedAt:finite(now)??Date.now()/1000,
        entries:freeze([...this._rows.values()].sort((a,b)=>a.targetAt-b.targetAt)),
        stats:freeze({...this._stats})
      });
    }
    clear(){this._rows.clear()}
  }

  class GroundTruthStore{
    constructor(options={}){
      this.options={retentionSec:DEFAULTS.truthRetentionSec,maxEntries:DEFAULTS.maxTruthEntries,...options};
      this._rows=new Map();this._stats={accepted:0,deduplicated:0,rejected:0,pruned:0};
    }
    add(input={}){
      const sourceKind=assertVerifiedSource(input.sourceKind);
      const kind=text(input.kind),entityId=text(input.entityId),observedAt=finite(input.observedAt);
      if(!kind||!entityId||observedAt===null)throw new Error('GroundTruthStore: kind/entityId/observedAt richiesti');
      const evidenceId=text(input.evidenceId)||'none';
      const id=text(input.id)||[kind,entityId,observedAt,evidenceId].join('|');
      if(this._rows.has(id)){this._stats.deduplicated++;return this._rows.get(id)}
      const row=deepFreeze({
        id,kind,entityId,observedAt,sourceKind,evidenceId:evidenceId==='none'?null:evidenceId,
        value:stableValue(input.value),metadata:stableValue(input.metadata||{})
      });
      this._rows.set(id,row);this._stats.accepted++;
      this.prune(observedAt);this._enforceMax();return row;
    }
    tryAdd(input={}){
      try{return this.add(input)}catch(_){this._stats.rejected++;return null}
    }
    query({kind,entityId,from,to}={}){
      const a=finite(from),b=finite(to);
      return freeze([...this._rows.values()].filter(row=>
        (!kind||row.kind===kind)&&(!entityId||row.entityId===entityId)&&
        (a===null||row.observedAt>=a)&&(b===null||row.observedAt<=b)
      ).sort((x,y)=>x.observedAt-y.observedAt));
    }
    nearest(kind,entityId,targetAt,toleranceSec=DEFAULTS.outcomeToleranceSec){
      const target=finite(targetAt);if(target===null)return null;
      let best=null,bestDelta=Infinity;
      for(const row of this._rows.values()){
        if(row.kind!==kind||row.entityId!==entityId)continue;
        const delta=Math.abs(row.observedAt-target);
        if(delta<=toleranceSec&&delta<bestDelta){best=row;bestDelta=delta}
      }
      return best;
    }
    prune(now=Date.now()/1000){
      const cutoff=(finite(now)??Date.now()/1000)-this.options.retentionSec;
      let removed=0;
      for(const [id,row] of this._rows)if(row.observedAt<cutoff){this._rows.delete(id);removed++}
      this._stats.pruned+=removed;return removed;
    }
    _enforceMax(){
      const excess=this._rows.size-this.options.maxEntries;if(excess<=0)return;
      const oldest=[...this._rows.values()].sort((a,b)=>a.observedAt-b.observedAt).slice(0,excess);
      for(const row of oldest)this._rows.delete(row.id);
      this._stats.pruned+=oldest.length;
    }
    snapshot(now=Date.now()/1000){
      this.prune(now);
      return freeze({generatedAt:finite(now)??Date.now()/1000,entries:freeze([...this._rows.values()]),stats:freeze({...this._stats})});
    }
    clear(){this._rows.clear()}
  }

  function outcomeError(predicted,actual){
    if(Number.isFinite(Number(predicted))&&Number.isFinite(Number(actual)))
      return freeze({metric:'absolute_error',value:Math.abs(Number(predicted)-Number(actual))});
    if(predicted&&actual&&typeof predicted==='object'&&typeof actual==='object'&&
       finite(predicted.lat)!==null&&finite(predicted.lon)!==null&&finite(actual.lat)!==null&&finite(actual.lon)!==null)
      return freeze({metric:'spatial_error_m',value:haversineM(predicted,actual)});
    if(['string','boolean'].includes(typeof predicted)&&typeof predicted===typeof actual)
      return freeze({metric:'classification_correct',value:predicted===actual?1:0});
    return freeze({metric:'unscored',value:null});
  }

  class OutcomeResolver{
    constructor({truthStore,toleranceSec,maxOutcomes}={}){
      if(!truthStore)throw new Error('OutcomeResolver: truthStore richiesto');
      this.truthStore=truthStore;
      this.toleranceSec=finite(toleranceSec)??DEFAULTS.outcomeToleranceSec;
      this.maxOutcomes=Math.max(1,Number(maxOutcomes)||DEFAULTS.maxOutcomes);
      this._resolved=new Set();this._outcomes=[];
    }
    resolve(predictionSnapshot){
      const settled=[];
      for(const prediction of predictionSnapshot?.entries||[]){
        if(this._resolved.has(prediction.id))continue;
        const tolerance=finite(prediction.outcomeToleranceSec)??this.toleranceSec;
        const truth=this.truthStore.nearest(prediction.truthKind,prediction.entityId,prediction.targetAt,tolerance);
        if(!truth)continue;
        const error=outcomeError(prediction.value,truth.value);
        const row=deepFreeze({
          id:'outcome|'+prediction.id,
          predictionId:prediction.id,task:prediction.task,entityId:prediction.entityId,
          modelVersion:prediction.modelVersion,confidence:prediction.confidence,
          generatedAt:prediction.generatedAt,targetAt:prediction.targetAt,horizonSec:prediction.horizonSec,
          truthId:truth.id,truthObservedAt:truth.observedAt,truthSourceKind:truth.sourceKind,
          outcomeLagSec:truth.observedAt-prediction.targetAt,
          error
        });
        this._resolved.add(prediction.id);this._outcomes.push(row);settled.push(row);
      }
      if(this._outcomes.length>this.maxOutcomes)this._outcomes.splice(0,this._outcomes.length-this.maxOutcomes);
      return freeze(settled);
    }
    snapshot(){return freeze({entries:freeze([...this._outcomes]),resolvedPredictions:this._resolved.size})}
    clear(){this._resolved.clear();this._outcomes.length=0}
  }

  function metricAggregate(){
    return {count:0,sum:0,min:Infinity,max:-Infinity};
  }
  function addMetric(aggregate,value){
    const n=finite(value);if(n===null)return;
    aggregate.count++;aggregate.sum+=n;aggregate.min=Math.min(aggregate.min,n);aggregate.max=Math.max(aggregate.max,n);
  }
  function freezeAggregate(row){
    const metrics={};
    for(const [name,a] of Object.entries(row.metrics))metrics[name]=freeze({
      count:a.count,mean:a.count?a.sum/a.count:null,min:a.count?a.min:null,max:a.count?a.max:null
    });
    return deepFreeze({...row,metrics});
  }

  class CompactHistoryStore{
    constructor(options={}){
      this.options={
        retentionSec:DEFAULTS.historyRetentionSec,
        compactAfterSec:DEFAULTS.historyCompactAfterSec,
        bucketSec:DEFAULTS.historyBucketSec,
        maxEntries:DEFAULTS.maxHistoryEntries,
        maxCompactBuckets:DEFAULTS.maxCompactBuckets,
        ...options
      };
      this._raw=[];this._compact=new Map();this._stats={recorded:0,compacted:0,pruned:0,rejected:0};
    }
    record(input={}){
      let sourceKind;
      try{sourceKind=assertVerifiedSource(input.sourceKind)}catch(error){this._stats.rejected++;throw error}
      const scope=text(input.scope),key=text(input.key),at=finite(input.at);
      if(!['vehicle','trip','segment'].includes(scope)||!key||at===null)
        throw new Error('CompactHistoryStore: scope vehicle/trip/segment, key e at richiesti');
      const metrics={};
      for(const [name,value] of Object.entries(input.metrics||{})){
        const n=finite(value);if(n!==null)metrics[name]=n;
      }
      const row=deepFreeze({scope,key,at,sourceKind,metrics,metadata:stableValue(input.metadata||{})});
      this._raw.push(row);this._stats.recorded++;
      this.compact(at);this._enforceMax();return row;
    }
    compact(now=Date.now()/1000){
      const ts=finite(now)??Date.now()/1000,compactCutoff=ts-this.options.compactAfterSec,retentionCutoff=ts-this.options.retentionSec;
      const keep=[];
      for(const row of this._raw){
        if(row.at<retentionCutoff){this._stats.pruned++;continue}
        if(row.at>=compactCutoff){keep.push(row);continue}
        const bucketStart=Math.floor(row.at/this.options.bucketSec)*this.options.bucketSec;
        const id=[row.scope,row.key,bucketStart].join('|');
        let bucket=this._compact.get(id);
        if(!bucket){
          bucket={id,scope:row.scope,key:row.key,bucketStart,bucketSec:this.options.bucketSec,count:0,metrics:{}};
          this._compact.set(id,bucket);
        }
        bucket.count++;
        for(const [name,value] of Object.entries(row.metrics)){
          if(!bucket.metrics[name])bucket.metrics[name]=metricAggregate();
          addMetric(bucket.metrics[name],value);
        }
        this._stats.compacted++;
      }
      this._raw=keep;
      for(const [id,bucket] of this._compact){
        if(bucket.bucketStart+bucket.bucketSec<retentionCutoff){this._compact.delete(id);this._stats.pruned++}
      }
      if(this._compact.size>this.options.maxCompactBuckets){
        const drop=[...this._compact.values()].sort((a,b)=>a.bucketStart-b.bucketStart).slice(0,this._compact.size-this.options.maxCompactBuckets);
        for(const row of drop){this._compact.delete(row.id);this._stats.pruned++}
      }
      return this.snapshot(false);
    }
    _enforceMax(){
      const excess=this._raw.length-this.options.maxEntries;
      if(excess>0){this._raw.splice(0,excess);this._stats.pruned+=excess}
    }
    snapshot(runCompact=true){
      if(runCompact)this.compact(Date.now()/1000);
      return freeze({
        raw:freeze([...this._raw]),
        compact:freeze([...this._compact.values()].sort((a,b)=>a.bucketStart-b.bucketStart).map(freezeAggregate)),
        stats:freeze({...this._stats}),
        policy:freeze({...this.options})
      });
    }
    clear(){this._raw.length=0;this._compact.clear()}
  }

  function horizonKey(horizonSec,horizons){
    const h=finite(horizonSec);if(h===null)return 'other';
    for(const target of horizons)if(Math.abs(h-target)<=Math.max(15,target*.1))return String(target);
    return 'other';
  }
  function metricValue(outcome){
    const v=finite(outcome?.error?.value);return v;
  }

  class EvaluationStore{
    constructor(options={}){
      this.options={maxEntries:DEFAULTS.maxOutcomes,horizonsSec:[...DEFAULTS.horizonsSec],...options};
      this._rows=[];this._ids=new Set();
    }
    ingest(outcomes){
      let added=0;
      for(const row of outcomes||[]){
        if(!row?.id||this._ids.has(row.id))continue;
        this._ids.add(row.id);this._rows.push(row);added++;
      }
      if(this._rows.length>this.options.maxEntries){
        const removed=this._rows.splice(0,this._rows.length-this.options.maxEntries);
        for(const row of removed)this._ids.delete(row.id);
      }
      return added;
    }
    _summary(rows){
      const scored=rows.filter(x=>metricValue(x)!==null);
      const numeric=scored.filter(x=>x.error.metric==='absolute_error'||x.error.metric==='spatial_error_m');
      const classes=scored.filter(x=>x.error.metric==='classification_correct');
      const calibrated=classes.filter(x=>finite(x.confidence)!==null);
      return freeze({
        outcomes:rows.length,scored:scored.length,
        meanError:rounded(mean(numeric.map(metricValue))),
        classificationAccuracy:classes.length?rounded(mean(classes.map(metricValue)),4):null,
        brierScore:calibrated.length?rounded(mean(calibrated.map(x=>(Number(x.confidence)-Number(x.error.value))**2)),4):null
      });
    }
    summary(){
      const byModel={},byHorizon={};
      for(const target of this.options.horizonsSec)byHorizon[String(target)]=[];
      byHorizon.other=[];
      for(const row of this._rows){
        (byModel[row.modelVersion]||(byModel[row.modelVersion]=[])).push(row);
        byHorizon[horizonKey(row.horizonSec,this.options.horizonsSec)].push(row);
      }
      return freeze({
        total:this._summary(this._rows),
        byModel:freeze(Object.fromEntries(Object.entries(byModel).map(([k,v])=>[k,this._summary(v)]))),
        byHorizonSec:freeze(Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,this._summary(v)])))
      });
    }
    compare(activeVersion,candidateVersion,task=null){
      const activeRows=this._rows.filter(x=>x.modelVersion===activeVersion&&(!task||x.task===task));
      const candidateRows=this._rows.filter(x=>x.modelVersion===candidateVersion&&(!task||x.task===task));
      const active=this._summary(activeRows),candidate=this._summary(candidateRows);
      const activeMean=finite(active.meanError),candidateMean=finite(candidate.meanError);
      return freeze({
        task:task||null,activeVersion,candidateVersion,active,candidate,
        ready:active.scored>0&&candidate.scored>0,
        meanErrorDelta:activeMean!==null&&candidateMean!==null?rounded(candidateMean-activeMean):null,
        brierDelta:finite(active.brierScore)!==null&&finite(candidate.brierScore)!==null
          ?rounded(candidate.brierScore-active.brierScore,4):null
      });
    }
    clear(){this._rows.length=0;this._ids.clear()}
  }

  class ModelRegistry{
    constructor(){
      this._models=new Map();this._enabled=true;this._killSwitch=false;this._killReason=null;this._history=[];
    }
    register(input={}){
      const task=text(input.task),version=text(input.version),kind=text(input.kind)||'learned',status=text(input.status)||'candidate';
      if(!task||!version||!MODEL_KINDS.has(kind)||!MODEL_STATUSES.has(status))
        throw new Error('ModelRegistry: task/version/kind/status non validi');
      const key=task+'@'+version;
      if(this._models.has(key))return this._models.get(key);
      if(status==='active'&&[...this._models.values()].some(x=>x.task===task&&x.status==='active'))
        throw new Error('ModelRegistry: esiste già un modello active per '+task);
      const row=deepFreeze({
        task,version,key,kind,status,
        featureSchemaId:text(input.featureSchemaId)||null,
        featureSchemaVersion:text(input.featureSchemaVersion)||null,
        createdAt:finite(input.createdAt)??Date.now()/1000,
        metadata:stableValue(input.metadata||{})
      });
      this._models.set(key,row);return row;
    }
    _replace(row,status,metadata){
      const next=deepFreeze({...row,status,metadata:stableValue({...row.metadata,...(metadata||{})})});
      this._models.set(row.key,next);return next;
    }
    _event(type,payload={}){
      const row=deepFreeze({type,at:finite(payload.at)??Date.now()/1000,...payload});
      this._history.push(row);
      if(this._history.length>500)this._history.shift();
      return row;
    }
    resolve(task){
      if(!this._enabled||this._killSwitch)return null;
      return [...this._models.values()].find(x=>x.task===task&&x.status==='active')||null;
    }
    candidate(task){
      return [...this._models.values()].find(x=>x.task===task&&(x.status==='candidate'||x.status==='shadow'))||null;
    }
    setShadow(task,version,{reason='shadow-evaluation',at}={}){
      const row=this._models.get(text(task)+'@'+text(version));
      if(!row||!['candidate','shadow'].includes(row.status))throw new Error('ModelRegistry: candidate non disponibile');
      const next=this._replace(row,'shadow',{shadowSince:finite(at)??Date.now()/1000});
      this._event('shadow',{task:row.task,version:row.version,reason:text(reason),at});
      return next;
    }
    promote(task,version,{reason='explicit-promotion',at}={}){
      task=text(task);version=text(version);
      if(!this._enabled||this._killSwitch)throw new Error('ModelRegistry: promotion bloccata da learning disabled/kill switch');
      const target=this._models.get(task+'@'+version);
      if(!target||target.status!=='shadow')throw new Error('ModelRegistry: solo un modello shadow può essere promosso');
      const active=[...this._models.values()].find(x=>x.task===task&&x.status==='active')||null;
      if(active)this._replace(active,'retired',{retiredAt:finite(at)??Date.now()/1000,replacedBy:version});
      const promoted=this._replace(target,'active',{activatedAt:finite(at)??Date.now()/1000,previousActiveVersion:active?.version||null});
      this._event('promote',{task,fromVersion:active?.version||null,toVersion:version,reason:text(reason),at});
      return promoted;
    }
    rollback(task,{toVersion,reason='explicit-rollback',at}={}){
      task=text(task);
      const current=[...this._models.values()].find(x=>x.task===task&&x.status==='active')||null;
      let target=toVersion?this._models.get(task+'@'+text(toVersion)):null;
      if(!target){
        const prior=[...this._history].reverse().find(x=>x.type==='promote'&&x.task===task&&x.toVersion===current?.version&&x.fromVersion);
        if(prior)target=this._models.get(task+'@'+prior.fromVersion)||null;
      }
      if(!target)target=[...this._models.values()].find(x=>x.task===task&&x.kind==='deterministic')||null;
      if(!target)throw new Error('ModelRegistry: nessun target di rollback per '+task);
      if(current&&current.key!==target.key)this._replace(current,'retired',{retiredAt:finite(at)??Date.now()/1000,rollbackReason:text(reason)});
      const restored=this._replace(target,'active',{restoredAt:finite(at)??Date.now()/1000});
      this._event('rollback',{task,fromVersion:current?.version||null,toVersion:target.version,reason:text(reason),at});
      return restored;
    }
    setEnabled(enabled){this._enabled=!!enabled}
    kill(reason='manual'){this._killSwitch=true;this._killReason=text(reason)||'manual'}
    restore(){this._killSwitch=false;this._killReason=null}
    snapshot(){
      return freeze({
        enabled:this._enabled,killSwitch:this._killSwitch,killReason:this._killReason,
        models:freeze([...this._models.values()]),
        active:freeze([...this._models.values()].filter(x=>x.status==='active')),
        candidates:freeze([...this._models.values()].filter(x=>x.status==='candidate'||x.status==='shadow')),
        history:freeze([...this._history])
      });
    }
  }

  class PromotionPolicy{
    constructor({evaluationStore,modelRegistry,healthProvider,options}={}){
      if(!evaluationStore||!modelRegistry)throw new Error('PromotionPolicy: evaluationStore/modelRegistry richiesti');
      this.evaluationStore=evaluationStore;this.modelRegistry=modelRegistry;
      this.healthProvider=typeof healthProvider==='function'?healthProvider:()=>({status:'healthy'});
      this.options={minScored:30,maxMeanErrorRegressionPct:0,maxBrierRegression:.005,...(options||{})};
    }
    evaluate(task){
      task=text(task);
      const state=this.modelRegistry.snapshot(),active=state.active.find(x=>x.task===task)||null;
      const candidate=state.candidates.find(x=>x.task===task&&x.status==='shadow')||null;
      const comparison=active&&candidate?this.evaluationStore.compare(active.version,candidate.version,task):null;
      const health=this.healthProvider()||{},reasons=[];
      if(!state.enabled)reasons.push('learning_disabled');
      if(state.killSwitch)reasons.push('kill_switch');
      if(health.status&&health.status!=='healthy')reasons.push('health_'+health.status);
      if(!active)reasons.push('active_missing');
      if(!candidate)reasons.push('shadow_missing');
      if(!comparison?.ready)reasons.push('comparison_not_ready');
      if(comparison?.active?.scored<this.options.minScored||comparison?.candidate?.scored<this.options.minScored)reasons.push('insufficient_samples');
      const activeMean=finite(comparison?.active?.meanError),candidateMean=finite(comparison?.candidate?.meanError);
      if(activeMean!==null&&candidateMean!==null&&candidateMean>activeMean*(1+this.options.maxMeanErrorRegressionPct))
        reasons.push('mean_error_regression');
      const activeBrier=finite(comparison?.active?.brierScore),candidateBrier=finite(comparison?.candidate?.brierScore);
      if(activeBrier!==null&&candidateBrier!==null&&candidateBrier-activeBrier>this.options.maxBrierRegression)
        reasons.push('calibration_regression');
      return freeze({task,eligible:reasons.length===0,reasons:freeze(reasons),active,candidate,comparison,health:freeze({...health})});
    }
    promote(task,{reason='policy-approved',at}={}){
      const verdict=this.evaluate(task);
      if(!verdict.eligible)throw new Error('PromotionPolicy: promotion non eleggibile: '+verdict.reasons.join(','));
      return this.modelRegistry.promote(task,verdict.candidate.version,{reason,at});
    }
    rollback(task,options={}){return this.modelRegistry.rollback(task,options)}
  }

  class LearningLayer{
    constructor(options={}){
      this.options={...DEFAULTS,...options};
      this.schemas=new FeatureSchemaRegistry();
      this.predictions=new PredictionLog({retentionSec:this.options.predictionRetentionSec,maxEntries:this.options.maxPredictions});
      this.truth=new GroundTruthStore({retentionSec:this.options.truthRetentionSec,maxEntries:this.options.maxTruthEntries});
      this.outcomes=new OutcomeResolver({truthStore:this.truth,toleranceSec:this.options.outcomeToleranceSec,maxOutcomes:this.options.maxOutcomes});
      this.history=new CompactHistoryStore({
        retentionSec:this.options.historyRetentionSec,compactAfterSec:this.options.historyCompactAfterSec,
        bucketSec:this.options.historyBucketSec,maxEntries:this.options.maxHistoryEntries,maxCompactBuckets:this.options.maxCompactBuckets
      });
      this.evaluation=new EvaluationStore({horizonsSec:this.options.horizonsSec,maxEntries:this.options.maxOutcomes});
      this.models=new ModelRegistry();
      this.schemas.register({id:'transit-deterministic',version:'1',features:{
        confidence:{type:'number'},horizonSec:{type:'number'},routeId:{type:'string',required:false}
      }});
      for(const row of [
        {task:'eta_position',version:'deterministic-motion-v1'},
        {task:'eta_arrival',version:'deterministic-schedule-eta-v1'},
        {task:'trip_match',version:'deterministic-trip-match-v1'},
        {task:'missing_trip',version:'deterministic-missing-trip-v1'}
      ])this.models.register({...row,kind:'deterministic',status:'active',featureSchemaId:'transit-deterministic',featureSchemaVersion:'1'});
      this.promotion=new PromotionPolicy({
        evaluationStore:this.evaluation,modelRegistry:this.models,
        healthProvider:()=>this.health(Date.now()/1000)
      });
      this._officialTimingIds=new Set();
      this._stats={snapshotsObserved:0,observerErrors:0,predictionsObserved:0,truthObserved:0,outcomesSettled:0,officialTimingSamples:0};
    }
    setEnabled(enabled){this.models.setEnabled(enabled)}
    kill(reason){this.models.kill(reason)}
    restore(){this.models.restore()}
    promotionVerdict(task){return this.promotion.evaluate(task)}
    promote(task,options){return this.promotion.promote(task,options)}
    rollback(task,options){return this.promotion.rollback(task,options)}
    comparisons(){
      const state=this.models.snapshot(),out={};
      for(const candidate of state.candidates){
        const active=state.active.find(x=>x.task===candidate.task);
        if(!active)continue;
        out[candidate.task]=this.evaluation.compare(active.version,candidate.version,candidate.task);
      }
      return freeze(out);
    }
    health(now=Date.now()/1000){
      const modelState=this.models.snapshot();
      const predictionState=this.predictions.snapshot(now),outcomeState=this.outcomes.snapshot();
      const unresolved=Math.max(0,predictionState.entries.length-outcomeState.resolvedPredictions);
      const status=modelState.killSwitch?'killed':this._stats.observerErrors>0?'degraded':'healthy';
      return freeze({
        status,enabled:modelState.enabled,killSwitch:modelState.killSwitch,
        observerErrors:this._stats.observerErrors,
        snapshotsObserved:this._stats.snapshotsObserved,
        unresolvedPredictions:unresolved,
        settledOutcomes:outcomeState.entries.length,
        groundTruthEntries:this.truth.snapshot(now).entries.length,
        compactHistoryBuckets:this.history.snapshot(false).compact.length
      });
    }
    _strongOfficialResolution(resolution){
      if(!resolution?.matched||finite(resolution.confidence)<.99)return false;
      if(resolution.classification==='exact')return true;
      return (resolution.evidence||[]).some(e=>e?.type==='trip_id_exact'||e?.type==='trip_id_cross_generation');
    }
    _ingestOfficialStopTimes(observations,resolutions){
      const byObservation=new Map((resolutions||[]).map(r=>[r?.observationId,r]));
      for(const observation of observations||[]){
        if(observation?.kind!=='trip_update'||!Array.isArray(observation.stopTimeUpdates))continue;
        const resolution=byObservation.get(observation.id);
        if(!this._strongOfficialResolution(resolution))continue;
        const tripInstanceId=text(resolution.tripInstanceId),routeId=text(resolution.routeId)||'route';
        if(!tripInstanceId)continue;
        const updates=observation.stopTimeUpdates;
        for(let i=0;i<updates.length;i++){
          const current=updates[i],stopId=text(current?.stopId);
          const arrival=finite(current?.arrival?.time),departure=finite(current?.departure?.time);
          if(stopId&&arrival!==null){
            const id='arrival|'+observation.id+'|'+stopId+'|'+arrival;
            if(!this._officialTimingIds.has(id)){
              this._officialTimingIds.add(id);
              const truth=this.truth.tryAdd({
                kind:'arrival_time',entityId:tripInstanceId+'|'+stopId,observedAt:arrival,
                sourceKind:'official_realtime',evidenceId:observation.id,value:arrival,
                metadata:{routeId,tripInstanceId,stopId}
              });
              if(truth)this._stats.truthObserved++;
            }
          }
          if(i===0)continue;
          const previous=updates[i-1],prevStopId=text(previous?.stopId);
          const prevDeparture=finite(previous?.departure?.time);
          if(!prevStopId||!stopId||prevDeparture===null||arrival===null)continue;
          const travelTimeSec=arrival-prevDeparture;
          if(travelTimeSec<5||travelTimeSec>7200)continue;
          const dwellTimeSec=departure!==null&&departure>=arrival&&departure-arrival<=3600?departure-arrival:null;
          const segmentKey=[routeId,prevStopId,stopId].join('|');
          const sampleId='segment|'+observation.id+'|'+segmentKey+'|'+prevDeparture+'|'+arrival;
          if(this._officialTimingIds.has(sampleId))continue;
          this._officialTimingIds.add(sampleId);
          const metrics={travelTimeSec};if(dwellTimeSec!==null)metrics.dwellTimeSec=dwellTimeSec;
          this.history.record({
            scope:'segment',key:segmentKey,at:arrival,sourceKind:'official_realtime',metrics,
            metadata:{tripInstanceId,fromStopId:prevStopId,toStopId:stopId,measurement:'gtfs_rt_actual'}
          });
          this.truth.tryAdd({
            kind:'segment_travel_time',entityId:segmentKey,observedAt:arrival,
            sourceKind:'official_realtime',evidenceId:observation.id,value:travelTimeSec,
            metadata:{tripInstanceId,fromStopId:prevStopId,toStopId:stopId}
          });
          if(dwellTimeSec!==null)this.truth.tryAdd({
            kind:'segment_dwell_time',entityId:segmentKey,observedAt:departure,
            sourceKind:'official_realtime',evidenceId:observation.id,value:dwellTimeSec,
            metadata:{tripInstanceId,toStopId:stopId}
          });
          this._stats.officialTimingSamples++;
          if(this._officialTimingIds.size>20000){
            const first=this._officialTimingIds.values().next().value;
            this._officialTimingIds.delete(first);
          }
        }
      }
    }
    observeTransitSnapshot(snapshot,{observations,resolutions}={}){
      const before=JSON.stringify(snapshot);
      const now=finite(snapshot?.generatedAt)??Date.now()/1000;
      if(!snapshot||!Array.isArray(snapshot.tripStates))throw new Error('LearningLayer: TransitState snapshot non valido');
      this._stats.snapshotsObserved++;
      if(!this.models.snapshot().enabled||this.models.snapshot().killSwitch)return this.summary(now);
      try{
        this._ingestOfficialStopTimes(observations,resolutions);
        for(const row of snapshot.tripStates){
          const motion=row.motion||{},position=motion.position?.value;
          if(row.motionMode==='predicted_live'&&position){
            const generatedAt=finite(motion.generatedAt??snapshot.generatedAt)??now;
            const anchorAt=finite(motion.predictedFromObservedAt);
            const horizonSec=anchorAt===null?0:Math.max(0,generatedAt-anchorAt);
            this.predictions.append({
              task:'eta_position',truthKind:'position',entityId:row.tripInstanceId,
              modelVersion:'deterministic-motion-v1',generatedAt,targetAt:generatedAt,horizonSec,
              confidence:motion.position?.confidence??0,value:{lat:position.lat,lon:position.lon},
              featureSchemaId:'transit-deterministic',featureSchemaVersion:'1',
              features:{confidence:Number(motion.position?.confidence)||0,horizonSec,routeId:row.routeId||''},
              metadata:{routeId:row.routeId||null,network:row.network||snapshot.network||null}
            });
            this._stats.predictionsObserved++;
          }
          if(row.motionMode==='live'&&position){
            const observedAt=finite(motion.position?.observedAt??row.freshestObservedAt);
            if(observedAt!==null){
              const truth=this.truth.tryAdd({
                kind:'position',entityId:row.tripInstanceId,observedAt,sourceKind:'observed_live',
                evidenceId:motion.anchorObservationId||motion.position?.details?.observationId||null,
                value:{lat:position.lat,lon:position.lon},metadata:{routeId:row.routeId||null}
              });
              if(truth)this._stats.truthObserved++;
              this.truth.tryAdd({
                kind:'missing_trip',entityId:row.tripInstanceId,observedAt,sourceKind:'observed_live',
                evidenceId:motion.anchorObservationId||motion.position?.details?.observationId||null,
                value:false,metadata:{routeId:row.routeId||null}
              });
              const delay=finite(row.delay?.value),progress=finite(row.shapeProgress?.value);
              const metrics={};if(delay!==null)metrics.delaySec=delay;if(progress!==null)metrics.shapeProgress=progress;
              if(Object.keys(metrics).length)this.history.record({scope:'trip',key:row.tripInstanceId,at:observedAt,sourceKind:'observed_live',metrics,metadata:{routeId:row.routeId||null}});
              const prev=row.expectedState?.previousStop?.stopId||row.expectedState?.previousStop?.id;
              const next=row.expectedState?.nextStop?.stopId||row.expectedState?.nextStop?.id;
              if(prev&&next&&Object.keys(metrics).length)this.history.record({
                scope:'segment',key:[row.routeId||'route',prev,next].join('|'),at:observedAt,sourceKind:'observed_live',metrics,
                metadata:{tripInstanceId:row.tripInstanceId}
              });
            }
          }
          if(row.status==='cancelled'&&(row.observationIds||[]).length){
            this.truth.tryAdd({
              kind:'missing_trip',entityId:row.tripInstanceId,observedAt:now,sourceKind:'official_realtime',
              evidenceId:row.observationIds[0],value:true,metadata:{routeId:row.routeId||null,reason:'official_cancellation'}
            });
          }
        }
        const settled=this.outcomes.resolve(this.predictions.snapshot(now));
        this._stats.outcomesSettled+=settled.length;this.evaluation.ingest(settled);
      }catch(error){
        this._stats.observerErrors++;
      }
      if(JSON.stringify(snapshot)!==before)throw new Error('LearningLayer: TransitState mutato dal learning observer');
      return this.summary(now);
    }
    summary(now=Date.now()/1000){
      const modelState=this.models.snapshot();
      return freeze({
        generatedAt:finite(now)??Date.now()/1000,
        enabled:modelState.enabled,killSwitch:modelState.killSwitch,killReason:modelState.killReason,
        stats:freeze({...this._stats}),
        models:modelState,
        predictionLog:freeze({...this.predictions.snapshot(now).stats,entries:this.predictions.snapshot(now).entries.length}),
        groundTruth:freeze({...this.truth.snapshot(now).stats,entries:this.truth.snapshot(now).entries.length}),
        outcomes:freeze({entries:this.outcomes.snapshot().entries.length}),
        history:freeze({
          raw:this.history.snapshot(false).raw.length,compact:this.history.snapshot(false).compact.length,
          stats:this.history.snapshot(false).stats,policy:this.history.snapshot(false).policy
        }),
        evaluation:this.evaluation.summary(),
        comparisons:this.comparisons(),
        health:this.health(now),
        promotion:freeze(Object.fromEntries(modelState.candidates.map(row=>[row.task,this.promotion.evaluate(row.task)]))),
        featureSchemas:this.schemas.snapshot()
      });
    }
  }

  function createLearningLayer(options){return new LearningLayer(options)}

  global.UVTransitLearning=freeze({
    DEFAULTS,VERIFIED_SOURCES,
    FeatureSchemaRegistry,PredictionLog,GroundTruthStore,OutcomeResolver,CompactHistoryStore,
    EvaluationStore,ModelRegistry,PromotionPolicy,LearningLayer,createLearningLayer,
    _test:freeze({haversineM,outcomeError,horizonKey,assertVerifiedSource})
  });
})(window);
