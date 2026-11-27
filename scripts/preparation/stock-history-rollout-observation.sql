-- Schema only. The application starts the observation for one authorized location.
DO $guard$
BEGIN
 IF to_regclass('private.stock_history_opening_publications') IS NULL
   OR to_regprocedure('public.pos_stock_history_opening_plan(text,text,text)') IS NULL
   OR to_regprocedure('public.pos_stock_history_publish_opening(text,text,text,uuid,text,text)') IS NULL
   OR to_regprocedure('private.stock_history_cutover_roster(text)') IS NULL
   OR to_regclass('private.stock_history_cutover_enrollment') IS NULL
 THEN RAISE EXCEPTION 'STOCK_ROLLOUT_OPENING_DEPENDENCY_REQUIRED'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.pos_stock_history_initialize_rollout_opening(p_actor text,p_terminal text,p_branch text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 rollout_id uuid;
 verified public.stock_history_baselines%ROWTYPE;
 previous private.stock_history_opening_publications%ROWTYPE;
 plan jsonb;
 receipt jsonb;
BEGIN
 PERFORM private.stock_history_opening_authorize(p_actor,p_terminal,p_branch);
 rollout_id:=left(encode(sha256(convert_to('retail-pos-stock-report-rollout-opening-v1:'||p_branch,'UTF8')),'hex'),32)::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-report-rollout:'||p_branch,0));

 SELECT * INTO verified FROM public.stock_history_baselines
 WHERE store_id=p_branch AND verification_state='verified' ORDER BY cutoff_ticks DESC,id DESC LIMIT 1;
 IF FOUND THEN
  RETURN jsonb_build_object('status','already_verified','branchId',p_branch,'cutoff',verified.cutoff_at_raw);
 END IF;

 SELECT * INTO previous FROM private.stock_history_opening_publications WHERE baseline_id=rollout_id;
 IF FOUND THEN
  IF previous.store_id IS DISTINCT FROM p_branch OR previous.reason IS DISTINCT FROM 'Stock Report rollout'
  THEN RAISE EXCEPTION 'STOCK_ROLLOUT_OPENING_CONFLICT'; END IF;
  RETURN jsonb_build_object('status','recorded','branchId',p_branch,
    'cutoff',to_char(previous.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
    'productCount',previous.pair_count);
 END IF;

 plan:=public.pos_stock_history_opening_plan(p_actor,p_terminal,p_branch);
 IF plan->'ready' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('status','waiting','branchId',p_branch,'reasons',plan->'reasons');
 END IF;
 receipt:=public.pos_stock_history_publish_opening(
   p_actor,p_terminal,p_branch,rollout_id,plan->>'candidateHash','Stock Report rollout');
 RETURN jsonb_build_object('status','recorded','branchId',p_branch,
   'cutoff',receipt->>'observedAt','productCount',(receipt->>'pairCount')::integer);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_initialize_rollout_opening(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_initialize_rollout_opening(text,text,text) TO service_role;

-- Preflight only. A recent signed receipt proves an accepted source prefix,
-- while an exact cutoff still requires the existing writer fence.
CREATE OR REPLACE FUNCTION public.pos_stock_history_rollout_readiness(p_actor text,p_terminal text,p_project text,p_branch text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 roster jsonb;
 writer_count integer:=0;
 confirmed_count integer:=0;
 reasons text[]:=ARRAY[]::text[];
 evidence jsonb;
BEGIN
 PERFORM private.stock_history_opening_authorize(p_actor,p_terminal,p_branch);
 IF NOT EXISTS(SELECT 1 FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project) THEN
  reasons:=array_append(reasons,'ROLLOUT_SCOPE_UNCONFIRMED');
 ELSE
  BEGIN
   roster:=private.stock_history_cutover_roster(p_branch);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN('STOCK_CUTOVER_SCOPE_UNCONFIRMED','STOCK_CUTOVER_ROSTER_UNCONFIRMED') THEN RAISE; END IF;
   reasons:=array_append(reasons,'ROLLOUT_WRITER_ROSTER_UNCONFIRMED');
  END;
 END IF;
 IF roster IS NOT NULL THEN
  writer_count:=jsonb_array_length(roster);
  WITH latest AS MATERIALIZED (
   SELECT e.terminal_id,e.database_id,r.challenge_id
   FROM private.stock_history_cutover_enrollment e
   CROSS JOIN LATERAL (
    SELECT f.challenge_id FROM private.stock_history_frontier_receipts f
    WHERE f.project_origin=p_project AND f.store_id=p_branch AND f.terminal_id=e.terminal_id::text
    ORDER BY f.accepted_at DESC,f.challenge_id DESC LIMIT 1
   ) r WHERE e.store_id=p_branch
  ), fresh AS MATERIALIZED (
   SELECT l.* FROM latest l JOIN private.stock_history_frontier_challenges c ON c.id=l.challenge_id
   WHERE c.expires_at>statement_timestamp()
  ), accepted AS MATERIALIZED (
   SELECT * FROM private.stock_history_opening_latest_frontiers(p_project,p_branch,roster,
    '-infinity'::timestamptz,ARRAY(SELECT f.challenge_id FROM fresh f))
  )
  SELECT count(*)::integer INTO confirmed_count
  FROM fresh f JOIN accepted a ON a.terminal_id=f.terminal_id::text AND a.database_guid=f.database_id;
  IF confirmed_count<>writer_count THEN reasons:=array_append(reasons,'ROLLOUT_WRITERS_PENDING'); END IF;
 END IF;
 IF NOT private.stock_history_opening_capture_ready() THEN reasons:=array_append(reasons,'CAPTURE_CONTRACT_UNVERIFIED'); END IF;
 evidence:=private.stock_history_capture_state(p_branch,(SELECT baseline_id FROM public.stock_history_heads WHERE store_id=p_branch));
 IF (evidence->>'unvalidatedEffects')::bigint>0 THEN reasons:=array_append(reasons,'UNVALIDATED_STOCK_EFFECTS'); END IF;
 IF (evidence->>'captureGaps')::bigint>0 THEN reasons:=array_append(reasons,'CAPTURE_GAPS'); END IF;
 RETURN jsonb_build_object('branchId',p_branch,'writers',writer_count,'confirmed',confirmed_count,'reasons',to_jsonb(reasons));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_rollout_readiness(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_rollout_readiness(text,text,text,text) TO service_role;
