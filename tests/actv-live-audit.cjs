const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),JSZip=require('jszip'),{spawnSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const SOURCES={
  aut:{
    static:'https://actv.avmspa.it/sites/default/files/attachments/opendata/automobilistico/actv_aut.zip',
    compat:'https://actv.avmspa.it/sites/default/files/attachments/opendata/automobilistico/actv__aut.zip',
    vp:'https://tpl.actv.it/aut/GTFSRT/vehiclePositions',
    tu:'https://tpl.actv.it/aut/GTFSRT/tripUpdates'
  },
  nav:{
    static:'https://actv.avmspa.it/sites/default/files/attachments/opendata/navigazione/actv_nav.zip',
    compat:'https://actv.avmspa.it/sites/default/files/attachments/opendata/navigazione/actv__nav.zip',
    vp:'https://tpl.actv.it/nav/GTFSRT/vehiclePositions',
    tu:'https://tpl.actv.it/nav/GTFSRT/tripUpdates'
  }
};

async function download(url,file){
  const res=await fetch(url,{headers:{'user-agent':'U.VeniceTransport/ACTV-direct-live-audit','accept':'*/*'},redirect:'follow'});
  if(!res.ok)throw Error('HTTP '+res.status+' '+url);
  const b=Buffer.from(await res.arrayBuffer());
  if(!b.length)throw Error('Empty response '+url);
  fs.writeFileSync(file,b);return b.length;
}
function parseCSV(text){
  const rows=[];let headers=null,row=[],cell='',quoted=false;
  const emit=()=>{row.push(cell.replace(/\r$/,''));cell='';if(!headers)headers=row.map(x=>x.replace(/^\uFEFF/,''));else if(row.length>1)rows.push(Object.fromEntries(headers.map((h,i)=>[h,row[i]||''])));row=[]};
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n')emit();else cell+=ch}
  if(cell||row.length)emit();return rows;
}
async function inspectGtfs(file){
  const zip=await JSZip.loadAsync(fs.readFileSync(file));
  const read=async name=>zip.file(name)?zip.file(name).async('string'):'';
  const [stopsText,tripsText,stopTimesText,routesText]=await Promise.all(['stops.txt','trips.txt','stop_times.txt','routes.txt'].map(read));
  const stops=parseCSV(stopsText),trips=parseCSV(tripsText),stopTimes=parseCSV(stopTimesText),routes=parseCSV(routesText);
  const stopIds=new Set(stops.map(x=>x.stop_id).filter(Boolean));
  const tripIds=new Set(trips.map(x=>x.trip_id).filter(Boolean));
  const referencedStops=new Set(stopTimes.map(x=>x.stop_id).filter(Boolean));
  const tails=new Map();
  for(const id of tripIds){const parts=String(id).split('_'),tail=parts.length>=4&&/^\d+$/.test(parts[2])?parts.slice(3).join('_'):id;if(!tails.has(tail))tails.set(tail,[]);tails.get(tail).push(id)}
  const coords=new Map(stops.filter(s=>s.stop_id).map(s=>[s.stop_id,[Number(s.stop_lat),Number(s.stop_lon),s.stop_name||'',s.location_type||'',s.parent_station||'']]));
  return {stops:stops.length,trips:trips.length,stopTimes:stopTimes.length,routes:routes.length,stopIds,tripIds,referencedStops,tails,coords};
}
function setDiff(a,b){return [...a].filter(x=>!b.has(x))}
function rtStopIds(tu,vp){
  const ids=new Set();
  for(const e of tu.entity||[]){for(const u of e.tripUpdate?.stopTimeUpdate||[])if(u.stopId)ids.add(String(u.stopId))}
  for(const e of vp.entity||[]){if(e.vehicle?.stopId)ids.add(String(e.vehicle.stopId))}
  return ids;
}
function missingRtStopDetails(tu,vp,staticStops,compat){
  const rows=new Map();
  const put=(id,row)=>{
    id=String(id||'');if(!id||staticStops.has(id))return;
    if(!rows.has(id))rows.set(id,{id,compat:compat.coords.get(id)||null,tripIds:new Set(),sequences:new Set(),positions:[]});
    const x=rows.get(id);
    if(row.tripId)x.tripIds.add(String(row.tripId));
    if(row.seq!==undefined&&row.seq!==null)x.sequences.add(Number(row.seq));
    if(row.position&&x.positions.length<3)x.positions.push(row.position);
  };
  for(const e of tu.entity||[]){
    const tripId=e.tripUpdate?.trip?.tripId||'';
    for(const u of e.tripUpdate?.stopTimeUpdate||[])put(u.stopId,{tripId,seq:u.stopSequence});
  }
  for(const e of vp.entity||[]){
    const v=e.vehicle||{},p=v.position||{};
    put(v.stopId,{tripId:v.trip?.tripId||'',seq:v.currentStopSequence,
      position:Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))?[Number(p.latitude),Number(p.longitude)]:null});
  }
  return [...rows.values()].map(x=>({...x,tripIds:[...x.tripIds].slice(0,6),sequences:[...x.sequences].slice(0,6)}));
}
function rtTripTails(tu,vp){
  const ids=[];
  for(const e of tu.entity||[]){const id=e.tripUpdate?.trip?.tripId;if(id)ids.push(String(id))}
  for(const e of vp.entity||[]){const id=e.vehicle?.trip?.tripId;if(id)ids.push(String(id))}
  return [...new Set(ids)].map(id=>{const p=id.split('_');return p.length>=4&&/^\d+$/.test(p[2])?p.slice(3).join('_'):id});
}
function loadJs(){
  const ctx={window:null,Intl,Date,Map,Set,TextDecoder,Uint8Array,ArrayBuffer,DataView,BigInt,console};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'js/core/gtfs-rt.js'),'utf8'),ctx,{filename:'gtfs-rt.js'});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'js/actv/realtime-normalizer.js'),'utf8'),ctx,{filename:'realtime-normalizer.js'});
  return ctx;
}
function loadRuntime(out,network){
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
  const entry=manifest.networks[network];
  const core=JSON.parse(fs.readFileSync(path.join(out,entry.core.file),'utf8'));
  const shapes=entry.shapes?.file?JSON.parse(fs.readFileSync(path.join(out,entry.shapes.file),'utf8')):{schema:1,network,shapes:{}};
  const schedule=JSON.parse(fs.readFileSync(path.join(out,entry.schedule.file),'utf8'));
  const chunksData={};
  for(const day of schedule.days||[]){
    const m=schedule.chunks?.[day];
    if(m?.file)chunksData[day]=JSON.parse(fs.readFileSync(path.join(out,m.file),'utf8'));
  }
  return {core,shapes:shapes.shapes||{},schedule:{...schedule,chunksData}};
}
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uv-actv-audit-'));
  const out=path.join(tmp,'runtime'),work=path.join(tmp,'work');
  const cfg={outputDir:out,workDir:work,nice:0,yieldEveryRows:0,networks:{}};
  const snapshots={};
  for(const network of Object.keys(SOURCES)){
    const zip=path.join(tmp,network+'.zip'),compatZip=path.join(tmp,network+'-compat.zip');
    const [size,compatSize]=await Promise.all([download(SOURCES[network].static,zip),download(SOURCES[network].compat,compatZip)]);
    console.log(network,'static bytes',size,'compat bytes',compatSize);
    snapshots[network]={fresh:await inspectGtfs(zip),compat:await inspectGtfs(compatZip)};
    cfg.networks[network]={url:zip,timeoutSeconds:60};
  }
  const cfgPath=path.join(tmp,'config.json');fs.writeFileSync(cfgPath,JSON.stringify(cfg));
  const build=spawnSync('python3',[path.join(ROOT,'server/build_transit_data.py'),'--config',cfgPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  process.stdout.write(build.stdout||'');process.stderr.write(build.stderr||'');
  if(build.status!==0)throw Error('runtime builder failed');

  const ctx=loadJs();
  let bad=0;
  for(const network of Object.keys(SOURCES)){
    const {core,shapes,schedule}=loadRuntime(out,network);
    const [tuBuf,vpBuf]=await Promise.all([
      download(SOURCES[network].tu,path.join(tmp,network+'-tu.pb')).then(()=>fs.readFileSync(path.join(tmp,network+'-tu.pb'))),
      download(SOURCES[network].vp,path.join(tmp,network+'-vp.pb')).then(()=>fs.readFileSync(path.join(tmp,network+'-vp.pb')))
    ]);
    const tu=ctx.UVTransitGTFSRT.decodeFeed(tuBuf);
    const vp=ctx.UVTransitGTFSRT.decodeFeed(vpBuf);
    const snap=snapshots[network],rtStops=rtStopIds(tu,vp),rtTails=rtTripTails(tu,vp);
    const onlyCompat=setDiff(snap.compat.stopIds,snap.fresh.stopIds),onlyFresh=setDiff(snap.fresh.stopIds,snap.compat.stopIds);
    const rtStopFresh=[...rtStops].filter(id=>snap.fresh.stopIds.has(id)).length,rtStopCompat=[...rtStops].filter(id=>snap.compat.stopIds.has(id)).length;
    const rtTailFresh=rtTails.filter(t=>snap.fresh.tails.has(t)).length,rtTailCompat=rtTails.filter(t=>snap.compat.tails.has(t)).length;
    console.log('ACTV_STATIC_COMPARE',JSON.stringify({
      network,
      fresh:{stops:snap.fresh.stops,trips:snap.fresh.trips,stopTimes:snap.fresh.stopTimes,routes:snap.fresh.routes,referencedStops:snap.fresh.referencedStops.size},
      compat:{stops:snap.compat.stops,trips:snap.compat.trips,stopTimes:snap.compat.stopTimes,routes:snap.compat.routes,referencedStops:snap.compat.referencedStops.size},
      onlyCompatStops:onlyCompat.length,onlyFreshStops:onlyFresh.length,
      onlyCompatStopSample:onlyCompat.slice(0,20).map(id=>[id,snap.compat.coords.get(id)?.[2]||'']),
      onlyFreshStopSample:onlyFresh.slice(0,20).map(id=>[id,snap.fresh.coords.get(id)?.[2]||'']),
      realtimeStopIds:rtStops.size,realtimeStopsInFresh:rtStopFresh,realtimeStopsInCompat:rtStopCompat,
      realtimeTripTails:rtTails.length,realtimeTripTailsInFresh:rtTailFresh,realtimeTripTailsInCompat:rtTailCompat,
      missingRealtimeStops:missingRtStopDetails(tu,vp,snap.fresh.stopIds,snap.compat)
    }));
    const matcher=ctx.UVTransitACTVNormalizer.createMatcher({network,core,schedule,shapes});
    const staticStops=new Set((core.stops||[]).map(s=>String(s.id)));
    const staticRoutes=new Set((core.routes||[]).map(r=>String(r.id)));
    const staticRouteShorts=new Set((core.routes||[]).map(r=>String(r.short||'')));
    const tripTail=new Map();
    const tripShort=new Map();
    for(const t of core.trips||[]){
      const tail=String(t.id||'').split('_').pop();
      if(tail){if(!tripTail.has(tail))tripTail.set(tail,[]);tripTail.get(tail).push(t.id)}
      const short=String(t.shortName||'');
      if(short){if(!tripShort.has(short))tripShort.set(short,[]);tripShort.get(short).push(t.id)}
    }
    const rawTu=(tu.entity||[]).filter(e=>e.tripUpdate).slice(0,5).map(e=>{
      const t=e.tripUpdate.trip||{},updates=e.tripUpdate.stopTimeUpdate||[];
      const raw=String(t.tripId||''),tail=raw.split('_').pop();
      return {trip:t,stops:updates.slice(0,4).map(u=>({id:u.stopId,seq:u.stopSequence,time:u.arrival?.time||u.departure?.time||null})),
        routeExact:staticRoutes.has(String(t.routeId||'')),routeShort:staticRouteShorts.has(String(t.routeId||'')),
        exactStopCount:updates.filter(u=>staticStops.has(String(u.stopId||''))).length,
        tailMatches:(tripTail.get(tail)||[]).slice(0,5),shortNameMatches:(tripShort.get(tail)||[]).slice(0,5)};
    });
    console.log('ACTV_RAW_SAMPLE',JSON.stringify({network,staticTripSample:(core.trips||[]).slice(0,5),staticRouteSample:(core.routes||[]).slice(0,5),rawTu}));
    const normalized=ctx.UVTransitACTVNormalizer.normalizePair(matcher,tu,vp);
    const s=normalized.stats;
    console.log('ACTV_LIVE_AUDIT',JSON.stringify({
      network,
      staticTrips:core.trips.length,
      candidateTrips:s.candidates,
      tuEntities:tu.entity.length,
      vpEntities:vp.entity.length,
      tripUpdates:s.tripUpdates,
      vehiclePositions:s.vehiclePositions,
      correlatedTrips:s.correlatedTrips
    }));
    if(!tu.entity.length||!vp.entity.length||s.tripUpdates.matched===0||s.vehiclePositions.matched===0)bad++;
  }
  if(bad)throw Error('ACTV live audit produced an empty/unmatched network');
})().catch(err=>{console.error(err);process.exit(1)});
