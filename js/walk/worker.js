'use strict';
importScripts('graph.js'+(self.location.search||''));
let graph=null,meta=null;
async function load(data){
 let buffer,compressed=false;
 if(data.gzipUrl&&typeof DecompressionStream==='function'){
  const r=await fetch(data.gzipUrl,{cache:'force-cache'});if(!r.ok)throw Error('Grafo pedonale gzip HTTP '+r.status);
  const encoded=(r.headers.get('content-encoding')||'').toLowerCase();
  if(encoded.includes('gzip'))buffer=await r.arrayBuffer();
  else{const stream=r.body.pipeThrough(new DecompressionStream('gzip'));buffer=await new Response(stream).arrayBuffer();}
  compressed=true;
 }else{
  const r=await fetch(data.url,{cache:'force-cache'});if(!r.ok)throw Error('Grafo pedonale HTTP '+r.status);buffer=await r.arrayBuffer();
 }
 graph=new UVWalkGraph.Graph(buffer);meta={nodes:graph.nodeCount,edges:graph.edgeCount,bbox:[graph.minLon,graph.minLat,graph.maxLon,graph.maxLat],compressed};return meta;
}
self.onmessage=async e=>{const {id,type,data}=e.data||{};try{
 let result;
 if(type==='load')result=await load(data);
 else{
  if(!graph)throw Error('Grafo pedonale non caricato');
  if(type==='route')result=graph.route(data.a,data.b,{geometry:data.geometry!==false,maxSeconds:data.maxSeconds||14400});
  else if(type==='matrix')result=graph.matrix(data.point,data.targets,{reverse:!!data.reverse,maxSeconds:data.maxSeconds||2400});
  else if(type==='pairs'){result=[];for(const link of data.links||[]){const r=graph.route(link.from,link.to,{geometry:false,maxSeconds:data.maxSeconds||1200});result.push(r?{key:link.key,...r,verified:true,exact:true}:{key:link.key,blocked:true,verified:true,exact:true});}}
  else if(type==='meta')result=meta;
  else throw Error('Operazione grafo pedonale sconosciuta');
 }
 postMessage({id,result});
}catch(err){postMessage({id,error:err?.message||String(err)})}};
