# Jarvis — staged corrections after CrewAI review (TSAND)

## Scope and environment boundaries

- **Target:** `quiet-spindle:t-sand`, draft PR only. No merge, deployment or production access.
- **Source baseline:** the actual active Supabase TSAND Edge Functions `jarvis` v4 and `jarvis-ingest` v4 (read from TSAND on 2026-10-10).
- Changes in this PR are **not deployed**. Current TSAND Edge Functions remain unchanged.
- `jarvis-dashboard` is a separate, older Edge Function and is **not** replaced by this PR.
- No private user records, service-role keys, SSH credentials, or OAuth secrets included.

## Independent review outcomes

**Product Engineering (evidence-driven):**
1. The real `jarvis` frontend added `cached_tokens` and `reasoning_tokens` to the input+output total. These are nested subsets; correct it by showing input+output only. SQL audit of 10 historical TSAND runs showed 6,815,816 true tokens versus 11,306,324 from the old frontend formula (+65.9%).
2. On failed run or event queries, the frontend could present an empty or stale view without a visible error. A dedicated error/status notice now distinguishes failures.
3. Selecting runs quickly could apply a delayed event response from the previously selected run. Request identity + sequence IDs prevent this.
4. The `jarvis-ingest` endpoint previously took GitHub run IDs from unsigned JSON when present. They are now derived from signed GitHub OIDC claims, and mismatched JSON IDs are rejected.

**UX Critic (product-value feedback and acceptance criteria):**
- Do not show operators a silently empty timeline after a failed fetch.
- Make inactivity visible with the timestamp of the latest event and a **warning** after 15 minutes for active runs; do not falsely label a run failed.
- Avoid unnecessary visual redesign. Retain current mobile breakpoints and the accessible page structure. Request browser-based mobile regression checks separately.

**Independent Reviewer (cautious gate):**
- Late or concurrent events must never reopen a terminal run. A read-then-upsert in Edge is not atomic; migrate to a single PostgreSQL `ON CONFLICT ... DO UPDATE` RPC that fences terminal statuses and preserves monotonic counters.
- Execute SQL permissions and late-event tests inside a transaction rolled back in TSAND. Ensure only `service_role` can call the RPC; no anonymous access.
- Verify end-to-end authenticated ingestion and browser/mobile behavior **before** any TSAND deployment, which is not part of this PR.

## Changed files

- `supabase/functions/jarvis/index.ts` — frontend update.
- `supabase/functions/jarvis-ingest/index.ts` — GitHub OIDC identity checks, idempotent key validation, atomic PostgreSQL run patch.
- `server/supabase/jarvis-run-transition.sql` — **review-only SQL**; must be applied to TSAND before staging ingestion Edge.
- `tests/jarvis-tsand-ui.test.cjs` — executes actual frontend module in a mocked DOM (token math, stale states, race, errors, admin access).
- `tests/jarvis-tsand-ingest.test.cjs` — static OIDC / RPC / least-privilege policy checks.
- `.github/workflows/jarvis-tsand-review-tests.yml` — public read-only offline CI; no secrets, deploy or push permission.

## Validation already performed

- SQL function was created and exercised inside `BEGIN ... ROLLBACK` on **TSAND only**. Assertions for terminal state, phase monotonicity, counters, retained PR links and absence of anonymous EXECUTE all passed. The function and synthetic rows were rolled back.
- Node 22 regression tests are run on GitHub-hosted public Actions. Check the latest successful run on this PR; don't infer green status from the absence of a result.
- No paid CrewAI call executed for this code change. Previous three-agent Jarvis review canary completed independently on 2026-10-10, for USD 0.003391.

## Controlled TSAND rollout, only after approval

1. Review the PR diff and ensure that the function versions match the active TSAND baseline.
2. Apply `server/supabase/jarvis-run-transition.sql` to TSAND and verify `service_role` EXECUTE / `anon` denial.
3. Deploy **only TSAND** `jarvis-ingest` vNext, then TSAND `jarvis` vNext; never touch production endpoints.
4. Exercise valid signed GitHub OIDC and deliberate body run-ID mismatch; ensure the latter gets HTTP 403 and no rows change.
5. Exercise late terminal events; verify SQL immutability of terminal state and idempotent event keys, and confirm correct token totals through an administrator login.
6. Check responsive layout on a mobile device and in browser devtools. If tests fail, roll back Edge to saved v4 source; SQL RPC can remain unused and restricted.
7. Keep `t-sand` branch as PR base; do not merge to private product or public `main`.

### Known follow-ups

- `jarvis-dashboard` remains a separate legacy UI and should be consolidated after identifying its users; do not silently replace it.
- Consider using a last-event timer/refetch to update a stale warning while an admin keeps the page open (current warning updates when the run card re-renders).
- Assess stronger event/run atomicity if it becomes necessary to require event and state update in the same transaction; the current idempotent outbox allows safe retries but the two writes are not one DB transaction.

## TSAND acceptance test executed 2026-10-10

**Target verified:** Supabase project `u-venice-transport-tsand` (`xiiexzvuvzsiacbmwras`). This test deliberately used parallel, version-1 functions `jarvis-preview` and `jarvis-ingest-preview` and did **not** replace the active `jarvis` or `jarvis-ingest` version 4 functions.

- Applied `public.jarvis_ingest_run(jsonb)` to TSAND only. Checked `service_role` EXECUTE = true, `anon` and `authenticated` EXECUTE = false.
- For the preview ingestion function only, required GitHub OIDC `repository_id=1409141984`, `workflow_ref=MatteoCurro/paper-kestrel/.github/workflows/jarvis-tsand-ingest-smoke.yml@refs/heads/infra/transactional-v2`, workflow name `Jarvis TSAND ingest smoke`, and event keys starting `smoke:`. Those smoke-specific auth changes were **not** applied to the draft production-path `jarvis-ingest` source.
- **[GitHub Actions #38073982335](https://github.com/MatteoCurro/paper-kestrel/actions/runs/38073982335)**: OIDC GET/POST tests succeeded, HTTP 401 without token, HTTP 403 for mismatch with signed run identity, started → finished → late event → duplicate finish. PostgreSQL verifies final `success/done`, 180 input + 40 output tokens, 3 unique events. No LLM cost or deployment.
- Real Chromium mobile (390px) and desktop (1280px) browser layout tests run on the PR's standalone public Actions workflow, with actual frontend HTML extracted from the Edge source and served by an ephemeral local HTTP server. Login UI and a **synthetic** dashboard were checked without user records or admin credentials. Screenshots are attached to Actions as `jarvis-tsand-browser-preview`.
- **Critical platform discovery:** Supabase shared domains intentionally rewrite `text/html` responses from Edge Functions to `text/plain`. The `jarvis-preview` URL is an API/source endpoint, **not a directly usable browser UI**, despite HTTP 200. This is documented by [Supabase](https://supabase.com/docs/guides/functions/http-methods). Do not circumvent the MIME restriction. The Jarvis frontend requires a separate approved static host (ideally a dedicated staging origin, not the production website) before live OAuth/browser-login acceptance.
- No real administrator session was used; therefore the authenticated dashboard display, OAuth redirect and private realtime subscription remain pending. Node UI behavior and SQL RLS policies were verified separately.
- Public test function/source is isolated to TSAND; no production servers, code branches or deployment secrets were changed.
