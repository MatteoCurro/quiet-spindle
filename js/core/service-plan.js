/* U.Venice Transport — provider-neutral ServicePlan / TripInstance model.
   Pure domain layer: no network, map, realtime or UI dependencies. */
(function(global){
  'use strict';

  const DAY_RE=/^\d{8}$/;
  const text=v=>String(v??'').trim();
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);

  function validDay(value){return DAY_RE.test(text(value))}

  function serviceDateBase(serviceDate,timezone){
    if(!validDay(serviceDate))throw new Error('ServicePlan: serviceDate non valida: '+serviceDate);
    timezone=timezone||'Europe/Rome';
    const y=+serviceDate.slice(0,4),m=+serviceDate.slice(4,6)-1,d=+serviceDate.slice(6,8);
    /* GTFS defines service-day time from "noon minus 12h", not from civil
       midnight. This keeps service seconds monotonic across DST transitions. */
    const desiredNoonUtc=Date.UTC(y,m,d,12,0,0);
    const formatter=new Intl.DateTimeFormat('en-GB',{
      timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    });
    let candidate=desiredNoonUtc;
    for(let i=0;i<4;i++){
      const p={};for(const x of formatter.formatToParts(new Date(candidate)))if(x.type!=='literal')p[x.type]=Number(x.value);
      const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
      const offset=represented-candidate,next=desiredNoonUtc-offset;
      if(Math.abs(next-candidate)<1000){candidate=next;break}
      candidate=next;
    }
    return candidate/1000-12*3600;
  }

  function localServiceDate(timestampSec,timezone){
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date(Number(timestampSec)*1000));
    const p={};for(const x of parts)if(x.type!=='literal')p[x.type]=x.value;
    return String(p.year)+String(p.month)+String(p.day);
  }

  function tripInstanceId(provider,network,serviceDate,tripId){
    return [text(provider)||'unknown',text(network)||'unknown',serviceDate,text(tripId)].join(':');
  }

  function routeMetaMap(core,schedule){
    const out=new Map();
    for(const r of core?.routes||[]){
      if(!r?.id)continue;
      out.set(text(r.id),{
        id:text(r.id),short:text(r.short),long:text(r.long),desc:text(r.desc),
        type:r.type??null,color:text(r.color),textColor:text(r.textColor)
      });
    }
    for(const r of schedule?.routes||[]){
      if(!Array.isArray(r)||!r[0]||out.has(text(r[0])))continue;
      out.set(text(r[0]),{id:text(r[0]),short:text(r[1]),long:'',desc:'',type:r[2]??null,color:'',textColor:''});
    }
    return out;
  }

  function stopMetaMap(core,schedule){
    const out=new Map();
    for(const s of core?.stops||[]){
      if(!s?.id)continue;
      out.set(text(s.id),{
        id:text(s.id),code:text(s.code),name:text(s.name),
        lat:num(s.lat),lon:num(s.lon),parentStation:text(s.parentStation),platformCode:text(s.platformCode)
      });
    }
    for(const s of schedule?.stops||[]){
      if(!Array.isArray(s)||!s[0]||out.has(text(s[0])))continue;
      out.set(text(s[0]),{
        id:text(s[0]),code:'',name:text(s[1]),lat:num(s[2]),lon:num(s[3]),
        parentStation:text(s[4]),platformCode:''
      });
    }
    return out;
  }

  function tripMetaMap(core){
    const out=new Map();
    for(const t of core?.trips||[])if(t?.id)out.set(text(t.id),t);
    return out;
  }

  function normalizeStops(rawStops,stopById,baseSec){
    const rows=[];
    for(const raw of rawStops||[]){
      if(!Array.isArray(raw)||!raw[0])continue;
      const arr=num(raw[2]),dep=num(raw[3]),seq=num(raw[1]);
      if(seq===null||arr===null||dep===null)continue;
      const id=text(raw[0]),meta=stopById.get(id)||{id,code:'',name:id,lat:null,lon:null,parentStation:'',platformCode:''};
      rows.push({
        id,sequence:seq,arrivalServiceSec:arr,departureServiceSec:dep,
        plannedArrival:baseSec+arr,plannedDeparture:baseSec+dep,
        pickup:!!raw[4],dropoff:!!raw[5],stop:meta
      });
    }
    rows.sort((a,b)=>a.sequence-b.sequence);
    return rows;
  }

  class ServicePlan{
    constructor({provider,network,timezone,instances,snapshotByDay}){
      this.provider=text(provider)||'unknown';
      this.network=text(network)||'unknown';
      this.timezone=text(timezone)||'Europe/Rome';
      this.snapshotByDay=Object.freeze({...snapshotByDay});
      this._instances=instances.slice().sort((a,b)=>a.plannedStart-b.plannedStart||a.id.localeCompare(b.id));
      this._starts=this._instances.map(x=>x.plannedStart);
      this._maxEndPrefix=[];
      let maxEnd=-Infinity;
      for(const instance of this._instances){maxEnd=Math.max(maxEnd,instance.plannedEnd);this._maxEndPrefix.push(maxEnd)}
      this.byId=new Map();
      this.byTripDay=new Map();
      this.byDate=new Map();
      this.byRoute=new Map();
      this.byStop=new Map();
      this.byBlock=new Map();
      for(const instance of this._instances){
        this.byId.set(instance.id,instance);
        this.byTripDay.set(instance.serviceDate+'|'+instance.tripId,instance);
        this._add(this.byDate,instance.serviceDate,instance);
        this._add(this.byRoute,instance.route.id,instance);
        for(const stopId of new Set(instance.stops.map(s=>s.id)))this._add(this.byStop,stopId,instance);
        if(instance.blockId)this._add(this.byBlock,instance.serviceDate+'|'+instance.blockId,instance);
      }
      this.vehicleDuties=this._buildDuties();
    }

    _add(map,key,value){
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(value);
    }

    _buildDuties(){
      const out=new Map();
      for(const [key,rows] of this.byBlock){
        rows.sort((a,b)=>a.plannedStart-b.plannedStart||a.id.localeCompare(b.id));
        const first=rows[0],blockId=first.blockId;
        const duty=Object.freeze({
          id:[this.provider,this.network,first.serviceDate,'block',blockId].join(':'),
          provider:this.provider,network:this.network,serviceDate:first.serviceDate,blockId,
          tripInstanceIds:Object.freeze(rows.map(x=>x.id)),
          plannedStart:rows[0].plannedStart,plannedEnd:rows.at(-1).plannedEnd
        });
        out.set(key,duty);
      }
      return out;
    }

    instances(){return this._instances.slice()}
    serviceDates(){return [...this.byDate.keys()].sort()}
    get(id){return this.byId.get(text(id))||null}
    getTrip(serviceDate,tripId){return this.byTripDay.get(text(serviceDate)+'|'+text(tripId))||null}
    forServiceDate(serviceDate){return (this.byDate.get(text(serviceDate))||[]).slice()}
    forRoute(routeId){return (this.byRoute.get(text(routeId))||[]).slice()}
    forStop(stopId){return (this.byStop.get(text(stopId))||[]).slice()}
    duty(serviceDate,blockId){return this.vehicleDuties.get(text(serviceDate)+'|'+text(blockId))||null}
    _upperBoundStart(timestampSec){
      let lo=0,hi=this._starts.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(this._starts[mid]<=timestampSec)lo=mid+1;else hi=mid}
      return lo;
    }
    _overlapping(left,right){
      const out=[];
      for(let i=this._upperBoundStart(right)-1;i>=0&&this._maxEndPrefix[i]>=left;i--){
        const x=this._instances[i];if(x.plannedEnd>=left)out.push(x);
      }
      return out.reverse();
    }
    activeAt(timestampSec){
      const ts=Number(timestampSec);
      return Number.isFinite(ts)?this._overlapping(ts,ts):[];
    }
    activeCountAt(timestampSec){return this.activeAt(timestampSec).length}
    around(timestampSec,beforeSec,afterSec){
      const ts=Number(timestampSec),before=Math.max(0,Number(beforeSec)||0),after=Math.max(0,Number(afterSec)||0);
      return Number.isFinite(ts)?this._overlapping(ts-before,ts+after):[];
    }
    summary(){
      return {
        provider:this.provider,network:this.network,timezone:this.timezone,
        serviceDates:this.serviceDates(),tripInstances:this._instances.length,
        vehicleDuties:this.vehicleDuties.size,snapshotByDay:{...this.snapshotByDay}
      };
    }
  }

  function createServicePlan({provider,network,core,schedule,shapes,coreBySnapshot}){
    provider=text(provider)||'unknown';network=text(network)||text(schedule?.network)||'unknown';
    if(!schedule||Number(schedule.schema)!==2||!schedule.chunksData)throw new Error('ServicePlan: schedule runtime non valido');
    if(!core||!Array.isArray(core.trips))throw new Error('ServicePlan: core runtime non valido');

    const timezone=text(schedule.timezone)||'Europe/Rome';
    const makeContext=source=>({
      routeById:routeMetaMap(source,schedule),
      stopById:stopMetaMap(source,schedule),
      tripById:tripMetaMap(source)
    });
    const defaultContext=makeContext(core),snapshotContexts=new Map();
    for(const [snapshotId,snapshotCore] of Object.entries(coreBySnapshot||{})){
      if(snapshotCore&&Array.isArray(snapshotCore.trips))snapshotContexts.set(text(snapshotId),makeContext(snapshotCore));
    }

    const instances=[];
    for(const serviceDate of Object.keys(schedule.chunksData).sort()){
      if(!validDay(serviceDate))continue;
      const chunk=schedule.chunksData[serviceDate];
      if(!Array.isArray(chunk?.trips))continue;
      const snapshotId=text(schedule.snapshotByDay?.[serviceDate]);
      const context=snapshotContexts.get(snapshotId)||defaultContext;
      const {routeById,stopById,tripById}=context;
      const baseSec=serviceDateBase(serviceDate,timezone);
      for(const row of chunk.trips){
        if(!Array.isArray(row)||row.length<5)continue;
        const tripId=text(row[0]),routeId=text(row[1]);
        if(!tripId||!routeId)continue;
        const meta=tripById.get(tripId)||{},route=routeById.get(routeId)||{id:routeId,short:routeId,long:'',desc:'',type:null,color:'',textColor:''};
        const stops=normalizeStops(row[4],stopById,baseSec);
        if(stops.length<2)continue;
        const first=stops[0],last=stops.at(-1),shape=text(row[3]||meta.shapeId),blockId=text(meta.blockId);
        const instance={
          id:tripInstanceId(provider,network,serviceDate,tripId),
          provider,network,serviceDate,tripId,route,
          serviceId:text(meta.serviceId)||null,
          direction:meta.directionId===undefined||meta.directionId===null||meta.directionId===''?null:String(meta.directionId),
          headsign:text(row[2]||meta.headsign),shape,blockId:blockId||null,
          plannedStart:first.plannedDeparture,plannedEnd:last.plannedArrival,
          plannedStartServiceSec:first.departureServiceSec,plannedEndServiceSec:last.arrivalServiceSec,
          stops:Object.freeze(stops),
          shapeProgressByStop:Object.freeze(stops.map(()=>null)),
          shapeProgressStatus:'unresolved',
          snapshotId:snapshotId||null
        };
        Object.freeze(instance.route);Object.freeze(instance);instances.push(instance);
      }
    }

    const seen=new Set();
    for(const instance of instances){
      if(seen.has(instance.id))throw new Error('ServicePlan: TripInstance duplicata '+instance.id);
      seen.add(instance.id);
    }
    return new ServicePlan({
      provider,network,timezone,instances,snapshotByDay:schedule.snapshotByDay||{}
    });
  }

  global.UVTransitServicePlan=Object.freeze({
    ServicePlan,createServicePlan,tripInstanceId,serviceDateBase,localServiceDate
  });
})(window);
