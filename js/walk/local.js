/* Lazy client-side walking router. The graph is static runtime data; all route
   computation happens in the user's browser. */
(function(g){'use strict';
const ROOT=g.location?.origin||g.document?.baseURI||'https://unlockvenice.com/';
const BASE=new URL('/trasporti/runtime-data/walk/',ROOT).href;
let worker=null,loading=null,loadedAt=0,serial=0,manifest=null;const pending=new Map();
function rpc(type,data,timeout=20000){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Routing pedonale locale troppo lento'))},timeout);pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,data})})}
function ensureWorker(){if(worker)return worker;if(!g.Worker)throw Error('Web Worker non disponibile');worker=new Worker('js/walk/worker.js?v=8.12.0-dev.8');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result)};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Motore pedonale locale non disponibile'))}pending.clear();worker?.terminate();worker=null;loading=null;loadedAt=0};return worker}
async function ready(){
 if(loadedAt&&Date.now()-loadedAt<21600000)return manifest;if(loading)return loading;
 loading=(async()=>{ensureWorker();const r=await fetch(BASE+'manifest.json?_='+Date.now(),{cache:'no-cache'});if(!r.ok)throw Error('Grafo pedonale locale non pubblicato');const m=await r.json();if(Number(m?.schema)!==1||m?.provider!=='OpenStreetMap pedestrian graph'||!m?.file)throw Error('Manifest grafo pedonale non compatibile');const url=new URL(m.file,BASE).href,gzipUrl=m.gzipFile?new URL(m.gzipFile,BASE).href:null,meta=await rpc('load',{url,gzipUrl},45000);if(meta.nodes!==m.nodes||meta.edges!==m.edges)throw Error('Grafo pedonale locale non coerente');manifest={...m,transport:meta.compressed?'gzip':'raw'};loadedAt=Date.now();return manifest})().finally(()=>loading=null);return loading;
}
function covered(p){const b=manifest?.bbox;return !!(b&&p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lon)&&+p.lon>=b[0]&&+p.lat>=b[1]&&+p.lon<=b[2]&&+p.lat<=b[3])}
function outside(){const e=Error('Punto fuori dal grafo pedonale locale');e.code='LOCAL_OUTSIDE';return e}
async function walk(a,b){await ready();if(!covered(a)||!covered(b))throw outside();const r=await rpc('route',{a,b,geometry:true,maxSeconds:14400});if(!r){const e=Error('Nessun percorso pedonale locale');e.code='LOCAL_NO_PATH';throw e}return r}
async function matrix(point,stops,reverse=false){await ready();if(!covered(point)||(stops||[]).some(s=>!covered(s)))throw outside();return rpc('matrix',{point,targets:stops,reverse,maxSeconds:2400})}
async function matrixPairs(links){await ready();if((links||[]).some(l=>!covered(l.from)||!covered(l.to)))throw outside();return rpc('pairs',{links,maxSeconds:1200})}
const isReady=()=>!!(manifest&&loadedAt);
g.UVLocalWalk=Object.freeze({ready,walk,matrix,matrixPairs,covered,isReady,base:BASE});
})(window);

