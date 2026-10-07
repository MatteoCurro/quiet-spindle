const fs=require('fs'),vm=require('vm'),assert=require('assert');
const graphPath=process.argv[2];if(!graphPath)throw Error('usage: node test_walk_graph.cjs graph.bin');
const ctx={console,Map,Set,Math,DataView,Uint8Array,Uint32Array,Uint16Array,Int32Array,Float64Array,ArrayBuffer};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/walk/graph.js','utf8'),ctx);
const buf=fs.readFileSync(graphPath);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength),g=new ctx.UVWalkGraph.Graph(ab);
function route(name,a,b,maxMeters,expect=true){
 const r=g.route(a,b,{geometry:false,maxSeconds:4*3600});
 if(expect){assert(r,name+' should be walkable');assert(r.distance<maxMeters,name+' distance implausible: '+r.distance);}
 else assert(!r,name+' must not invent a pedestrian crossing');
 console.log('PASS',name,r?{seconds:r.seconds,distance:r.distance,visited:r.visited}:null);
}
assert(g.nodeCount>10000,'graph too small');assert(g.edgeCount>g.nodeCount,'graph lacks connectivity');
route('Piazzale Roma → Rialto',{lat:45.4380,lon:12.3181},{lat:45.4380,lon:12.3359},4500,true);
route('Rialto → San Marco',{lat:45.4380,lon:12.3359},{lat:45.4342,lon:12.3388},2500,true);
route('Piazzale Roma → Ferrovia',{lat:45.4380,lon:12.3181},{lat:45.4412,lon:12.3210},1800,true);
route('Sant Elena → Lido SME',{lat:45.4265,lon:12.3635},{lat:45.4174,lon:12.3680},5000,false);
const m=g.matrix({lat:45.4380,lon:12.3181},[
 {id:'rialto',lat:45.4380,lon:12.3359},{id:'san-marco',lat:45.4342,lon:12.3388}
],{maxSeconds:3600});assert.equal(m.length,2);assert(m.every(x=>x.exact&&x.verified));console.log('PASS local one-to-many matrix',m.map(x=>({id:x.id,seconds:x.seconds,distance:x.distance})));
console.log('RESULT: local pedestrian graph checks passed.',{nodes:g.nodeCount,edges:g.edgeCount,bytes:buf.length});
