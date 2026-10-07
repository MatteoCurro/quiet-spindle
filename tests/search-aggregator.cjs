const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/../js/entities/search-aggregator.js','utf8');
const sandbox={};sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInContext(source,vm.createContext(sandbox),{filename:'js/entities/search-aggregator.js'});
const A=sandbox.UVTransitSearchAggregator;
assert(A);

(async()=>{
  const calls=[];
  const engine=A.create({
    entities:async q=>{calls.push('entities');return [
      {id:'poi:rialto',type:'poi',name:'Ponte di Rialto',lat:45.438,lon:12.336,score:0,entity:{priority:100}},
      {id:'hub:rialto',type:'transport_hub',name:'Rialto',lat:45.4378,lon:12.3359,score:5,entity:{priority:95}}
    ]},
    stops:async q=>{calls.push('stops');return [{id:'nav:RIALTO-A',name:'Rialto A',lat:45.4377,lon:12.3358,network:'nav',lines:['1','2']}]},
    local:async q=>{calls.push('local');return [{name:'Riva del Carbon, Venezia',kind:'street',lat:45.4372,lon:12.3348,place:true}]},
    remote:async q=>{calls.push('remote');return [
      {name:'Ponte di Rialto, Venezia',kind:'place',lat:45.4381,lon:12.3359,place:true},
      {name:'Rialto Mercato, Venezia',kind:'stop',lat:45.4391,lon:12.3342,place:true}
    ]}
  });
  const rows=await engine.search('rialto',{locale:'it',limit:8});
  assert.deepEqual(calls.sort(),['entities','local','remote','stops']);
  assert.equal(rows[0].id,'poi:rialto','stable high-confidence POI must rank first');
  assert(rows.some(r=>r.id==='nav:RIALTO-A'&&r.type==='stop'),'runtime stop must be included');
  assert(rows.some(r=>r.source==='comune-venezia'&&r.type==='street'),'local street must remain available');
  assert(rows.some(r=>r.source==='photon'),'Photon results must be blended even when local results exist');
  console.log('PASS aggregator blends entity, stop, TopoCivici and Photon sources');

  const filtered=await engine.search('rialto',{types:['stop'],limit:10});
  assert(filtered.length>=1&&filtered.every(r=>r.type==='stop'));
  console.log('PASS type filtering works after source aggregation');

  const resilient=A.create({
    entities:async()=>{throw Error('registry down')},
    stops:async()=>[{id:'s1',name:'San Marco Vallaresso',lat:45.432,lon:12.337}],
    local:async()=>{throw Error('local index down')},
    remote:async()=>[{name:'San Marco, Venezia',kind:'place',lat:45.434,lon:12.339,place:true}]
  });
  const degraded=await resilient.search('san marco');
  assert(degraded.some(r=>r.id==='s1'));
  assert(degraded.some(r=>r.source==='photon'));
  console.log('PASS one failed source cannot break unified search');

  const duplicate=A.create({
    entities:async()=>[],
    stops:async()=>[],
    local:async()=>[
      {id:'same',name:'Via Torino',kind:'street',lat:45.48,lon:12.25,place:true},
      {id:'same',name:'Via Torino',kind:'street',lat:45.48,lon:12.25,place:true}
    ],
    remote:async()=>[]
  });
  const unique=await duplicate.search('via torino');
  assert.equal(unique.length,1);
  console.log('PASS exact identity duplicates are collapsed');

  assert.equal(A.normalize('Piazza San Marco'),'piazza san marco');
  assert(A.textScore('Piazza San Marco','piazza san marco')<A.textScore('Piazza San Marco','san marco'));
  console.log('PASS deterministic textual ranking primitives');
})().catch(e=>{console.error(e);process.exitCode=1});
