const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/service-date-resolver.js','utf8'),ctx);
const R=window.UVTransitServiceDateResolver;
let count=0;function test(n,f){f();count++;console.log('PASS '+n)}

const old={id:'old',core:{file:'old-core.json'},schedule:{file:'old-schedule.json'},serviceDates:['20260927','20260928','20260929']};
const latest={id:'latest',core:{file:'new-core.json'},schedule:{file:'new-schedule.json'},serviceDates:['20260929','20260930','20261001']};
const entry={core:latest.core,schedule:latest.schedule,snapshots:[latest,old]};

test('latest publication wins only when it covers the service date',()=>{
  assert.equal(R.resolve(entry,'20260929').snapshot.id,'latest');
  assert.equal(R.resolve(entry,'20260928').snapshot.id,'old');
});
test('overlap is explicit and deterministic',()=>{
  const r=R.resolve(entry,'20260929');assert.equal(r.reason,'overlap_latest_first');assert.equal(r.candidateCount,2);
});
test('uncovered date does not silently select newest snapshot',()=>{
  const r=R.resolve(entry,'20261002');assert.equal(r.snapshot,null);assert.equal(r.reason,'uncovered_service_date');
});
test('legacy manifest remains compatible',()=>{
  const legacy={core:{file:'core.json'},schedule:{file:'schedule.json'}};
  const r=R.resolve(legacy,'20260928');assert(r.snapshot);assert(r.fallback);assert.equal(r.reason,'legacy_unverified');
});
test('service window always includes current and previous Venice service date',()=>{
  const rows=R.relevantServiceDates(Date.parse('2026-09-29T00:30:00+02:00'),'Europe/Rome');
  assert.deepEqual([...rows],['20260929','20260928']);
});
test('audit reports gaps and overlaps',()=>{
  const a=R.audit(entry,['20260928','20260929','20261002']);
  assert.deepEqual([...a.covered],['20260928','20260929']);
  assert.deepEqual([...a.missing],['20261002']);
  assert.equal(a.overlaps.length,1);
});
console.log('RESULT: '+count+' service-date resolver checks passed.');
