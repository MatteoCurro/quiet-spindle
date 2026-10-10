import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const REPOSITORY = "MatteoCurro/paper-kestrel";
const WORKFLOW = "Maintenance pass";
const AUDIENCE = "jarvis-supabase";
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(ISSUER + "/.well-known/jwks"));

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secret = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !secret) throw new Error("Supabase admin environment unavailable");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function text(v: unknown, max = 4000): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).slice(0, max);
}
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
function money(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function normalizeStatus(v: unknown): string {
  const s = String(v || "in_progress");
  if (s === "running" || s === "waiting") return "in_progress";
  if (["queued","in_progress","success","failure","cancelled"].includes(s)) return s;
  return "in_progress";
}
function terminalStatus(eventType: string, status: string) {
  return ["success","failure","cancelled"].includes(status) ||
    ["run_completed","run_failed","run_cancelled","run_succeeded"].includes(eventType);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return response({ ok: true, service: "jarvis-ingest", schema: "agent-v1" });
  if (req.method !== "POST") return response({ error: "method not allowed" }, 405);

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return response({ error: "missing bearer token" }, 401);
    const { payload } = await jwtVerify(auth.slice(7), JWKS, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.repository !== REPOSITORY || String(payload.repository_id) !== "1409141984") {
      return response({ error: "repository identity not allowed" }, 403);
    }
    if (payload.workflow !== WORKFLOW || payload.ref !== "refs/heads/infra/transactional-v2") {
      return response({ error: "workflow or staging ref not allowed" }, 403);
    }

    const body = await req.json();
    const nestedRun = body?.run && typeof body.run === "object" ? body.run : {};
    const nestedEvent = body?.event && typeof body.event === "object" ? body.event : null;
    const eventMessage = text(nestedEvent?.message ?? body.message, 4000);
    const eventKey = text(nestedEvent?.event_key ?? body.event_key, 260);
    // Reject non-idempotent events *before* the run RPC can mutate state.
    if (eventMessage && !eventKey) {
      return response({ error: "idempotent event_key required" }, 400);
    }

    // IDs must originate from signed GitHub OIDC claims, not caller JSON.
    const githubRunId = Number(payload.run_id);
    const runAttempt = Number(payload.run_attempt);
    if (!Number.isSafeInteger(githubRunId) || githubRunId <= 0 ||
        !Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
      return response({ error: "invalid signed GitHub run identity" }, 403);
    }
    if ((body.github_run_id !== undefined && Number(body.github_run_id) !== githubRunId) ||
        (body.run_attempt !== undefined && Number(body.run_attempt) !== runAttempt)) {
      return response({ error: "run identity differs from GitHub token" }, 403);
    }

    const rawEventType = text(nestedEvent?.event_type ?? body.event_type, 120) || "status";
    const eventType = rawEventType.replaceAll(".", "_");
    const eventStatus = text(nestedEvent?.status ?? body.event_status ?? body.status, 80);
    const runStatus = normalizeStatus(body.status ?? nestedRun.status ?? (eventType === "run_failed" ? "failure" : undefined));
    const phase = text(body.phase ?? nestedRun.phase, 120) || "setup";
    const now = new Date().toISOString();
    const admin = adminClient();

    const { data: existing, error: existingError } = await admin
      .from("agent_runs")
      .select("id,pr_urls,started_at,completed_at")
      .eq("github_run_id", githubRunId)
      .eq("run_attempt", runAttempt)
      .maybeSingle();
    if (existingError) throw existingError;

    const incomingPrs: string[] = [];
    const flatPrs = body.pr_urls;
    if (Array.isArray(flatPrs)) for (const x of flatPrs) if (x) incomingPrs.push(String(x));
    if (body.pr_url) incomingPrs.push(String(body.pr_url));
    if (nestedRun.pr_url) incomingPrs.push(String(nestedRun.pr_url));
    const priorPrs = Array.isArray(existing?.pr_urls) ? existing.pr_urls.map(String) : [];
    const prUrls = [...new Set([...priorPrs, ...incomingPrs])];

    const eventAgent = text(nestedEvent?.agent ?? body.agent, 160);
    const activeStatus = String(nestedEvent?.status ?? body.event_status ?? "");
    let activeAgents = Array.isArray(body.active_agents) ? body.active_agents.map(String) : undefined;
    if (!activeAgents && eventAgent) {
      activeAgents = ["working","running","reviewing","checking"].includes(activeStatus) ? [eventAgent] : [];
    }

    const needsInteractionRaw = body.needs_interaction ?? nestedRun.need_owner;
    const needsInteraction = needsInteractionRaw === undefined ? undefined : Boolean(needsInteractionRaw);
    const summary = text(body.summary ?? nestedRun.summary, 4000);
    const interactionReason = text(
      body.interaction_reason ?? (needsInteraction ? summary ?? nestedEvent?.message ?? body.message : null),
      2000
    );

    const inputTokens = num(body.input_tokens ?? nestedRun.prompt_tokens);
    const outputTokens = num(body.output_tokens ?? nestedRun.completion_tokens);
    const cachedTokens = num(body.cached_tokens ?? nestedRun.cached_prompt_tokens);
    const reasoningTokens = num(body.reasoning_tokens ?? nestedRun.reasoning_tokens);
    const estimatedCost = money(body.estimated_cost_usd ?? nestedRun.estimated_cost_usd);

    const runPatch: Record<string, unknown> = {
      github_run_id: githubRunId,
      run_attempt: runAttempt,
      status: runStatus,
      phase,
      last_event_at: now,
      updated_at: now,
    };
    const specPath = text(body.spec_path ?? nestedRun.spec_path, 500);
    if (specPath) runPatch.spec_path = specPath;
    if (summary) runPatch.summary = summary;
    if (needsInteraction !== undefined) runPatch.needs_interaction = needsInteraction;
    if (interactionReason) runPatch.interaction_reason = interactionReason;
    if (activeAgents) runPatch.active_agents = activeAgents;
    if (body.input_tokens !== undefined || nestedRun.prompt_tokens !== undefined) runPatch.input_tokens = inputTokens;
    if (body.output_tokens !== undefined || nestedRun.completion_tokens !== undefined) runPatch.output_tokens = outputTokens;
    if (body.cached_tokens !== undefined || nestedRun.cached_prompt_tokens !== undefined) runPatch.cached_tokens = cachedTokens;
    if (body.reasoning_tokens !== undefined || nestedRun.reasoning_tokens !== undefined) runPatch.reasoning_tokens = reasoningTokens;
    if (body.estimated_cost_usd !== undefined || nestedRun.estimated_cost_usd !== undefined) runPatch.estimated_cost_usd = estimatedCost;
    if (prUrls.length) runPatch.pr_urls = prUrls;

    const startedAt = text(body.started_at ?? nestedRun.started_at, 80);
    const completedAt = text(body.completed_at ?? nestedRun.finished_at, 80);
    if (startedAt) runPatch.started_at = startedAt;
    else if (!existing?.started_at && eventType === "run_started") runPatch.started_at = now;
    if (completedAt) runPatch.completed_at = completedAt;
    else if (terminalStatus(eventType, runStatus)) runPatch.completed_at = now;

    // SECURITY INVOKER PostgreSQL RPC serializes concurrent transitions.
    // An already-terminal run cannot be reopened by an out-of-order event.
    const { data: runId, error: runError } = await admin.rpc(
      "jarvis_ingest_run", { p_patch: runPatch }
    );
    if (runError || typeof runId !== "string") {
      throw new Error("atomic Jarvis run update failed");
    }

    const message = eventMessage;
    if (message) {
      const eventKeyLocal = eventKey;
      const eventRow = {
        run_id: runId,
        event_key: eventKeyLocal ? `${githubRunId}:${runAttempt}:${eventKeyLocal}` : null,
        occurred_at: text(nestedEvent?.event_at ?? body.occurred_at, 80) || now,
        agent: eventAgent,
        event_type: eventType,
        status: eventStatus,
        message,
        handoff_to: text(body.handoff_to ?? nestedEvent?.details?.to, 160),
        model: text(nestedEvent?.model ?? body.model, 160),
        input_tokens: num(nestedEvent?.prompt_tokens ?? body.event_input_tokens),
        output_tokens: num(nestedEvent?.completion_tokens ?? body.event_output_tokens),
        cached_tokens: num(nestedEvent?.cached_prompt_tokens ?? body.event_cached_tokens),
        reasoning_tokens: num(nestedEvent?.reasoning_tokens ?? body.event_reasoning_tokens),
        estimated_cost_usd: money(nestedEvent?.estimated_cost_usd ?? body.event_estimated_cost_usd),
        metadata: nestedEvent?.details && typeof nestedEvent.details === "object"
          ? nestedEvent.details
          : body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      };
      const query = eventRow.event_key
        ? admin.from("agent_events").upsert(eventRow, { onConflict: "event_key", ignoreDuplicates: true })
        : admin.from("agent_events").insert(eventRow);
      const { error: eventError } = await query;
      if (eventError) throw eventError;
    }

    return response({ ok: true, run_id: runId, github_run_id: githubRunId, run_attempt: runAttempt });
  } catch (error) {
    console.error(error);
    return response({ error: error instanceof Error ? error.message : "ingest error" }, 500);
  }
});
