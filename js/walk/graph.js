/* Compact client-side pedestrian graph for U.Venice. Pure JS, no DOM/network. */
(function(g){'use strict';
const HEADER=40,NODE_BYTES=16,EDGE_BYTES=8,CELL=.0025;
const geo=(a,b)=>{const dy=(b.lat-a.lat)*110540,dx=(b.lon-a.lon)*111320*Math.cos(((a.lat+b.lat)/2)*Math.PI/180);return Math.hypot(dx,dy)};
class Heap{
 constructor(){this.a=[]}
 push(p,n){const a=this.a,x=[p,n];a.push(x);let i=a.length-1;while(i){const q=(i-1)>>1;if(a[q][0]<=p)break;a[i]=a[q];i=q;}a[i]=x}
 pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1,r=l+1,j=i;if(l<a.length&&a[l][0]<last[0])j=l;if(r<a.length&&a[r][0]<(j===i?last[0]:a[l][0]))j=r;if(j===i)break;a[i]=a[j];i=j;}a[i]=last}return top}
 get length(){return this.a.length}
}
class Graph{
 constructor(buffer){
  this.buffer=buffer;this.view=new DataView(buffer);
  if(String.fromCharCode(...new Uint8Array(buffer,0,4))!=='UVWG')throw Error('Grafo pedonale non valido');
  this.schema=this.view.getUint32(4,true);if(this.schema!==1)throw Error('Versione grafo pedonale non supportata');
  this.nodeCount=this.view.getUint32(8,true);this.edgeCount=this.view.getUint32(12,true);
  this.minLat=this.view.getInt32(16,true)/1e6;this.minLon=this.view.getInt32(20,true)/1e6;this.maxLat=this.view.getInt32(24,true)/1e6;this.maxLon=this.view.getInt32(28,true)/1e6;
  this.nodeBytes=this.view.getUint32(32,true);this.edgeBytes=this.view.getUint32(36,true);
  if(this.nodeBytes!==NODE_BYTES||this.edgeBytes!==EDGE_BYTES)throw Error('Layout grafo pedonale non compatibile');
  const expected=HEADER+this.nodeCount*this.nodeBytes+this.edgeCount*this.edgeBytes;if(expected>buffer.byteLength)throw Error('Grafo pedonale troncato');
  this.edgeBase=HEADER+this.nodeCount*this.nodeBytes;this.grid=new Map();
  for(let i=0;i<this.nodeCount;i++){const p=this.point(i),x=Math.floor(p.lat/CELL),y=Math.floor(p.lon/CELL),k=x+','+y;let row=this.grid.get(k);if(!row)this.grid.set(k,row=[]);row.push(i)}
 }
 point(i){const o=HEADER+i*this.nodeBytes;return {lat:this.view.getInt32(o,true)/1e6,lon:this.view.getInt32(o+4,true)/1e6}}
 edgeMeta(i){const o=HEADER+i*this.nodeBytes;return {start:this.view.getUint32(o+8,true),count:this.view.getUint16(o+12,true)}}
 edge(i){const o=this.edgeBase+i*this.edgeBytes;return {to:this.view.getUint32(o,true),seconds:this.view.getUint16(o+4,true),distance:this.view.getUint16(o+6,true)}}
 nearest(p,maxMeters=650){
  if(!p||!Number.isFinite(+p.lat)||!Number.isFinite(+p.lon))return null;
  const cx=Math.floor(+p.lat/CELL),cy=Math.floor(+p.lon/CELL);let best=null,bestD=Infinity;
  for(let r=0;r<=6;r++){
   for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){if(r&&Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;for(const i of this.grid.get((cx+dx)+','+(cy+dy))||[]){const d=geo(p,this.point(i));if(d<bestD){bestD=d;best=i}}}
   if(best!==null&&bestD<Math.max(80,r*CELL*85000))break;
  }
  return best!==null&&bestD<=maxMeters?{id:best,distance:bestD,point:this.point(best)}:null;
 }
 route(a,b,options={}){
  const start=this.nearest(a,options.snapMeters||650),end=this.nearest(b,options.snapMeters||650);if(!start||!end)return null;
  if(start.id===end.id){const d=start.distance+end.distance;return {seconds:Math.ceil(d/1.25),distance:Math.round(d),points:options.geometry===false?undefined:[[a.lat,a.lon],[b.lat,b.lon]],visited:1}}
  const n=this.nodeCount,gScore=new Float64Array(n),metersScore=new Float64Array(n),prev=new Int32Array(n),closed=new Uint8Array(n);gScore.fill(Infinity);metersScore.fill(Infinity);prev.fill(-1);
  const heap=new Heap(),target=this.point(end.id),heur=i=>geo(this.point(i),target)/1.32;gScore[start.id]=0;metersScore[start.id]=0;heap.push(heur(start.id),start.id);let visited=0;
  const maxVisited=options.maxVisited||Math.max(50000,Math.min(400000,n)),maxSeconds=options.maxSeconds||14400;
  while(heap.length&&visited<maxVisited){const row=heap.pop(),u=row[1];if(closed[u])continue;closed[u]=1;visited++;if(u===end.id)break;if(gScore[u]>maxSeconds)continue;const m=this.edgeMeta(u);
   for(let k=0;k<m.count;k++){const e=this.edge(m.start+k),v=e.to;if(closed[v])continue;const alt=gScore[u]+e.seconds;if(alt<gScore[v]){gScore[v]=alt;metersScore[v]=metersScore[u]+e.distance;prev[v]=u;heap.push(alt+heur(v),v)}}
  }
  if(!Number.isFinite(gScore[end.id]))return null;
  const snap=start.distance+end.distance,seconds=Math.ceil(gScore[end.id]+snap/1.25),distance=Math.round(metersScore[end.id]+snap);
  let points;if(options.geometry!==false){const ids=[];for(let u=end.id;u>=0;u=prev[u]){ids.push(u);if(u===start.id)break;if(ids.length>n)break}if(ids.at(-1)!==start.id)return null;ids.reverse();points=[[+a.lat,+a.lon],...ids.map(i=>{const p=this.point(i);return [p.lat,p.lon]}),[+b.lat,+b.lon]]}
  return {seconds,distance,points,visited,startSnap:Math.round(start.distance),endSnap:Math.round(end.distance)};
 }
 matrix(point,targets,options={}){
  if(options.reverse)return targets.map(t=>{const r=this.route(t,point,{geometry:false,maxSeconds:options.maxSeconds||2400});return r?{id:t.id,...r,stop:t,verified:true,exact:true}:null}).filter(Boolean);
  const start=this.nearest(point,options.snapMeters||650);if(!start)return [];
  const snapped=targets.map(t=>({target:t,snap:this.nearest(t,options.snapMeters||650)})),wanted=new Map();
  snapped.forEach((x,i)=>{if(x.snap){let a=wanted.get(x.snap.id);if(!a)wanted.set(x.snap.id,a=[]);a.push(i)}});
  if(!wanted.size)return [];
  const n=this.nodeCount,gScore=new Float64Array(n),metersScore=new Float64Array(n),closed=new Uint8Array(n);gScore.fill(Infinity);metersScore.fill(Infinity);const heap=new Heap(),answers=new Array(targets.length);gScore[start.id]=0;heap.push(0,start.id);let left=wanted.size,visited=0;const maxSeconds=options.maxSeconds||2400,maxVisited=options.maxVisited||Math.max(50000,Math.min(400000,n));
  while(heap.length&&left&&visited<maxVisited){const [cost,u]=heap.pop();if(closed[u]||cost!==gScore[u])continue;closed[u]=1;visited++;if(cost>maxSeconds)break;const hit=wanted.get(u);if(hit){for(const i of hit){const x=snapped[i],snap=start.distance+x.snap.distance;answers[i]={id:x.target.id,seconds:Math.ceil(cost+snap/1.25),distance:Math.round(metersScore[u]+snap),stop:x.target,verified:true,exact:true}}wanted.delete(u);left--}
   const m=this.edgeMeta(u);for(let k=0;k<m.count;k++){const e=this.edge(m.start+k),v=e.to,alt=cost+e.seconds;if(alt<gScore[v]){gScore[v]=alt;metersScore[v]=metersScore[u]+e.distance;heap.push(alt,v)}}
  }
  return answers.filter(Boolean);
 }
}
g.UVWalkGraph=Object.freeze({Graph,geo});
})(typeof self!=='undefined'?self:globalThis);
