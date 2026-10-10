/** Authentication and transactional state guardrails: no credentials, no DB writes. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../supabase/functions/jarvis-ingest/index.ts'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'../server/supabase/jarvis-run-transition.sql'),'utf8');

test('OIDC repository, workflow, branch and signed run IDs are strict',()=>{
  assert.match(src,/String\(payload\.repository_id\) !== "1409141984"/);
  assert.match(src,/payload\.workflow !== WORKFLOW/);
  assert.match(src,/payload\.ref !== "refs\/heads\/infra\/transactional-v2"/);
  assert.match(src,/const githubRunId = Number\(payload\.run_id\)/);
  assert.match(src,/const runAttempt = Number\(payload\.run_attempt\)/);
  assert.match(src,/run identity differs from GitHub token/);
  assert.doesNotMatch(src,/Number\(body\.github_run_id \?\? payload\.run_id\)/);
});
test('edge uses single transactional security-invoker RPC rather than blind upsert',()=>{
  assert.match(src,/admin\.rpc\(\s*"jarvis_ingest_run"/);
  assert.doesNotMatch(src,/\.upsert\(runPatch/);
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/ON CONFLICT\(github_run_id,run_attempt\) DO UPDATE/);
  assert.match(sql,/previous\.status IN \('success','failure','cancelled'\)/);
  assert.match(sql,/previous\.status='in_progress' AND EXCLUDED\.status='queued'/);
});
test('event delivery requires idempotency and least privilege',()=>{
  assert.match(src,/idempotent event_key required/);
  assert.match(src,/onConflict: "event_key", ignoreDuplicates: true/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.jarvis_ingest_run\(jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.jarvis_ingest_run\(jsonb\) TO service_role/);
});
