const fs=require('fs'),assert=require('assert');
const path=require('path');
const root=path.join(__dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/reuse-first.json'),'utf8'));
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('policy covers parser validator storage',()=>{
 for(const x of ['parser','validator','storage'])assert(cfg.policy.review_required_for.includes(x));
});
check('direct-use license allowlist is permissive only',()=>{
 assert.deepEqual(cfg.policy.allowed_direct_licenses,['MIT','Apache-2.0']);
});
check('all candidates pin immutable upstream commits',()=>{
 for(const x of cfg.candidates)assert(/^[0-9a-f]{40}$/.test(x.commit),x.id);
});
check('every custom parser validator storage has reviewed candidates',()=>{
 for(const x of cfg.custom_components){
  assert(cfg.policy.review_required_for.includes(x.category),x.path);
  assert(Array.isArray(x.reviewed_candidates)&&x.reviewed_candidates.length>0,x.path);
 }
});
check('managed parser validator storage paths are registered',()=>{
 const listed=new Set(cfg.custom_components.map(x=>x.path.split('::')[0]));
 const patterns=cfg.policy.managed_path_patterns.map(x=>new RegExp(x));
 function walk(dir,base=''){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(['.git','node_modules'].includes(entry.name))continue;
   const rel=base?base+'/'+entry.name:entry.name;
   const full=path.join(dir,entry.name);
   if(entry.isDirectory())out.push(...walk(full,rel));
   else out.push(rel);
  }
  return out;
 }
 const managed=walk(root).filter(p=>patterns.some(re=>re.test(p)));
 for(const p of managed)assert(listed.has(p),'unregistered reuse-first managed component: '+p);
});

check('all reviewed candidate references exist',()=>{
 const ids=new Set(cfg.candidates.map(x=>x.id));
 for(const x of cfg.custom_components)for(const id of x.reviewed_candidates)assert(ids.has(id),id);
});
check('custom retention decisions include concrete rationale',()=>{
 for(const x of cfg.custom_components){
  assert.equal(x.decision,'retain_custom');
  assert(x.reason&&x.reason.length>40,x.path);
 }
});
check('canonical static GTFS validator is adopted as gate',()=>{
 const x=cfg.candidates.find(x=>x.id==='mobilitydata-gtfs-validator');
 assert(x);assert.equal(x.license,'Apache-2.0');assert.equal(x.decision,'adopt');assert.equal(x.scope,'release_or_ingest_gate');
});
check('GTFS-RT official bindings remain preferred future parser candidate',()=>{
 const x=cfg.candidates.find(x=>x.id==='mobilitydata-gtfs-realtime-bindings');
 assert(x);assert.equal(x.license,'Apache-2.0');assert.equal(x.decision,'defer');
 assert(cfg.custom_components.find(x=>x.path==='js/core/gtfs-rt.js').reviewed_candidates.includes(x.id));
});
check('node-GTFS is evaluated but not forced into static runtime',()=>{
 const x=cfg.candidates.find(x=>x.id==='blinktag-node-gtfs');
 assert(x);assert.equal(x.license,'MIT');assert.equal(x.decision,'reject_runtime');
});
check('existing adapted upstreams are pinned consistently',()=>{
 const concentrate=cfg.candidates.find(x=>x.id==='mbta-concentrate');
 const oba=cfg.candidates.find(x=>x.id==='onebusaway-application-modules');
 assert.equal(concentrate.commit,'6f29a1a5198ec723a81e396cedc8f831bc31e983');
 assert.equal(oba.commit,'fed9494e4b3ff345efabcd17b9b21fbf2a9dab7e');
});
check('decision document names machine-readable policy source',()=>{
 const doc=fs.readFileSync(path.join(root,'OPEN-SOURCE-REUSE-DECISIONS.md'),'utf8');
 assert(doc.includes('config/reuse-first.json'));
 assert(doc.includes('Mandatory future gate'));
 assert(doc.includes('MobilityData/gtfs-validator'));
 assert(doc.includes('MobilityData/gtfs-realtime-bindings'));
 assert(doc.includes('BlinkTagInc/node-gtfs'));
});
console.log('RESULT: '+n+' reuse-first policy checks passed.');
