-- TSAND-only: deploy BEFORE the staged jarvis-ingest Edge Function.
-- Atomic terminal-state fence. Unlike a JS read-then-upsert, this is safe
-- under concurrent inserts/upserts for one GitHub run attempt.
-- Requires existing public.agent_runs UNIQUE (github_run_id, run_attempt).
CREATE OR REPLACE FUNCTION public.jarvis_ingest_run(p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result_id uuid;
  requested_status text := p_patch->>'status';
  requested_phase text := p_patch->>'phase';
  steps text[] := ARRAY[
    'queued','setup','planning','architecture','implementation',
    'testing','qa','repair','delivery','done'
  ];
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR (p_patch->>'github_run_id') !~ '^[1-9][0-9]{0,17}$'
     OR (p_patch->>'run_attempt') !~ '^[1-9][0-9]{0,8}$'
     OR requested_status NOT IN ('queued','in_progress','success','failure','cancelled')
     OR requested_phase IS NULL
     OR NOT (requested_phase = ANY(steps))
  THEN RAISE EXCEPTION 'invalid Jarvis run transition'; END IF;

  INSERT INTO public.agent_runs AS previous(
    github_run_id,run_attempt,status,phase,spec_path,summary,
    needs_interaction,interaction_reason,active_agents,input_tokens,
    output_tokens,cached_tokens,reasoning_tokens,estimated_cost_usd,
    pr_urls,started_at,completed_at,last_event_at,updated_at
  )
  VALUES(
    (p_patch->>'github_run_id')::bigint,
    (p_patch->>'run_attempt')::int,
    requested_status,requested_phase,
    p_patch->>'spec_path',p_patch->>'summary',
    COALESCE((p_patch->>'needs_interaction')::boolean,false),
    p_patch->>'interaction_reason',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_patch->'active_agents')),ARRAY[]::text[]),
    COALESCE((p_patch->>'input_tokens')::bigint,0),
    COALESCE((p_patch->>'output_tokens')::bigint,0),
    COALESCE((p_patch->>'cached_tokens')::bigint,0),
    COALESCE((p_patch->>'reasoning_tokens')::bigint,0),
    (p_patch->>'estimated_cost_usd')::numeric,
    COALESCE(p_patch->'pr_urls','[]'::jsonb),
    (p_patch->>'started_at')::timestamptz,
    (p_patch->>'completed_at')::timestamptz,
    now(),now()
  )
  ON CONFLICT(github_run_id,run_attempt) DO UPDATE SET
    status = CASE
      WHEN previous.status IN ('success','failure','cancelled')
        THEN previous.status
      WHEN previous.status='in_progress' AND EXCLUDED.status='queued'
        THEN previous.status
      ELSE EXCLUDED.status END,
    phase = CASE
      WHEN previous.status IN ('success','failure','cancelled')
        THEN previous.phase
      WHEN array_position(steps,EXCLUDED.phase)>=array_position(steps,previous.phase)
        THEN EXCLUDED.phase
      ELSE previous.phase END,
    needs_interaction = CASE
      WHEN previous.status IN ('success','failure','cancelled')
        THEN previous.needs_interaction
      WHEN p_patch ? 'needs_interaction' THEN EXCLUDED.needs_interaction
      ELSE previous.needs_interaction END,
    interaction_reason = COALESCE(EXCLUDED.interaction_reason, previous.interaction_reason),
    spec_path = COALESCE(EXCLUDED.spec_path,previous.spec_path),
    summary = COALESCE(EXCLUDED.summary,previous.summary),
    active_agents = CASE
      WHEN previous.status IN ('success','failure','cancelled')
        OR EXCLUDED.status IN ('success','failure','cancelled')
        THEN ARRAY[]::text[]
      WHEN p_patch ? 'active_agents' THEN EXCLUDED.active_agents
      ELSE previous.active_agents END,
    input_tokens = GREATEST(previous.input_tokens,EXCLUDED.input_tokens),
    output_tokens = GREATEST(previous.output_tokens,EXCLUDED.output_tokens),
    cached_tokens = GREATEST(previous.cached_tokens,EXCLUDED.cached_tokens),
    reasoning_tokens = GREATEST(previous.reasoning_tokens,EXCLUDED.reasoning_tokens),
    estimated_cost_usd = GREATEST(previous.estimated_cost_usd,EXCLUDED.estimated_cost_usd),
    pr_urls = CASE WHEN p_patch ? 'pr_urls' THEN (
      SELECT COALESCE(jsonb_agg(to_jsonb(unique_url)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT value AS unique_url
        FROM (
          SELECT jsonb_array_elements_text(previous.pr_urls) AS value
          UNION ALL
          SELECT jsonb_array_elements_text(EXCLUDED.pr_urls) AS value
        ) links
      ) deduplicated
    ) ELSE previous.pr_urls END,
    started_at = COALESCE(previous.started_at,EXCLUDED.started_at),
    completed_at = CASE
      WHEN previous.status IN ('success','failure','cancelled')
        THEN COALESCE(previous.completed_at,EXCLUDED.completed_at,now())
      WHEN EXCLUDED.status IN ('success','failure','cancelled')
        THEN COALESCE(EXCLUDED.completed_at,now())
      ELSE previous.completed_at END,
    last_event_at=now(),updated_at=now()
  RETURNING id INTO result_id;
  RETURN result_id;
END; $$;

REVOKE ALL ON FUNCTION public.jarvis_ingest_run(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_ingest_run(jsonb) TO service_role;
