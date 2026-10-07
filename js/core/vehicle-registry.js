/* U.Venice Transport — provider-neutral current-feed Vehicle Registry.
   Keeps matched, route-only and unresolved vehicles as canonical entities.
   This module intentionally has no history/continuity TTL: each ingest replaces
   the current provider/network scope. Long-lived continuity is a separate layer. */
(function(global){
  'use strict';
  const text=v=>String(v??'').trim();
  const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const CLASS_RANK=Object.freeze({exact:7,trip_matched:6,vehicle_correlated:5,gps_shape_matched:4,gps_stop_matched:3,route_only:2,unknown:1});
  function immutableRows(rows){return Object.freeze((rows||[]).map(x=>Object.freeze({...x})))}
  function strongestResolution(rows){return [...(rows||[])].sort((a,b)=>(CLASS_RANK[b?.classification]||0)-(CLASS_RANK[a?.classification]||0)||(Number(b?.confidence)||0)-(Number(a?.confidence)||0))[0]||null}
  function observationTime(observation){return finite(observation?.observedAt)??finite(observation?.receivedAt)??0}
  function scopeKey(provider,network){return text(provider)+'::'+text(network)}
  function statusFor(rows,strongest){
    if(strongest?.matched)return 'matched';
    if(strongest?.classification==='route_only')return 'route_only';
    if((rows||[]).some(x=>text(x?.externalTripId)||text(x?.externalRouteId)))return 'service_unknown';
    return 'unknown';
  }
  function latestValue(rows,key){
    for(let i=(rows||[]).length-1;i>=0;i--){const value=text(rows[i]?.[key]);if(value)return value}
    return null;
  }
  class VehicleRegistrySnapshot{
    constructor({provider,network,generatedAt,entries}){
      this.provider=provider||null;this.network=network||null;
      this.generatedAt=finite(generatedAt)??Date.now()/1000;
      this.entries=Object.freeze([...(entries||[])].sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId)));
      this.byVehicleId=Object.freeze(Object.fromEntries(this.entries.map(x=>[x.vehicleId,x])));
      Object.freeze(this);
    }
    vehicle(id){return this.byVehicleId[text(id)]||null}
    byStatus(status){return this.entries.filter(x=>x.status===status)}
    unresolved(){return this.entries.filter(x=>x.status!=='matched')}
    summary(){
      const statuses={};for(const row of this.entries)statuses[row.status]=(statuses[row.status]||0)+1;
      return {provider:this.provider,network:this.network,generatedAt:this.generatedAt,vehicles:this.entries.length,unresolved:this.unresolved().length,statuses};
    }
  }
  class VehicleRegistry{
    constructor(){this.scopes=new Map()}
    build({provider,network,observations,resolutions,now}={}){
      provider=text(provider);network=text(network);
      const obs=(observations||[]).filter(x=>x&&x.kind!=='entity_deleted'&&(!provider||!x.provider||x.provider===provider)&&(!network||!x.network||x.network===network));
      const resolutionByObservation=new Map();
      for(const resolution of resolutions||[])if(resolution?.observationId)resolutionByObservation.set(resolution.observationId,resolution);
      const groups=new Map();
      for(const observation of obs){
        const vehicle=text(observation.externalVehicleId);
        if(!vehicle&&observation.kind!=='vehicle_position')continue;
        const key=vehicle||('anonymous:'+observation.id);
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(observation);
      }
      const entries=[];
      for(const [vehicleId,rows] of groups){
        rows.sort((a,b)=>observationTime(a)-observationTime(b)||text(a.id).localeCompare(text(b.id)));
        const relatedResolutions=rows.map(x=>resolutionByObservation.get(x.id)).filter(Boolean);
        const strongest=strongestResolution(relatedResolutions),latest=rows.at(-1);
        const positionRows=rows.filter(x=>x.position).sort((a,b)=>observationTime(a)-observationTime(b));
        const latestPosition=positionRows.at(-1)||null;
        entries.push(Object.freeze({
          vehicleId,externalVehicleId:text(latest.externalVehicleId)||null,anonymous:!text(latest.externalVehicleId),
          provider:text(latest.provider)||provider||null,network:text(latest.network)||network||null,
          status:statusFor(rows,strongest),tripInstanceId:strongest?.matched?(strongest.tripInstanceId||null):null,
          routeId:strongest?.routeId||latestValue(rows,'externalRouteId'),
          externalTripId:latestValue(rows,'externalTripId'),externalRouteId:latestValue(rows,'externalRouteId'),
          observationIds:Object.freeze(rows.map(x=>x.id)),resolutionClasses:Object.freeze(relatedResolutions.map(x=>x.classification)),
          firstSeenAt:observationTime(rows[0])||null,lastSeenAt:observationTime(latest)||null,
          position:latestPosition?.position?Object.freeze({...latestPosition.position}):null,
          bearing:latestPosition?.bearing??null,speed:latestPosition?.speed??null,
          strongestResolution:strongest?Object.freeze({classification:strongest.classification,confidence:Number(strongest.confidence)||0,tripInstanceId:strongest.tripInstanceId||null,routeId:strongest.routeId||null}):null,
          alternatives:immutableRows(strongest?.alternatives||[])
        }));
      }
      const snapshot=new VehicleRegistrySnapshot({provider:provider||null,network:network||null,generatedAt:finite(now)??Date.now()/1000,entries});
      return snapshot;
    }
    replace(args={}){
      const snapshot=this.build(args);
      this.scopes.set(scopeKey(snapshot.provider,snapshot.network),snapshot);
      return snapshot;
    }
    current(provider,network){return this.scopes.get(scopeKey(provider,network))||null}
    clear(provider,network){if(provider!==undefined||network!==undefined)this.scopes.delete(scopeKey(provider,network));else this.scopes.clear()}
  }
  function createVehicleRegistry(){return new VehicleRegistry()}
  global.UVTransitVehicleRegistry=Object.freeze({VehicleRegistrySnapshot,VehicleRegistry,createVehicleRegistry,_test:Object.freeze({strongestResolution,statusFor,observationTime})});
})(window);
