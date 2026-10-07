/* 8.12 live routing benchmark.
   Uses the public ACTV runtime snapshot plus the self-hosted OSM walking graph.
   Valhalla remains only as an emergency comparison/fallback path in this script. */
const fs=require('fs'),vm=require('vm'),{performance}=require('perf_hooks');
const ctx={console,Intl,Date,Map,Set,Math,DataView,Uint8Array,Uint16Array,Uint32Array,Int32Array,Float64Array,ArrayBuffer,TextDecoder,BigInt};vm.createContext(ctx);
for(const f of ['schedule','router'])vm.runInContext(fs.readFileSync(__dirname+'/../js/journey/'+f+'.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/gtfs-rt.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/actv/realtime-normalizer.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/walk/graph.js','utf8'),ctx);
const {Schedule}=ctx.UVTransitSchedule,R=ctx.UVTransitRouter,{Graph}=ctx.UVWalkGraph;
let walkGraph=null;
const BASE='https://unlockvenice.com/trasporti/runtime-data/';
const VALHALLA='https://valhalla1.openstreetmap.de/sources_to_targets';
const VALHALLA_ROUTE='https://valhalla1.openstreetmap.de/route';
const RT={aut:'https://tpl.actv.it/aut/GTFSRT/tripUpdates',nav:'https://tpl.actv.it/nav/GTFSRT/tripUpdates'};
const REPEATS=Math.max(1,Math.min(5,Number(process.env.UV_BENCH_REPEATS||1)));
const cases=[
 ['Mestre FS → Piazzale Roma',{lat:45.4824,lon:12.2317},{lat:45.4380,lon:12.3181}],
 ['Piazza Ferretto → Rialto',{lat:45.4912,lon:12.2429},{lat:45.4380,lon:12.3359}],
 ['Piazza Ferretto → San Marco',{lat:45.4912,lon:12.2429},{lat:45.4342,lon:12.3388}],
 ['Mestre FS → San Marco',{lat:45.4824,lon:12.2317},{lat:45.4342,lon:12.3388}],
 ['Piazzale Roma → Lido S.M.E.',{lat:45.4380,lon:12.3181},{lat:45.4174,lon:12.3680}],
 ['Mestre FS → Lido S.M.E.',{lat:45.4824,lon:12.2317},{lat:45.4174,lon:12.3680}]
];
async function json(url,timeout=25000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'u-venice-routing-benchmark/8.12','X-Client-Id':'unlockvenice-transit-dev','Cache-Control':'no-cache'}});if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r.json()}finally{clearTimeout(timer)}
}
async function binary(url,timeout=45000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'u-venice-routing-benchmark/8.12','Cache-Control':'no-cache'}});if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r.arrayBuffer()}finally{clearTimeout(timer)}
}
async function loadWalkGraph(){
 const t=performance.now(),m=await json(BASE+'walk/manifest.json?benchmark='+Date.now(),12000);
 if(m?.provider!=='OpenStreetMap pedestrian graph'||!m?.file)throw Error('Local walking graph manifest unavailable');
 const ab=await binary(new URL(m.file,BASE+'walk/').href),graph=new Graph(ab);
 if(graph.nodeCount!==m.nodes||graph.edgeCount!==m.edges)throw Error('Local walking graph mismatch');
 return {graph,manifest:m,loadMs:performance.now()-t};
}
const absolute=file=>new URL(file,BASE).href;
async function schedule(network,manifest,now){
 const net=manifest.networks?.[network],meta=net?.schedule,coreMeta=net?.core;
 if(!meta?.file||!coreMeta?.file)throw Error('Missing '+network+' runtime');
 const [index,core]=await Promise.all([json(absolute(meta.file)),json(absolute(coreMeta.file))]),days=index.days.filter(day=>index.chunks?.[day]?.file),chunksData={};
 let cursor=0;async function worker(){while(cursor<days.length){const day=days[cursor++];chunksData[day]=await json(absolute(index.chunks[day].file));}}
 await Promise.all(Array.from({length:Math.min(3,days.length)},worker));
 const runtime={...index,chunksData},s=new Schedule();s.loadRuntime(runtime,now);
 try{
   const raw=ctx.UVTransitGTFSRT.decodeFeed(await binary(RT[network],12000));
   const matcher=ctx.UVTransitACTVNormalizer.createMatcher({network,core,schedule:runtime});
   const normalized=ctx.UVTransitACTVNormalizer.normalizeTripUpdates(matcher,raw);
   s.update(normalized.feed);
   console.log(JSON.stringify({event:'realtime',network,source:'ACTV',stats:normalized.stats}));
 }catch(e){console.warn('Realtime '+network+' skipped:',e.message)}
 return s;
}
const coord=p=>({lat:+p.lat,lon:+p.lon,search_cutoff:80,search_filter:{exclude_ferry:true}});
async function matrix(point,stops,reverse=false){
 const list=stops.slice(0,24);if(walkGraph)return walkGraph.matrix(point,list,{reverse,maxSeconds:1800}).sort((a,b)=>a.seconds-b.seconds);
 const payload={sources:reverse?list.map(coord):[coord(point)],targets:reverse?[coord(point)]:list.map(coord),costing:'pedestrian',costing_options:{pedestrian:{use_ferry:0,exclude_ferries:true}},units:'kilometers',verbose:false,shape_format:'no_shape'};
 const url=new URL(VALHALLA);url.searchParams.set('json',JSON.stringify(payload));const j=await json(url.href);
 const root=j.sources_to_targets||j,d=root.durations||[],dist=root.distances||[];
 return list.map((stop,i)=>{const sec=+(reverse?d?.[i]?.[0]:d?.[0]?.[i]),km=+(reverse?dist?.[i]?.[0]:dist?.[0]?.[i]);return Number.isFinite(sec)?{id:stop.id,seconds:Math.ceil(sec),distance:Number.isFinite(km)?Math.round(km*1000):null,stop,verified:true,exact:false}:null}).filter(Boolean).filter(r=>r.seconds<=1800).sort((a,b)=>a.seconds-b.seconds).slice(0,8);
}
async function matrixPairs(links){
 const list=links.slice(0,8);if(walkGraph)return list.map(l=>{const r=walkGraph.route(l.from,l.to,{geometry:false,maxSeconds:1200});return r?{key:l.key,...r,verified:true,exact:true}:{key:l.key,blocked:true,verified:true,exact:true}});
 const payload={sources:list.map(l=>coord(l.from)),targets:list.map(l=>coord(l.to)),costing:'pedestrian',costing_options:{pedestrian:{use_ferry:0,exclude_ferries:true}},units:'kilometers',verbose:false,shape_format:'no_shape'};
 const url=new URL(VALHALLA);url.searchParams.set('json',JSON.stringify(payload));const j=await json(url.href),root=j.sources_to_targets||j,d=root.durations||[],dist=root.distances||[];
 return list.map((l,i)=>{const sec=+d?.[i]?.[i],km=+dist?.[i]?.[i];return Number.isFinite(sec)?{key:l.key,seconds:Math.ceil(sec),distance:Number.isFinite(km)?Math.round(km*1000):l.distance,verified:true}:{key:l.key,blocked:true}});
}
const pointDistance=(a,b)=>Math.hypot((a.lat-b.lat)*110540,(a.lon-b.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360));
function landHubVariants(p){
 const rows=[{point:p,offset:0}],seen=new Set([p.id||p.lat+','+p.lon]);if(p?.network!=='aut'||!p.hubMembers?.length)return rows;
 for(const member of p.hubMembers){const key=member.id||member.lat+','+member.lon,d=pointDistance(p,member);if(seen.has(key)||d>80)continue;seen.add(key);rows.push({point:member,offset:d})}
 return rows.sort((a,b)=>a.offset-b.offset).slice(0,10);
}
async function localHubWalk(a,b){
 let direct=walkGraph.route(a,b,{geometry:false,maxSeconds:14400});if(direct)return {...direct,verified:true,exact:true};
 const av=landHubVariants(a),bv=landHubVariants(b);if(av.length===1&&bv.length===1)throw Error('No pedestrian route');
 let best=null;
 for(const from of av){
  const targets=bv.map((x,i)=>({...x.point,id:String(i)})),rows=walkGraph.matrix(from.point,targets,{maxSeconds:1200});
  for(const row of rows){const to=bv[Number(row.id)];if(!to)continue;const seconds=row.seconds+Math.ceil((from.offset+to.offset)/1.1),distance=row.distance+Math.round(from.offset+to.offset);if(!best||seconds<best.seconds)best={seconds,distance,from,to}}
 }
 if(!best)throw Error('No pedestrian route');
 return {seconds:best.seconds,distance:best.distance,verified:true,exact:true,fromAnchor:best.from.point,toAnchor:best.to.point,hubAdjusted:true};
}
async function walk(a,b){
 if(walkGraph)return localHubWalk(a,b);
 const payload={locations:[coord(a),coord(b)],costing:'pedestrian',costing_options:{pedestrian:{use_ferry:0,exclude_ferries:true}},units:'kilometers'},url=new URL(VALHALLA_ROUTE);url.searchParams.set('json',JSON.stringify(payload));
 const j=await json(url.href),t=j.trip;if(!t||t.status!==0||!Number.isFinite(t.summary?.time))throw Error('No pedestrian route');
 if(t.summary.has_ferry||(t.legs||[]).some(l=>(l.maneuvers||[]).some(m=>m.type===30||m.type===31||m.travel_type==='ferry')))throw Error('Pedestrian route requires ferry');
 return {seconds:Math.ceil(t.summary.time),distance:Math.round(t.summary.length*1000),verified:true,exact:true};
}
function expandLandHubCandidates(rows){
 const best=new Map(),put=row=>{const prev=best.get(row.id);if(!prev||row.seconds<prev.seconds)best.set(row.id,row)};
 for(const row of rows||[]){put(row);const stop=row.stop;if(stop?.network!=='aut'||!stop.hubMembers?.length)continue;for(const member of stop.hubMembers){const d=pointDistance(stop,member);if(member.id===stop.id||d>80)continue;put({id:member.id,seconds:Math.ceil(row.seconds+d/1.1),distance:Math.round((row.distance||0)+d),stop:member,anchor:stop,verified:true,exact:true,hubAccess:true})}}
 return [...best.values()];
}
function diverseCandidates(rows,limit=12){
 rows=[...(rows||[])].filter(Boolean).sort((a,b)=>a.seconds-b.seconds);const picked=[],seenLines=new Set(),seenNetworks=new Set();
 const add=row=>{if(!row||picked.includes(row))return;picked.push(row);for(const l of row.stop?.lines||[])seenLines.add((row.stop?.network||'')+':'+l);if(row.stop?.network)seenNetworks.add(row.stop.network)};
 rows.slice(0,6).forEach(add);
 for(const row of rows){if(picked.length>=limit)break;const network=row.stop?.network||'',novelNetwork=network&&!seenNetworks.has(network),novelLine=(row.stop?.lines||[]).some(l=>!seenLines.has(network+':'+l));if(novelNetwork||novelLine)add(row)}
 for(const row of rows){if(picked.length>=limit)break;add(row)}
 return picked;
}
async function candidates(engine,point,reverse=false){
 const nearby=R.nearby(engine,point).slice(0,24),rows=await matrix(point,nearby,reverse);
 return diverseCandidates(expandLandHubCandidates(rows.filter(r=>r.seconds<=1800)),walkGraph?24:12);
}
async function verified(engine,origins,destinations,now,from,to,seedLinks=[]){
 const links=new Map(seedLinks.map(x=>[x.key,x]));let firstDraftMs=null,firstVerifiedMs=null,passes=0,started=performance.now(),last=[],firstPublished=false,published=[],deadline=0,validated=0;
 const blockLink=link=>{links.set(link.key,{key:link.key,blocked:true});if(link.groupKey&&link.groupKey!==link.key)links.set(link.groupKey,{key:link.groupKey,blocked:true,group:true})};
 const endpointExact=r=>r.walk?.exact&&r.egress?.exact,exactReady=rows=>rows.filter(r=>r.verified&&endpointExact(r)).slice(0,3);
 async function validateDrafts(results){
  const jobs=[],seen=new Set();
  function endpoint(kind,row,a,b,list){if(!row||row.exact||!row.stop)return;const key='endpoint:'+kind+':'+row.id;if(seen.has(key))return;seen.add(key);jobs.push({type:'endpoint',row,a,b,list})}
  for(const result of results){
   endpoint('origin',result.walk,from,result.walk?.anchor||result.walk?.stop,origins);endpoint('destination',result.egress,result.egress?.anchor||result.egress?.stop,to,destinations);
   for(const leg of result.legs||[]){const link=leg.transfer;if(!link||link.verified||links.has(link.key))continue;const key='transfer:'+link.key;if(seen.has(key))continue;seen.add(key);jobs.push({type:'transfer',link})}
  }
  if(!jobs.length)return false;
  const checked=await Promise.all(jobs.map(async job=>{try{const w=job.type==='endpoint'?await walk(job.a,job.b):await walk(job.link.from,job.link.to),limit=job.type==='endpoint'?1800:1200;return w.seconds<=limit?{job,w}:{job,blocked:true}}catch(e){return {job,blocked:true,reason:e.message}}}));
  let changed=false;
  for(const row of checked){
   if(row.job.type==='transfer'){if(row.blocked)blockLink(row.job.link);else links.set(row.job.link.key,{key:row.job.link.key,...row.w,verified:true,exact:true});changed=true;continue}
   const {list,row:candidate}=row.job,i=list.findIndex(x=>x.id===candidate.id);if(i<0)continue;
   if(row.blocked){const hub=candidate.stop?.hubId,parent=candidate.stop?.parent;if(hub){for(let j=list.length-1;j>=0;j--)if(list[j].stop?.hubId===hub)list.splice(j,1)}else if(parent){for(let j=list.length-1;j>=0;j--)if(list[j].stop?.parent===parent)list.splice(j,1)}else list.splice(i,1)}
   else list[i]={...list[i],...row.w,stop:list[i].stop,verified:true,exact:true};
   changed=true;
  }
  return changed;
 }
 for(let pass=0;pass<6;pass++){
  passes=pass+1;const rows=R.plan(engine,origins,destinations,now,{walkLinks:[...links.values()],limit:8});last=rows;if(rows.length&&firstDraftMs===null)firstDraftMs=performance.now()-started;
  const ready=exactReady(rows);if(!firstPublished&&ready.length){firstPublished=true;published=ready;firstVerifiedMs=performance.now()-started;deadline=performance.now()+1800}if(firstPublished&&ready.length)published=ready;
  if(firstPublished&&(ready.length>=3||performance.now()>deadline))return {rows:ready.length?ready:published,passes,firstDraftMs,firstVerifiedMs,verifyMs:performance.now()-started};
  const unresolved=rows.filter(r=>!r.verified||!endpointExact(r));if(!unresolved.length)return {rows:ready.length?ready:published,passes,firstDraftMs,firstVerifiedMs,verifyMs:performance.now()-started};
  const scope=unresolved.slice(0,6),changed=await validateDrafts(scope);if(!changed)return {rows:ready.length?ready:published,passes,firstDraftMs,firstVerifiedMs,verifyMs:performance.now()-started};
  validated+=scope.length;if(firstPublished&&validated>=8)return {rows:published,passes,firstDraftMs,firstVerifiedMs,verifyMs:performance.now()-started};
 }
 const ready=exactReady(last);return {rows:ready.length?ready:published,passes,firstDraftMs,firstVerifiedMs,verifyMs:performance.now()-started};
}
function summarize(r){return {arrival:new Date(r.arrival*1000).toISOString(),minutes:Math.round((r.arrival-r.now)/60),changes:Math.max(0,r.legs.length-1),walkMin:Math.ceil((r.walkSeconds||0)/60),score:Math.round(R.journeyScore(r)-r.now),legs:r.legs.map(l=>({network:l.network,line:l.route,from:l.from.name,to:l.to.name}))}}
function assertTouristInvariant(name,best,rows){
 if(!best)throw Error(name+': no verified itinerary');
 if(name==='Mestre FS → Piazzale Roma'){
  const direct2=rows.find(r=>r.legs.length===1&&String(r.legs[0].route)==='2');
  if(direct2&&best.legs.length>1&&direct2.arrival<=best.arrival+600)throw Error(name+': a transfer outranks a comparable direct line 2');
  if(direct2&&(best.walk?.seconds||0)>240&&direct2.arrival<=best.arrival+600)throw Error(name+': long access walk outranks nearby line 2 without material benefit');
 }
 if(name==='Piazzale Roma → Lido S.M.E.'){
  const directWater=rows.find(r=>r.legs.length===1&&r.legs[0].network==='nav');
  if(directWater&&directWater.arrival<=best.arrival+900&&(best.legs[0]?.network!=='nav'||best.legs.length>1))throw Error(name+': land detour outranks a comparable direct water service');
 }
 if(name==='Piazza Ferretto → Rialto'){
  const waterContinuation=rows.find(r=>r.legs.some(l=>l.network==='nav'));
  if((best.egress?.seconds||0)>1200&&waterContinuation&&waterContinuation.arrival<=best.arrival+600)throw Error(name+': excessive final walk outranks a comparable water continuation');
 }
}
(async()=>{
 const cold=performance.now(),manifest=await json(BASE+'manifest.json?benchmark='+Date.now()),now=Date.now()/1000;
 const [aut,nav,walkRuntime]=await Promise.all([schedule('aut',manifest,now),schedule('nav',manifest,now),loadWalkGraph()]),seedLinks=[],engine=R.merge([['aut',aut],['nav',nav]]),runtimeMs=performance.now()-cold;walkGraph=walkRuntime.graph;
 console.log(JSON.stringify({event:'runtime',generated_at:manifest.generated_at||null,runtimeMs:Math.round(runtimeMs),walkLoadMs:Math.round(walkRuntime.loadMs),walkNodes:walkGraph.nodeCount,walkEdges:walkGraph.edgeCount,walking:'local-osm',stops:engine.stops.size,trips:engine.trips.size,transferEdges:0}));
 const mestreHub=engine.search('mestre fs',true).find(x=>/mestre fs/i.test(x.name));
 const romaHub=engine.search('piazzale roma',true).find(x=>/piazzale roma/i.test(x.name));
 if(!mestreHub?.hub||mestreHub.members.length<2)throw Error('Mestre FS is not exposed as a multi-platform hub');
 if(!romaHub?.members?.length)throw Error('Piazzale Roma hub not found');
 const hubRows=R.plan(engine,mestreHub.members.map(m=>({id:m.id,seconds:0,stop:m,verified:true,exact:true})),romaHub.members.map(m=>({id:m.id,seconds:0,stop:m,verified:true,exact:true})),now,{limit:6});
 const direct2=hubRows.find(r=>r.legs.length===1&&String(r.legs[0].route)==='2');
 if(!direct2)throw Error('Mestre FS → Piazzale Roma lost the direct line 2 option');
 if(hubRows[0]?.legs.length>1&&hubRows[0].arrival>=direct2.arrival-600)throw Error('A transfer itinerary outranks line 2 without saving at least 10 minutes');
 console.log(JSON.stringify({event:'correctness',name:'Mestre FS hub → Piazzale Roma hub',originPlatforms:mestreHub.members.length,destinationPlatforms:romaHub.members.length,best:hubRows[0]?summarize(hubRows[0]):null,direct2:summarize(direct2)}));
 let successes=0;const samples=new Map(cases.map(([name])=>[name,[]])),observed=new Map();
 for(let repeat=1;repeat<=REPEATS;repeat++)for(const [name,from,to] of cases){const start=performance.now();try{
   const c0=performance.now(),[origins,destinations]=await Promise.all([candidates(engine,from,false),candidates(engine,to,true)]),candidateMs=performance.now()-c0;
   const plan=await verified(engine,origins,destinations,now,from,to,seedLinks),totalMs=performance.now()-start,best=plan.rows[0];if(best){assertTouristInvariant(name,best,plan.rows);successes++;if(!observed.has(name))observed.set(name,summarize(best))}
   const firstVerifiedMs=plan.firstVerifiedMs===null?null:Math.round(candidateMs+plan.firstVerifiedMs);if(firstVerifiedMs!==null)samples.get(name).push(firstVerifiedMs);
   console.log(JSON.stringify({event:'case',repeat,name,candidateMs:Math.round(candidateMs),firstDraftMs:plan.firstDraftMs===null?null:Math.round(candidateMs+plan.firstDraftMs),firstVerifiedMs,totalMs:Math.round(totalMs),passes:plan.passes,origins:origins.length,destinations:destinations.length,best:best?summarize(best):null,alternatives:plan.rows.slice(1).map(summarize)}));
 }catch(e){console.log(JSON.stringify({event:'case',repeat,name,error:e.message,totalMs:Math.round(performance.now()-start)}));}}
 const median=rows=>{const a=[...rows].sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null};
 const medians=Object.fromEntries([...samples].map(([name,rows])=>[name,median(rows)]));
 for(const [name,value] of Object.entries(medians)){if(value===null)throw Error(name+': no verified timing sample');if(value>6000)throw Error(name+': median first verified result regressed above 6s ('+value+' ms)')}
 console.log(JSON.stringify({event:'summary',repeats:REPEATS,firstVerifiedMedianMs:medians,topRoutes:Object.fromEntries(observed)}));
 if(successes<Math.ceil(cases.length*REPEATS/2))throw Error('Benchmark found too few usable routes: '+successes+'/'+(cases.length*REPEATS));
})().catch(e=>{console.error(e);process.exitCode=1});
