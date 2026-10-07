/* U.Venice Transport — provider-neutral vehicle continuity/history store.
   Persists bounded vehicle identity history across full current-feed snapshots.
   It never makes retained vehicles live: presentInLatestFeed stays explicit and
   correlation expires independently from longer diagnostic retention. */
(function(global){
  'use strict';
  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS=Object.freeze({
    retentionTtlSec:1800,
    correlationTtlSec:180,
    maxHistory:12,
    maxTransitions:8,
    minCorrelationConfidence:.8
  });
  function key(provider,network,vehicleId){return text(provider)+'::'+text(network)+'::'+text(vehicleId)}
  function scopePrefix(provider,network){return text(provider)+'::'+text(network)+'::'}
  function copyPosition(position){return position&&Number.isFinite(Number(position.lat))&&Number.isFinite(Number(position.lon))?Object.freeze({lat:Number(position.lat),lon:Number(position.lon)}):null}
  function eventFrom(entry,at){
    return Object.freeze({
      at, status:entry.status||'unknown',
      tripInstanceId:entry.tripInstanceId||null, routeId:entry.routeId||null,
      position:copyPosition(entry.position),
      confidence:finite(entry.strongestResolution?.confidence)
    });
  }
  function freezeView(record,now,options){
    const age=Math.max(0,now-record.lastSeenAt);
    const corrAge=record.lastMatchedAt===null?null:Math.max(0,now-record.lastMatchedAt);
    return Object.freeze({
      vehicleId:record.vehicleId,provider:record.provider,network:record.network,
      firstSeenAt:record.firstSeenAt,lastSeenAt:record.lastSeenAt,
      presentInLatestFeed:!!record.presentInLatestFeed,status:record.status,
      routeId:record.routeId||null,lastPosition:copyPosition(record.lastPosition),
      lastMatchedTripInstanceId:record.lastMatchedTripInstanceId||null,
      lastMatchedRouteId:record.lastMatchedRouteId||null,
      lastMatchedAt:record.lastMatchedAt,
      lastMatchedConfidence:record.lastMatchedConfidence,
      ageSec:age,ttlRemainingSec:Math.max(0,options.retentionTtlSec-age),
      correlationAgeSec:corrAge,
      history:Object.freeze(record.history.map(x=>x)),
      transitions:Object.freeze(record.transitions.map(x=>Object.freeze({...x})))
    });
  }
  class VehicleContinuitySnapshot{
    constructor({provider,network,generatedAt,entries,options}){
      this.provider=provider||null;this.network=network||null;this.generatedAt=generatedAt;
      this.entries=Object.freeze(entries);this.options=Object.freeze({...options});
      this.byVehicleId=Object.freeze(Object.fromEntries(entries.map(x=>[x.vehicleId,x])));
      Object.freeze(this);
    }
    vehicle(id){return this.byVehicleId[text(id)]||null}
    current(){return this.entries.filter(x=>x.presentInLatestFeed)}
    retained(){return this.entries.filter(x=>!x.presentInLatestFeed)}
    summary(){
      return {
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        vehicles:this.entries.length,current:this.current().length,retained:this.retained().length,
        withMatchedHistory:this.entries.filter(x=>x.lastMatchedTripInstanceId).length,
        transitions:this.entries.reduce((n,x)=>n+x.transitions.length,0)
      };
    }
  }
  class VehicleContinuityStore{
    constructor(options){this.options={...DEFAULTS,...(options||{})};this.records=new Map()}
    prune(now){
      const ts=finite(now)??Date.now()/1000;
      let removed=0;
      for(const [k,r] of this.records){
        if(ts-r.lastSeenAt>this.options.retentionTtlSec){this.records.delete(k);removed++}
      }
      return removed;
    }
    ingest(registrySnapshot,{now}={}){
      if(!registrySnapshot||!Array.isArray(registrySnapshot.entries))throw new Error('VehicleContinuityStore: registry snapshot non valido');
      const provider=text(registrySnapshot.provider),network=text(registrySnapshot.network);
      const ts=finite(now)??finite(registrySnapshot.generatedAt)??Date.now()/1000;
      this.prune(ts);
      const prefix=scopePrefix(provider,network);
      for(const [k,r] of this.records)if(k.startsWith(prefix))r.presentInLatestFeed=false;
      for(const entry of registrySnapshot.entries){
        const vehicleId=text(entry.externalVehicleId||entry.vehicleId);
        if(!vehicleId||entry.anonymous)continue;
        const k=key(provider,network,vehicleId),seen=finite(entry.lastSeenAt)??ts;
        const prev=this.records.get(k)||null;
        const history=prev?[...prev.history]:[],transitions=prev?[...prev.transitions]:[];
        const ev=eventFrom(entry,seen),last=history.at(-1);
        if(!last||last.at!==ev.at||last.status!==ev.status||last.tripInstanceId!==ev.tripInstanceId||last.routeId!==ev.routeId)history.push(ev);
        while(history.length>this.options.maxHistory)history.shift();
        const matched=entry.status==='matched'&&!!entry.tripInstanceId;
        if(matched&&prev?.lastMatchedTripInstanceId&&prev.lastMatchedTripInstanceId!==entry.tripInstanceId){
          transitions.push(Object.freeze({at:seen,fromTripInstanceId:prev.lastMatchedTripInstanceId,toTripInstanceId:entry.tripInstanceId,routeId:entry.routeId||null}));
          while(transitions.length>this.options.maxTransitions)transitions.shift();
        }
        this.records.set(k,{
          provider,network,vehicleId,
          firstSeenAt:prev?.firstSeenAt??seen,lastSeenAt:Math.max(prev?.lastSeenAt??seen,seen),
          presentInLatestFeed:true,status:entry.status||'unknown',
          routeId:entry.routeId||null,lastPosition:entry.position?{...entry.position}:prev?.lastPosition||null,
          lastMatchedTripInstanceId:matched?entry.tripInstanceId:(prev?.lastMatchedTripInstanceId||null),
          lastMatchedRouteId:matched?(entry.routeId||null):(prev?.lastMatchedRouteId||null),
          lastMatchedAt:matched?seen:(prev?.lastMatchedAt??null),
          lastMatchedConfidence:matched?clamp(finite(entry.strongestResolution?.confidence)??1,0,1):(prev?.lastMatchedConfidence??null),
          history,transitions
        });
      }
      this.prune(ts);
      return this.snapshot(provider,network,{now:ts});
    }
    correlation(vehicleId,{provider,network,now}={}){
      const ts=finite(now)??Date.now()/1000;
      this.prune(ts);
      const r=this.records.get(key(provider,network,vehicleId));
      if(!r||!r.lastMatchedTripInstanceId||r.lastMatchedAt===null)return null;
      const age=Math.max(0,ts-r.lastMatchedAt);
      if(age>this.options.correlationTtlSec)return null;
      const confidence=finite(r.lastMatchedConfidence)??0;
      if(confidence<this.options.minCorrelationConfidence)return null;
      const decayed=clamp(confidence*(1-.25*(age/Math.max(1,this.options.correlationTtlSec))),0,1);
      return Object.freeze({
        tripInstanceId:r.lastMatchedTripInstanceId,routeId:r.lastMatchedRouteId||null,
        at:r.lastMatchedAt,ageSec:age,confidence:decayed,
        presentInLatestFeed:!!r.presentInLatestFeed,source:'vehicle_history_continuity'
      });
    }
    snapshot(provider,network,{now}={}){
      const ts=finite(now)??Date.now()/1000;this.prune(ts);
      const prefix=scopePrefix(provider,network),entries=[];
      for(const [k,r] of this.records)if(k.startsWith(prefix))entries.push(freezeView(r,ts,this.options));
      entries.sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId));
      return new VehicleContinuitySnapshot({provider:text(provider)||null,network:text(network)||null,generatedAt:ts,entries,options:this.options});
    }
    forget(provider,network,vehicleId){this.records.delete(key(provider,network,vehicleId))}
    clear(){this.records.clear()}
  }
  function createVehicleContinuityStore(options){return new VehicleContinuityStore(options)}
  global.UVTransitVehicleContinuity=Object.freeze({
    DEFAULTS,VehicleContinuitySnapshot,VehicleContinuityStore,createVehicleContinuityStore,
    _test:Object.freeze({key,scopePrefix,eventFrom})
  });
})(window);
