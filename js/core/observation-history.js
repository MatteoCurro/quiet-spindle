/* U.Venice Transport — bounded provider-neutral normalized Observation history.
   Keeps deduplicated canonical provider observations for diagnostics/replay support.
   Driver/device GPS is rejected by construction and never enters transit history. */
(function(global){
  'use strict';

  const freeze=o=>Object.freeze(o);
  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const DEFAULTS=freeze({
    retentionSec:1800,
    maxEntries:12000,
    maxBatches:240
  });

  function isPrivateDeviceObservation(o){
    return o?.provenance?.format==='driver-gps'||o?.details?.sourceKind==='driver_device';
  }

  function observationTime(o){
    return finite(o?.observedAt)??finite(o?.receivedAt)??0;
  }

  function safeRecord(record){
    return freeze({
      observation:record.observation,
      firstReceivedAt:record.firstReceivedAt,
      lastReceivedAt:record.lastReceivedAt,
      seenCount:record.seenCount
    });
  }

  class ObservationHistorySnapshot{
    constructor({provider,network,generatedAt,entries,batches,stats}){
      this.provider=provider||null;
      this.network=network||null;
      this.generatedAt=generatedAt;
      this.entries=freeze(entries);
      this.batches=freeze(batches);
      this.stats=freeze({...stats});
      Object.freeze(this);
    }
    summary(){
      const kinds={};
      for(const row of this.entries){
        const kind=row.observation?.kind||'unknown';
        kinds[kind]=(kinds[kind]||0)+1;
      }
      return freeze({
        provider:this.provider,network:this.network,generatedAt:this.generatedAt,
        entries:this.entries.length,batches:this.batches.length,
        kinds:freeze(kinds),
        ingested:this.stats.ingested,
        deduplicated:this.stats.deduplicated,
        rejectedPrivate:this.stats.rejectedPrivate,
        pruned:this.stats.pruned
      });
    }
    query(filters={}){
      const from=finite(filters.from),to=finite(filters.to),limit=Math.max(1,Number(filters.limit)||500);
      const rows=this.entries.filter(row=>{
        const o=row.observation||{},at=observationTime(o);
        return (!filters.kind||o.kind===filters.kind)&&
          (!filters.externalVehicleId||o.externalVehicleId===filters.externalVehicleId)&&
          (!filters.externalTripId||o.externalTripId===filters.externalTripId)&&
          (from===null||at>=from)&&(to===null||at<=to);
      });
      return freeze(rows.slice(Math.max(0,rows.length-limit)));
    }
  }

  class ObservationHistoryStore{
    constructor(options={}){
      this.options={...DEFAULTS,...options};
      this._records=new Map();
      this._batches=[];
      this._stats={ingested:0,deduplicated:0,rejectedPrivate:0,pruned:0};
      this.provider=null;this.network=null;
    }

    ingest(observations,{provider,network,receivedAt}={}){
      const now=finite(receivedAt)??Date.now()/1000;
      if(provider)this.provider=text(provider)||this.provider;
      if(network)this.network=text(network)||this.network;
      let added=0,updated=0,rejectedPrivate=0;
      const ids=[];
      for(const o of observations||[]){
        if(!o?.id)continue;
        if(isPrivateDeviceObservation(o)){rejectedPrivate++;continue}
        const id=text(o.id),seenAt=finite(o.receivedAt)??now;
        const previous=this._records.get(id);
        if(previous){
          previous.observation=o;
          previous.lastReceivedAt=Math.max(previous.lastReceivedAt,seenAt);
          previous.seenCount++;
          updated++;
        }else{
          this._records.set(id,{
            observation:o,
            firstReceivedAt:seenAt,
            lastReceivedAt:seenAt,
            seenCount:1
          });
          added++;
        }
        ids.push(id);
      }
      this._stats.ingested+=added;
      this._stats.deduplicated+=updated;
      this._stats.rejectedPrivate+=rejectedPrivate;
      this._batches.push(freeze({
        receivedAt:now,
        observations:ids.length,
        added,updated,rejectedPrivate,
        kinds:freeze((observations||[]).reduce((acc,o)=>{
          if(!o||isPrivateDeviceObservation(o))return acc;
          const k=o.kind||'unknown';acc[k]=(acc[k]||0)+1;return acc;
        },{}))
      }));
      while(this._batches.length>this.options.maxBatches)this._batches.shift();
      const pruned=this.prune(now);
      this._enforceMaxEntries();
      return freeze({added,updated,rejectedPrivate,pruned,summary:this.summary(now)});
    }

    prune(now=Date.now()/1000){
      const ts=finite(now)??Date.now()/1000,cutoff=ts-this.options.retentionSec;
      let removed=0;
      for(const [id,r] of this._records){
        if(r.lastReceivedAt<cutoff){this._records.delete(id);removed++}
      }
      while(this._batches.length&&this._batches[0].receivedAt<cutoff)this._batches.shift();
      this._stats.pruned+=removed;
      return removed;
    }

    _enforceMaxEntries(){
      const excess=this._records.size-this.options.maxEntries;
      if(excess<=0)return;
      const oldest=[...this._records.entries()]
        .sort((a,b)=>a[1].lastReceivedAt-b[1].lastReceivedAt)
        .slice(0,excess);
      for(const [id] of oldest)this._records.delete(id);
      this._stats.pruned+=oldest.length;
    }

    snapshot(now=Date.now()/1000){
      this.prune(now);
      const entries=[...this._records.values()]
        .sort((a,b)=>observationTime(a.observation)-observationTime(b.observation)||a.lastReceivedAt-b.lastReceivedAt)
        .map(safeRecord);
      return new ObservationHistorySnapshot({
        provider:this.provider,network:this.network,generatedAt:finite(now)??Date.now()/1000,
        entries,batches:[...this._batches],stats:{...this._stats}
      });
    }

    summary(now=Date.now()/1000){return this.snapshot(now).summary()}
    clear(){this._records.clear();this._batches.length=0}
  }

  function createObservationHistoryStore(options){return new ObservationHistoryStore(options)}

  global.UVTransitObservationHistory=freeze({
    DEFAULTS,ObservationHistoryStore,ObservationHistorySnapshot,createObservationHistoryStore,
    _test:freeze({isPrivateDeviceObservation,observationTime})
  });
})(window);
