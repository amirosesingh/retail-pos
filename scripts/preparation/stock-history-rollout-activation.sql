-- Schema only. Activating an opening requires an authorized cutover lease and
-- a current, persisted local fence from every enrolled writer.
DO $guard$
BEGIN
 IF to_regclass('private.stock_history_cutover_scope') IS NULL
   OR to_regclass('private.stock_history_cutover_leases') IS NULL
   OR to_regprocedure('private.stock_history_cutover_proofs(text,text,private.stock_history_cutover_leases,text,timestamptz,jsonb)') IS NULL
   OR to_regprocedure('private.stock_history_opening_candidate(text)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROLLOUT_DEPENDENCY_REQUIRED'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.pos_stock_history_activate_rollout(p_subject text,p_terminal text,p_project text,
 p_branch text,p_id uuid,p_proofs jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 actor uuid;
 gate private.stock_history_cutover_scope%ROWTYPE;
 lease private.stock_history_cutover_leases%ROWTYPE;
 prior public.stock_history_baselines%ROWTYPE;
 head public.stock_history_heads%ROWTYPE;
 proof_claims jsonb;
 candidate jsonb;
 after_candidate jsonb;
 evidence jsonb;
 activated_at timestamptz;
 cutoff_raw text;
 cutoff_ticks numeric;
 source_cursor bigint;
 expected integer;
 inserted integer;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR jsonb_typeof(p_proofs) IS DISTINCT FROM 'array' OR current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_INVALID'; END IF;
 IF jsonb_array_length(p_proofs) NOT BETWEEN 1 AND 16 OR octet_length(convert_to(p_proofs::text,'UTF8'))>16384
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID'; END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED'; END IF;
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND OR (lease.witness_id,lease.witness_subject,lease.witness_terminal) IS DISTINCT FROM (actor,p_subject,p_terminal)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED'; END IF;

 SELECT * INTO prior FROM public.stock_history_baselines WHERE id=p_id;
 IF FOUND THEN
  IF prior.store_id IS DISTINCT FROM p_branch OR prior.opening_kind IS DISTINCT FROM 'system_snapshot'
   OR prior.verification_state IS DISTINCT FROM 'verified'
   OR prior.terminal_watermarks->>'kind' IS DISTINCT FROM 'fenced_rollout_snapshot'
   OR prior.terminal_watermarks->>'projectOrigin' IS DISTINCT FROM p_project
   OR prior.verified_by IS DISTINCT FROM actor::text
   OR prior.terminal_watermarks->'proofs' IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x->>'terminalId') FROM jsonb_array_elements(p_proofs) x)
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_REPLAY_CONFLICT'; END IF;
  RETURN jsonb_build_object('baselineId',prior.id,'branchId',prior.store_id,'cutoff',prior.cutoff_at_raw,
   'verificationState','verified','openingKind','system_snapshot','productCount',prior.expected_pairs);
 END IF;

 IF gate.active_id IS DISTINCT FROM p_id OR lease.armed_at IS NOT NULL OR lease.released_at IS NOT NULL
  OR lease.expired_write_at IS NOT NULL OR clock_timestamp()>=lease.expires_at
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED'; END IF;
 SELECT * INTO head FROM public.stock_history_heads WHERE store_id=p_branch FOR UPDATE NOWAIT;
 IF head.baseline_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id=p_branch AND verification_state='verified')
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ALREADY_PUBLISHED'; END IF;
 proof_claims:=private.stock_history_cutover_proofs(p_branch,p_project,lease,'arm',lease.issued_at,p_proofs);
 IF NOT private.stock_history_cutover_stock_keys_ready(p_branch) THEN RAISE EXCEPTION 'STOCK_CUTOVER_STOCK_KEYS_UNCONFIRMED'; END IF;

 -- The exact branch writer sentinel remains locked from before the capture
 -- until the opening and coverage head commit. The cutover helper checks
 -- every local persisted fence, physical database and accepted prefix against
 -- this same lease. A release or a lost fence cannot supply another cutoff.
 candidate:=private.stock_history_opening_candidate(p_branch);
 IF candidate->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'STOCK_CUTOVER_SOURCE_CHANGED'; END IF;
 activated_at:=clock_timestamp();
 IF activated_at<lease.issued_at OR activated_at>=lease.expires_at THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED'; END IF;
 cutoff_raw:=private.stock_history_cutover_utc(activated_at);
 cutoff_ticks:=private.stock_history_ticks(cutoff_raw);
 source_cursor:=(candidate->'source'->'head'->>'cursor')::bigint;
 expected:=(candidate->>'pairCount')::integer;
 IF source_cursor IS DISTINCT FROM COALESCE(head.committed_cursor,0) THEN RAISE EXCEPTION 'STOCK_CUTOVER_SOURCE_CHANGED'; END IF;
 evidence:=jsonb_build_object('version',1,'kind','fenced_rollout_snapshot','projectOrigin',p_project,
  'sourceCursor',source_cursor::text,'candidateHash',candidate->>'candidateHash','snapshotHash',candidate->>'snapshotHash',
  'proofs',proof_claims,'scopedWriterCohort',candidate->'cohort');
 INSERT INTO public.stock_history_baselines
  (id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,
   expected_pairs,terminal_watermarks,verified_by,evidence_hash)
 VALUES (p_id,p_branch,cutoff_raw,cutoff_ticks,cutoff_raw,cutoff_ticks,source_cursor,'system_snapshot','verified',
  expected,evidence,actor::text,encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
 INSERT INTO public.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode,owner_store_id)
 SELECT gen_random_uuid(),p_id,(item->>'id')::uuid,p_branch,(item->>'quantity')::numeric,
  item->>'name',item->>'sku',item->>'barcode',item->>'owner_store_id'
 FROM jsonb_array_elements(candidate->'pairs') item;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted<>expected THEN RAISE EXCEPTION 'STOCK_CUTOVER_OPENING_INVALID'; END IF;
 after_candidate:=private.stock_history_opening_candidate(p_branch);
 IF (after_candidate->>'candidateHash') IS DISTINCT FROM (candidate->>'candidateHash')
  OR after_candidate->'ready' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SOURCE_CHANGED'; END IF;
 INSERT INTO public.stock_history_heads(store_id,committed_cursor,coverage_generation,coverage_state,baseline_id,
   coverage_from_ticks,coverage_through_ticks,terminal_watermarks,updated_at)
 VALUES(p_branch,source_cursor,1,'complete',p_id,cutoff_ticks,cutoff_ticks,evidence,activated_at)
 ON CONFLICT(store_id) DO UPDATE SET baseline_id=excluded.baseline_id,
  coverage_generation=public.stock_history_heads.coverage_generation+1,coverage_state=excluded.coverage_state,
  coverage_from_ticks=excluded.coverage_from_ticks,coverage_through_ticks=excluded.coverage_through_ticks,
  terminal_watermarks=excluded.terminal_watermarks,updated_at=excluded.updated_at;
 -- Enter the existing armed state so the documented release workflow can
 -- return both the hosted guard and the local writer fences to service.
 UPDATE private.stock_history_cutover_leases SET armed_at=activated_at,cutoff_at=cutoff_raw,arm_claims=proof_claims WHERE id=p_id;
 UPDATE private.stock_history_cutover_scope SET gate_revision=gate_revision+1 WHERE store_id=p_branch;
 IF clock_timestamp()>=lease.expires_at THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED'; END IF;
 RETURN jsonb_build_object('baselineId',p_id,'branchId',p_branch,'cutoff',cutoff_raw,
  'verificationState','verified','openingKind','system_snapshot','productCount',expected);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_activate_rollout(text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_activate_rollout(text,text,text,text,uuid,jsonb) TO service_role;
