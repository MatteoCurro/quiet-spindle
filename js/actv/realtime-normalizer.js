/* U.Venice Transport — ACTV realtime/static reconciliation.
   ACTV GTFS-RT trip_id/route_id may belong to a different publication cycle
   than the current static GTFS. This module rematches conservatively using
   stop ids, stop sequences, service-day times, route and direction evidence.
   Ambiguous matches are deliberately dropped by downstream consumers instead
   of being forced onto the wrong static trip. */
(function(global){
  'use strict';

  const VENICE_TZ='Europe/Rome';
  const localFmt=new Intl.DateTimeFormat('en-GB',{
    timeZone:VENICE_TZ,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  });

  function text(v){return String(v??'').trim()}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
  function pct(a,b){return b?Math.round(a*1000/b)/10:0}
  function distanceM(a,b){
    const lat1=Number(a?.lat),lon1=Number(a?.lon),lat2=Number(b?.lat),lon2=Number(b?.lon);
    if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return Infinity;
    const r=6371000,p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dp=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*r*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function bearing(a,b){
    const lat1=Number(a?.lat),lon1=Number(a?.lon),lat2=Number(b?.lat),lon2=Number(b?.lon);
    if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return null;
    const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
    const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function angleDiff(a,b){
    if(!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))return null;
    let d=Math.abs(Number(a)-Number(b))%360;return d>180?360-d:d;
  }
  function projectToSegment(point,a,b){
    const lat0=Number(point.lat)*Math.PI/180,kx=111320*Math.cos(lat0),ky=110540;
    const ax=(Number(a.lon)-Number(point.lon))*kx,ay=(Number(a.lat)-Number(point.lat))*ky;
    const bx=(Number(b.lon)-Number(point.lon))*kx,by=(Number(b.lat)-Number(point.lat))*ky;
    const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
    const px=ax+t*dx,py=ay+t*dy;
    return {t,distance:Math.hypot(px,py)};
  }
  function buildShapeIndex(rawShapes,allowedShapeIds){
    const cellDeg=.004,cells=new Map(),metas=new Map(),allowed=allowedShapeIds?new Set(allowedShapeIds):null;
    const add=(key,seg)=>{if(!cells.has(key))cells.set(key,[]);cells.get(key).push(seg)};
    const key=(x,y)=>x+','+y;
    for(const [shapeId,raw] of Object.entries(rawShapes||{})){
      if(allowed&&!allowed.has(shapeId))continue;
      const pts=(raw||[]).map(p=>({lat:num(p?.[0]),lon:num(p?.[1])})).filter(p=>p.lat!==null&&p.lon!==null);
      if(pts.length<2)continue;
      const cumulative=[0],segments=[];
      for(let i=1;i<pts.length;i++){
        const meters=distanceM(pts[i-1],pts[i]);cumulative.push(cumulative[i-1]+meters);
        if(!Number.isFinite(meters)||meters<=0)continue;
        const seg={shapeId,index:i-1,a:pts[i-1],b:pts[i],startM:cumulative[i-1],endM:cumulative[i],bearing:bearing(pts[i-1],pts[i])};
        segments.push(seg);
        const minX=Math.floor(Math.min(seg.a.lon,seg.b.lon)/cellDeg),maxX=Math.floor(Math.max(seg.a.lon,seg.b.lon)/cellDeg);
        const minY=Math.floor(Math.min(seg.a.lat,seg.b.lat)/cellDeg),maxY=Math.floor(Math.max(seg.a.lat,seg.b.lat)/cellDeg);
        for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)add(key(x,y),seg);
      }
      if(segments.length)metas.set(shapeId,{shapeId,pts,cumulative,totalM:cumulative[cumulative.length-1],segments});
    }
    return {cellDeg,cells,metas,key};
  }
  function nearbyShapeProjections(index,point,maxM=260){
    if(!index?.cells?.size)return [];
    const cx=Math.floor(point.lon/index.cellDeg),cy=Math.floor(point.lat/index.cellDeg),seen=new Set(),best=new Map();
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const seg of index.cells.get(index.key(cx+dx,cy+dy))||[]){
        const sk=seg.shapeId+':'+seg.index;if(seen.has(sk))continue;seen.add(sk);
        const p=projectToSegment(point,seg.a,seg.b);if(p.distance>maxM)continue;
        const along=seg.startM+p.t*(seg.endM-seg.startM),row={shapeId:seg.shapeId,distance:p.distance,along,bearing:seg.bearing};
        const prev=best.get(seg.shapeId);if(!prev||row.distance<prev.distance)best.set(seg.shapeId,row);
      }
    }
    return [...best.values()].sort((a,b)=>a.distance-b.distance);
  }
  function parseClock(value){
    const m=/^(\d+):(\d{2}):(\d{2})$/.exec(text(value));
    if(!m)return null;
    const h=Number(m[1]),mi=Number(m[2]),s=Number(m[3]);
    return mi<60&&s<60?h*3600+mi*60+s:null;
  }
  function dayNumber(day){
    const m=/^(\d{4})(\d{2})(\d{2})$/.exec(text(day));
    return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null;
  }
  function localParts(epochSec){
    const p={};
    for(const x of localFmt.formatToParts(new Date(Number(epochSec)*1000)))if(x.type!=='literal')p[x.type]=Number(x.value);
    return p;
  }
  function relativeServiceSeconds(epochSec,serviceDay){
    const dn=dayNumber(serviceDay);if(dn===null||!Number.isFinite(Number(epochSec)))return null;
    const p=localParts(epochSec);
    const actual=Math.floor(Date.UTC(p.year,p.month-1,p.day)/86400000);
    return (actual-dn)*86400+p.hour*3600+p.minute*60+p.second;
  }
  function routeKey(route){return text(route?.short)||text(route?.long)||text(route?.id)}
  function routePublicKey(route){
    const short=text(route?.short),desc=text(route?.desc);
    return short&&desc?short+'_'+desc:short;
  }
  function wrappedTripId(raw){
    const parts=text(raw).split('_');
    return parts.length>=4&&/^\d+$/.test(parts[2])?parts.slice(3).join('_'):'';
  }
  function naturalTripTail(raw){
    const value=text(raw),wrapped=wrappedTripId(value);
    if(wrapped)return wrapped;
    return value&&!value.includes('_')?value:'';
  }
  function vehicleKeys(vehicle){
    const meta=vehicle?.vehicle||vehicle||{};
    return [...new Set([text(meta.id),text(meta.label)].filter(Boolean))];
  }
  function coreCandidate(matcher,tid){
    tid=text(tid);
    const meta=matcher.tripMeta.get(tid);if(!meta)return null;
    const route=matcher.routeById.get(text(meta.routeId));if(!route)return null;
    return {
      tid,rid:text(meta.routeId),routeShort:routeKey(route),routePublic:routePublicKey(route),
      routeDesc:text(route.desc),headsign:text(meta.headsign),shapeId:text(meta.shapeId),
      directionId:meta.directionId??null,stops:[],stopBySeq:new Map(),stopById:new Map(),
      firstTime:null,lastTime:null,signature:'core|'+tid,coreOnly:true
    };
  }
  function coreAliasCandidate(matcher,trip){
    const alias=wrappedTripId(trip?.tripId??trip?.trip_id);if(!alias)return null;
    const rows=(matcher.coreByTail.get(alias)||[]).map(meta=>coreCandidate(matcher,meta.id)).filter(Boolean)
      .filter(c=>routeCompatible(c,trip));
    return rows.length===1?rows[0]:null;
  }
  function rememberVehicleTrip(matcher,vehicle,candidate,observedAt){
    if(!candidate)return;
    const at=num(observedAt)??Math.floor(Date.now()/1000);
    for(const key of vehicleKeys(vehicle))matcher.vehicleTripMap.set(key,{tid:candidate.tid,at});
  }
  function vehicleMappedCandidate(matcher,vehicle,observedAt){
    const now=num(observedAt)??Math.floor(Date.now()/1000),ttl=1200;
    for(const key of vehicleKeys(vehicle)){
      const entry=matcher.vehicleTripMap.get(key);
      if(!entry)continue;
      const tid=typeof entry==='string'?entry:entry.tid,at=typeof entry==='string'?now:entry.at;
      if(at&&now-at>ttl){matcher.vehicleTripMap.delete(key);continue}
      return matcher.byTrip.get(tid)||coreCandidate(matcher,tid);
    }
    return null;
  }
  function addIndex(map,key,value){
    key=text(key);if(!key)return;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(value);
  }

  function routeOnlyDescriptor(matcher,trip){
    const rawRoute=text(trip?.routeId??trip?.route_id);if(!rawRoute)return null;
    const rows=matcher.routeAliases.get(rawRoute)||[];
    if(rows.length!==1)return null;
    return {...(trip||{}),routeId:rows[0].id,_uvRouteOnly:true};
  }

  function createMatcher({network,core,schedule,shapes}){
    if(!core||!Array.isArray(core.routes)||!Array.isArray(core.trips))throw new Error('ACTV matcher: core non valido');
    if(!schedule||!schedule.chunksData)throw new Error('ACTV matcher: schedule non valido');

    const routeById=new Map(),routeAliases=new Map(),tripMeta=new Map(),staticTripIds=new Set(),stopCoords=new Map(),coreByTail=new Map();
    for(const r of core.routes){
      if(!r?.id)continue;
      routeById.set(text(r.id),r);
      for(const alias of new Set([text(r.id),routeKey(r),routePublicKey(r)].filter(Boolean)))addIndex(routeAliases,alias,r);
    }
    for(const s of core.stops||[]){
      const lat=num(s?.lat),lon=num(s?.lon),id=text(s?.id);
      if(id&&lat!==null&&lon!==null)stopCoords.set(id,{id,lat,lon});
    }
    for(const t of core.trips){
      const id=text(t?.id);if(!id)continue;
      staticTripIds.add(id);tripMeta.set(id,t);
      const tail=naturalTripTail(id);if(tail)addIndex(coreByTail,tail,t);
    }

    const candidates=[],byStop=new Map(),byRoute=new Map(),byTrip=new Map(),byTripId=new Map(),byShape=new Map();
    for(const [day,chunk] of Object.entries(schedule.chunksData||{})){
      for(const row of chunk?.trips||[]){
        if(!Array.isArray(row)||row.length<5)continue;
        const [tid0,rid0,headsign0,shape0,stopRows0]=row;
        const tid=text(tid0),rid=text(rid0),meta=tripMeta.get(tid)||{},route=routeById.get(rid);
        if(!tid||!rid||!Array.isArray(stopRows0)||stopRows0.length<2)continue;
        const stops=stopRows0.map(s=>({
          id:text(s?.[0]),seq:num(s?.[1]),arr:num(s?.[2]),dep:num(s?.[3])
        })).filter(s=>s.id&&s.seq!==null);
        if(stops.length<2)continue;
        const stopBySeq=new Map(),stopById=new Map();
        for(const s of stops){
          stopBySeq.set(s.seq,s);
          if(!stopById.has(s.id))stopById.set(s.id,s);
        }
        const c={
          day:text(day),tid,rid,routeShort:routeKey(route),routePublic:routePublicKey(route),
          routeDesc:text(route?.desc),headsign:text(headsign0),
          shapeId:text(shape0||meta.shapeId),directionId:meta.directionId??null,
          stops,stopBySeq,stopById,firstTime:stops[0].dep??stops[0].arr??null,
          lastTime:stops[stops.length-1].arr??stops[stops.length-1].dep??null
        };
        c.signature=[c.rid,String(c.directionId??''),c.shapeId,String(c.firstTime??''),stops.map(s=>s.id).join('>')].join('|');
        candidates.push(c);byTrip.set(tid,c);addIndex(byTripId,tid,c);addIndex(byShape,c.shapeId,c);
        addIndex(byRoute,rid,c);addIndex(byRoute,c.routeShort,c);addIndex(byRoute,c.routePublic,c);
        for(const sid of new Set(stops.map(s=>s.id)))addIndex(byStop,sid,c);
      }
    }

    return {
      network:text(network),core,schedule,routeById,routeAliases,tripMeta,staticTripIds,stopCoords,coreByTail,candidates,byStop,byRoute,byTrip,byTripId,byShape,
      shapeIndex:buildShapeIndex(shapes||{},byShape.keys()),upstreamTripMap:new Map(),vehicleTripMap:new Map(),
      stats:{createdAt:new Date().toISOString(),candidates:candidates.length}
    };
  }

  function descriptorFrom(container){return container?.trip||{}}
  function updateRows(tu){return tu?.stopTimeUpdate||tu?.stop_time_update||[]}
  function stopIdOf(u){return text(u?.stopId??u?.stop_id)}
  function stopSeqOf(u){return num(u?.stopSequence??u?.stop_sequence)}
  function eventOf(u){return u?.arrival||u?.departure||null}
  function eventTime(u){
    const a=num(u?.arrival?.time),d=num(u?.departure?.time);
    return a??d;
  }
  function eventDelay(u,tu){
    const a=num(u?.arrival?.delay),d=num(u?.departure?.delay),t=num(tu?.delay);
    return a??d??t;
  }

  function candidatesForTrip(matcher,tripId,day){
    let rows=matcher.byTripId.get(text(tripId))||[];
    if(day)rows=rows.filter(c=>c.day===day);
    return rows;
  }

  function poolFor(matcher,trip,updates,vehicle){
    let pool=null;
    const day=text(trip?.startDate??trip?.start_date);
    const alias=wrappedTripId(trip?.tripId??trip?.trip_id);
    if(alias){
      const rows=candidatesForTrip(matcher,alias,day);
      if(rows.length)pool=rows;
    }
    const ids=[];
    for(const u of updates||[]){const sid=stopIdOf(u);if(sid&&!ids.includes(sid))ids.push(sid);if(ids.length>=4)break}
    const vehicleStop=text(vehicle?.stopId??vehicle?.stop_id);
    if(vehicleStop&&!ids.includes(vehicleStop))ids.push(vehicleStop);
    if(!pool||!pool.length){
      for(const sid of ids){
        const rows=matcher.byStop.get(sid)||[];
        if(!pool||rows.length<pool.length)pool=rows;
      }
    }
    const rawRoute=text(trip?.routeId??trip?.route_id);
    if((!pool||!pool.length)&&rawRoute)pool=matcher.byRoute.get(rawRoute)||[];
    if(!pool)pool=[];
    if(day)pool=pool.filter(c=>c.day===day);
    return pool;
  }

  function routeCompatible(c,trip){
    const rawRoute=text(trip?.routeId??trip?.route_id);
    if(rawRoute&&rawRoute!==c.rid&&rawRoute!==c.routeShort&&rawRoute!==c.routePublic)return false;
    const direction=num(trip?.directionId??trip?.direction_id);
    return !(direction!==null&&c.directionId!==null&&String(direction)!==String(c.directionId));
  }

  function candidateBearing(matcher,c,stopId){
    const i=c.stops.findIndex(s=>s.id===stopId);if(i<0)return null;
    let a=null,b=null;
    for(let p=i-1;p>=0&&!a;p--)a=matcher.stopCoords.get(c.stops[p].id)||null;
    for(let p=i+1;p<c.stops.length&&!b;p++)b=matcher.stopCoords.get(c.stops[p].id)||null;
    if(!a)a=matcher.stopCoords.get(c.stops[i].id)||null;
    if(!b)b=matcher.stopCoords.get(c.stops[i].id)||null;
    return a&&b&&a!==b?bearing(a,b):null;
  }

  function gpsVehicleCandidate(matcher,trip,vehicle){
    if(matcher.network!=='aut')return null;
    const pos=vehicle?.position||{},lat=num(pos.latitude??pos.lat),lon=num(pos.longitude??pos.lon??pos.lng),ts=num(vehicle?.timestamp);
    if(lat===null||lon===null||ts===null)return null;
    const here={lat,lon},near=[];
    for(const stop of matcher.stopCoords.values()){
      const d=distanceM(here,stop);
      if(d>650)continue;
      near.push({stop,d});
    }
    near.sort((a,b)=>a.d-b.d);near.length=Math.min(near.length,5);
    if(!near.length)return null;

    const rawRoute=text(trip?.routeId??trip?.route_id),rawBearing=num(pos.bearing),speed=num(pos.speed);
    const useBearing=rawBearing!==null&&(speed===null||speed>=2);
    const ranked=new Map();
    for(const ns of near){
      for(const c of matcher.byStop.get(ns.stop.id)||[]){
        if(!routeCompatible(c,trip))continue;
        const row=c.stopById.get(ns.stop.id);if(!row)continue;
        const sched=row.arr??row.dep;if(sched===null||sched===undefined)continue;
        const rel=relativeServiceSeconds(ts,c.day);if(rel===null)continue;
        const td=Math.abs(rel-sched);
        if(td>3600)continue;
        let bd=null;
        if(useBearing){
          bd=angleDiff(rawBearing,candidateBearing(matcher,c,ns.stop.id));
          if(bd!==null&&bd>100)continue;
        }
        const routeBoost=rawRoute?1:0;
        const bearingPenalty=bd===null?0:bd*4;
        const cost=td+ns.d*1.5+bearingPenalty-routeBoost*120;
        const prev=ranked.get(c.tid);
        if(!prev||cost<prev.cost)ranked.set(c.tid,{candidate:c,cost,timeDelta:td,distance:ns.d,bearingDelta:bd,routeBoost});
      }
    }
    const rows=[...ranked.values()].sort((a,b)=>a.cost-b.cost);
    if(!rows.length)return null;
    const best=rows[0],second=rows[1];
    if(best.distance>450)return null;
    if(rawRoute){
      if(best.timeDelta>2700)return null;
      if(second&&second.cost-best.cost<300)return null;
    }else{
      if(best.distance>180||best.timeDelta>600)return null;
      if(useBearing&&best.bearingDelta!==null&&best.bearingDelta>55)return null;
      if(second&&second.cost-best.cost<600)return null;
    }
    return {candidate:best.candidate,score:700-best.cost/100,method:'gps'};
  }

  function shapeGpsVehicleCandidate(matcher,trip,vehicle){
    if(matcher.network!=='aut'||!matcher.shapeIndex?.metas?.size)return null;
    const pos=vehicle?.position||{},lat=num(pos.latitude??pos.lat),lon=num(pos.longitude??pos.lon??pos.lng),ts=num(vehicle?.timestamp);
    if(lat===null||lon===null||ts===null)return null;
    const projections=nearbyShapeProjections(matcher.shapeIndex,{lat,lon},260).slice(0,8);
    if(!projections.length)return null;
    const rawRoute=text(trip?.routeId??trip?.route_id),rawBearing=num(pos.bearing),speed=num(pos.speed);
    const useBearing=rawBearing!==null&&(speed===null||speed>=2),ranked=[];
    for(const pr of projections){
      const meta=matcher.shapeIndex.metas.get(pr.shapeId);if(!meta||!meta.totalM)continue;
      const fraction=Math.max(0,Math.min(1,pr.along/meta.totalM));
      for(const cand of matcher.byShape.get(pr.shapeId)||[]){
        if(!routeCompatible(cand,trip))continue;
        if(cand.firstTime===null||cand.lastTime===null||cand.lastTime<cand.firstTime)continue;
        const rel=relativeServiceSeconds(ts,cand.day);if(rel===null)continue;
        const scheduled=cand.firstTime+fraction*(cand.lastTime-cand.firstTime),timeDelta=Math.abs(rel-scheduled);
        if(timeDelta>(rawRoute?1800:900))continue;
        let bd=null;
        if(useBearing){bd=angleDiff(rawBearing,pr.bearing);if(bd!==null&&bd>95)continue}
        const routeBoost=rawRoute?180:0,bearingPenalty=bd===null?0:bd*3;
        const cost=timeDelta+pr.distance*4+bearingPenalty-routeBoost;
        ranked.push({candidate:cand,cost,timeDelta,distance:pr.distance,bearingDelta:bd,fraction});
      }
    }
    ranked.sort((a,b)=>a.cost-b.cost);
    if(!ranked.length)return null;
    const best=ranked[0],second=ranked.find(x=>x.candidate.tid!==best.candidate.tid);
    if(best.distance>180)return null;
    if(!rawRoute&&best.timeDelta>720)return null;
    if(useBearing&&best.bearingDelta!==null&&best.bearingDelta>65)return null;
    const margin=second?second.cost-best.cost:Infinity;
    if(margin<(rawRoute?180:300))return null;
    return {candidate:best.candidate,score:760-best.cost/100,method:'shapeGps',shapeProgress:best.fraction,timeDelta:best.timeDelta,distance:best.distance};
  }

  function scoreCandidate(c,trip,updates,vehicle,tu){
    let score=0,evidence=0;
    const rawTrip=text(trip?.tripId??trip?.trip_id),alias=wrappedTripId(rawTrip);
    const rawRoute=text(trip?.routeId??trip?.route_id);
    const direction=num(trip?.directionId??trip?.direction_id);
    if(alias&&alias===c.tid){score+=50;evidence++}
    if(rawRoute){
      if(rawRoute===c.rid){score+=22;evidence++}
      else if(rawRoute===c.routePublic){score+=22;evidence++}
      else if(rawRoute===c.routeShort){score+=13;evidence++}
    }
    if(direction!==null&&c.directionId!==null&&String(direction)===String(c.directionId)){score+=6;evidence++}

    const start=parseClock(trip?.startTime??trip?.start_time);
    if(start!==null&&c.firstTime!==null){
      const d=Math.abs(start-c.firstTime);
      if(d<=60)score+=14;
      else if(d<=180)score+=11;
      else if(d<=600)score+=7;
      else if(d<=1800)score+=3;
      evidence++;
    }

    let stopEvidence=0,timeEvidence=0;
    const samples=(updates||[]).filter(u=>stopIdOf(u)).slice(0,8);
    for(const u of samples){
      const sid=stopIdOf(u),seq=stopSeqOf(u);
      let row=seq!==null?c.stopBySeq.get(seq):null;
      if(row&&row.id===sid){score+=16;stopEvidence++}
      else{
        row=c.stopById.get(sid)||null;
        if(row){score+=6;stopEvidence++}
      }
      if(row){
        const t=eventTime(u),delay=eventDelay(u,tu);
        if(t!==null){
          const rel=relativeServiceSeconds(t,c.day);
          const sched=row.arr??row.dep;
          if(rel!==null&&sched!==null){
            const corrected=delay!==null?rel-delay:rel;
            const delta=Math.abs(corrected-sched);
            if(delta<=60)score+=9;
            else if(delta<=180)score+=6;
            else if(delta<=600)score+=3;
            else if(delay===null&&delta<=5400)score+=1;
            timeEvidence++;
          }
        }
      }
      if(stopEvidence>=4&&timeEvidence>=3)break;
    }

    if(vehicle){
      const sid=text(vehicle.stopId??vehicle.stop_id),seq=num(vehicle.currentStopSequence??vehicle.current_stop_sequence);
      let row=seq!==null?c.stopBySeq.get(seq):null;
      if(row&&sid&&row.id===sid){score+=18;stopEvidence++}
      else if(sid&&(row=c.stopById.get(sid))){score+=8;stopEvidence++}
      if(row){
        const ts=num(vehicle.timestamp);
        const sched=row.arr??row.dep;
        if(ts!==null&&sched!==null){
          const rel=relativeServiceSeconds(ts,c.day);
          if(rel!==null){
            const d=Math.abs(rel-sched);
            if(d<=1200)score+=8;
            else if(d<=3600)score+=5;
            else if(d<=10800)score+=2;
            timeEvidence++;
          }
        }
      }
    }
    evidence+=stopEvidence+timeEvidence;
    return {score,evidence};
  }

  function choose(matcher,trip,updates,vehicle,tu){
    const rawTrip=text(trip?.tripId??trip?.trip_id);
    const day=text(trip?.startDate??trip?.start_date);
    if(rawTrip&&matcher.staticTripIds.has(rawTrip)){
      const rows=candidatesForTrip(matcher,rawTrip,day),c=rows[0]||matcher.byTrip.get(rawTrip);
      return c?{candidate:c,score:999,method:'exact'}:null;
    }
    if(rawTrip&&matcher.upstreamTripMap.has(rawTrip)){
      const tid=matcher.upstreamTripMap.get(rawTrip),rows=candidatesForTrip(matcher,tid,day),c=rows[0]||matcher.byTrip.get(tid)||coreCandidate(matcher,tid);
      if(c)return {candidate:c,score:998,method:'correlated'};
    }
    const coreAlias=coreAliasCandidate(matcher,trip);
    if(coreAlias)return {candidate:coreAlias,score:997.5,method:'coreAlias'};
    const alias=wrappedTripId(rawTrip);
    if(alias){
      const rows=candidatesForTrip(matcher,alias,day);
      if(rows.length===1)return {candidate:rows[0],score:997,method:'idAlias'};
    }
    if(vehicle){
      const c=vehicleMappedCandidate(matcher,vehicle,vehicle.timestamp);
      if(c)return {candidate:c,score:996.5,method:'vehicleId'};
    }

    const pool=poolFor(matcher,trip,updates,vehicle);
    if(pool.length){
      const ranked=pool.map(c=>({candidate:c,...scoreCandidate(c,trip,updates,vehicle,tu)}))
        .filter(x=>x.evidence>0).sort((a,b)=>b.score-a.score);
      if(ranked.length){
        const best=ranked[0],second=ranked[1];
        const margin=second?best.score-second.score:best.score;
        const equivalent=second&&best.score===second.score&&best.candidate.signature===second.candidate.signature;
        if(best.score>=24&&(!second||margin>=6||equivalent||best.score>=48))
          return {candidate:best.candidate,score:best.score,method:vehicle?'vehicle':'schedule'};
      }
    }
    if(vehicle){
      const gps=gpsVehicleCandidate(matcher,trip,vehicle);
      if(gps)return gps;
      const shapeGps=shapeGpsVehicleCandidate(matcher,trip,vehicle);
      if(shapeGps)return shapeGps;
    }
    return null;
  }

  function rewrittenTrip(original,c){
    const out={...(original||{})};
    out.tripId=c.tid;out.routeId=c.rid;
    if(c.directionId!==null&&c.directionId!==undefined)out.directionId=Number(c.directionId);
    return out;
  }
  function rewrittenStopUpdates(updates,c){
    let rewritten=0;
    const rows=(updates||[]).map(u=>{
      const seq=stopSeqOf(u),row=seq!==null?c?.stopBySeq?.get(seq):null;
      if(!row?.id)return u;
      const raw=stopIdOf(u);
      if(raw===row.id)return u;
      rewritten++;
      return {...u,stopId:row.id};
    });
    return {rows,rewritten};
  }
  function rewrittenVehicle(original,c){
    const out={...(original||{})},seq=num(out.currentStopSequence??out.current_stop_sequence);
    const row=seq!==null?c?.stopBySeq?.get(seq):null;
    let rewritten=0;
    if(row?.id&&text(out.stopId??out.stop_id)!==row.id){out.stopId=row.id;rewritten=1}
    return {vehicle:out,rewritten};
  }

  function normalizeTripUpdates(matcher,feed){
    const stats={entities:0,updates:0,matched:0,exact:0,coreAlias:0,idAlias:0,correlated:0,schedule:0,unmatched:0,unmatchedSample:[],vehicleLinks:0,stopIdsRewritten:0};
    const entity=(feed?.entity||feed?.entities||[]).map(e=>{
      stats.entities++;
      const tu=e?.tripUpdate||e?.trip_update;
      if(!tu)return e;
      stats.updates++;
      const trip=descriptorFrom(tu),rawTrip=text(trip?.tripId??trip?.trip_id);
      const match=choose(matcher,trip,updateRows(tu),null,tu);
      if(!match){
        stats.unmatched++;
        if(rawTrip&&stats.unmatchedSample.length<8)stats.unmatchedSample.push(rawTrip);
        return e;
      }
      stats.matched++;stats[match.method]=(stats[match.method]||0)+1;
      if(rawTrip)matcher.upstreamTripMap.set(rawTrip,match.candidate.tid);
      const before=matcher.vehicleTripMap.size;
      rememberVehicleTrip(matcher,tu.vehicle,match.candidate,num(tu.timestamp)??num(feed?.header?.timestamp));
      stats.vehicleLinks+=matcher.vehicleTripMap.size-before;
      const headerTs=num(feed?.header?.timestamp),stops=rewrittenStopUpdates(updateRows(tu),match.candidate);
      stats.stopIdsRewritten+=stops.rewritten;
      return {...e,tripUpdate:{...tu,timestamp:num(tu.timestamp)??headerTs??0,trip:rewrittenTrip(trip,match.candidate),stopTimeUpdate:stops.rows}};
    });
    stats.coveragePct=pct(stats.matched,stats.updates);
    return {feed:{...feed,entity},stats};
  }

  function normalizeVehiclePositions(matcher,feed){
    const stats={entities:0,vehicles:0,matched:0,exact:0,coreAlias:0,idAlias:0,vehicleId:0,correlated:0,vehicle:0,gps:0,shapeGps:0,routeOnly:0,unmatched:0,unmatchedSample:[],stopIdsRewritten:0};
    const entity=(feed?.entity||feed?.entities||[]).map(e=>{
      stats.entities++;
      const vp=e?.vehicle;if(!vp)return e;
      stats.vehicles++;
      const trip=descriptorFrom(vp),rawTrip=text(trip?.tripId??trip?.trip_id);
      const headerTs=num(feed?.header?.timestamp);
      const matchVehicle=num(vp.timestamp)===null&&headerTs!==null?{...vp,timestamp:headerTs}:vp;
      const match=choose(matcher,trip,[],matchVehicle,null);
      if(!match){
        const routeOnly=routeOnlyDescriptor(matcher,trip);
        if(routeOnly){
          stats.routeOnly++;
          return {...e,vehicle:{...vp,trip:routeOnly}};
        }
        stats.unmatched++;
        if(rawTrip&&stats.unmatchedSample.length<8)stats.unmatchedSample.push(rawTrip);
        return e;
      }
      stats.matched++;stats[match.method]=(stats[match.method]||0)+1;
      if(rawTrip)matcher.upstreamTripMap.set(rawTrip,match.candidate.tid);
      rememberVehicleTrip(matcher,vp,match.candidate,num(vp.timestamp)??num(feed?.header?.timestamp));
      const rewritten=rewrittenVehicle(vp,match.candidate);stats.stopIdsRewritten+=rewritten.rewritten;
      return {...e,vehicle:{...rewritten.vehicle,trip:rewrittenTrip(trip,match.candidate)}};
    });
    stats.coveragePct=pct(stats.matched,stats.vehicles);
    stats.displayable=stats.matched+stats.routeOnly;
    stats.displayCoveragePct=pct(stats.displayable,stats.vehicles);
    return {feed:{...feed,entity},stats};
  }

  function normalizePair(matcher,tripUpdates,vehiclePositions){
    const tu=normalizeTripUpdates(matcher,tripUpdates);
    const vp=normalizeVehiclePositions(matcher,vehiclePositions);
    const stats={
      network:matcher.network,updatedAt:new Date().toISOString(),
      candidates:matcher.candidates.length,tripUpdates:tu.stats,vehiclePositions:vp.stats,
      correlatedTrips:matcher.upstreamTripMap.size,vehicleLinks:matcher.vehicleTripMap.size
    };
    matcher.stats=stats;
    return {tripUpdates:tu.feed,vehiclePositions:vp.feed,stats};
  }

  global.UVTransitACTVNormalizer=Object.freeze({
    createMatcher,normalizePair,normalizeTripUpdates,normalizeVehiclePositions,
    _test:Object.freeze({parseClock,relativeServiceSeconds,routePublicKey,wrappedTripId,naturalTripTail,routeOnlyDescriptor,coreAliasCandidate,gpsVehicleCandidate,shapeGpsVehicleCandidate,buildShapeIndex,nearbyShapeProjections,rewrittenStopUpdates,rewrittenVehicle,scoreCandidate,choose})
  });
})(window);
