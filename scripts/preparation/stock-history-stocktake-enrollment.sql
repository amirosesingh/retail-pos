-- Reviewed schema only. The authenticated application enrolls each physical
-- till and replaces the unused pilot guard through the RPC below.
ALTER TABLE private.stock_history_cutover_scope ADD COLUMN retired_at timestamptz;
ALTER TABLE private.stock_history_cutover_scope DROP CONSTRAINT stock_history_cutover_scope_singleton_key;
CREATE UNIQUE INDEX stock_history_cutover_scope_current_idx
 ON private.stock_history_cutover_scope(singleton) WHERE retired_at IS NULL;

CREATE TABLE private.stock_history_pilot_enrollment_receipts(
 store_id text NOT NULL,previous_store_id text NOT NULL,project_origin text NOT NULL,
 terminal_id uuid NOT NULL,database_id uuid NOT NULL,author_id uuid NOT NULL,marker text NOT NULL,cohort jsonb NOT NULL,
 challenge_id uuid NOT NULL UNIQUE REFERENCES private.stock_history_frontier_receipts(challenge_id),
 enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(store_id,terminal_id),UNIQUE(store_id,database_id),UNIQUE(store_id,author_id)
);
ALTER TABLE private.stock_history_pilot_enrollment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_pilot_enrollment_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_pilot_enrollment_receipts_immutable
 BEFORE UPDATE OR DELETE ON private.stock_history_pilot_enrollment_receipts
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION public.pos_stock_history_enroll_stocktake_till(p_subject text,p_terminal text,p_project text,p_branch text,
 p_previous text,p_marker text,p_cohort jsonb,p_database uuid,p_challenge uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;proof private.stock_history_frontier_receipts%ROWTYPE;gate private.stock_history_cutover_scope%ROWTYPE;
 canonical_cohort jsonb;terminals uuid[];databases uuid[];authors uuid[];enrolled_count integer;ready boolean:=false;rel text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR p_project IS NULL OR length(p_project)>255
  OR p_project!~'^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' OR p_branch IS NULL OR p_branch!~'^codex-stock401-[a-f0-9]{6,64}$'
  OR p_previous IS NULL OR p_previous!~'^codex-stock401-[a-f0-9]{6,64}$' OR p_previous=p_branch
  OR p_marker IS DISTINCT FROM upper(p_branch COLLATE "C") OR p_database IS NULL OR p_challenge IS NULL
  OR jsonb_typeof(p_cohort) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_INVALID';END IF;
 IF jsonb_array_length(p_cohort)<>2 OR octet_length(p_cohort::text)>512
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_cohort) AS member(value)
  WHERE CASE WHEN jsonb_typeof(value)='object' THEN value-'terminalId'-'databaseId'-'authorId'<>'{}'::jsonb
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['terminalId','databaseId','authorId']) AS field(key)
    WHERE jsonb_typeof(value->key) IS DISTINCT FROM 'string' OR value->>key!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
   ELSE true END) THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_INVALID';END IF;
 SELECT jsonb_agg(value ORDER BY value->>'terminalId' COLLATE "C"),
  array_agg((value->>'terminalId')::uuid ORDER BY value->>'terminalId' COLLATE "C"),
  array_agg((value->>'databaseId')::uuid ORDER BY value->>'terminalId' COLLATE "C"),
  array_agg((value->>'authorId')::uuid ORDER BY value->>'terminalId' COLLATE "C")
 INTO canonical_cohort,terminals,databases,authors FROM jsonb_array_elements(p_cohort) AS member(value);
 IF terminals[1]=terminals[2] OR databases[1]=databases[2] OR authors[1]=authors[2]
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_INVALID';END IF;

 IF NOT pg_try_advisory_xact_lock(hashtextextended('stock-history-stocktake-pilot-enrollment',0))
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_BUSY';END IF;
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF NOT EXISTS(SELECT 1 FROM unnest(terminals,databases,authors) AS expected(terminal_id,database_id,author_id)
  WHERE expected.terminal_id::text=p_terminal AND expected.database_id=p_database AND expected.author_id=actor)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO proof FROM private.stock_history_frontier_receipts WHERE challenge_id=p_challenge AND project_origin=p_project
  AND store_id=p_branch AND terminal_id=p_terminal AND database_guid=p_database AND author_id=actor AND prefix_state='accepted';
 IF NOT FOUND OR proof.accepted_at<clock_timestamp()-interval '5 minutes' OR proof.accepted_at>clock_timestamp()
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_PROOF_REQUIRED';END IF;
 PERFORM private.stock_history_frontier_identity(p_project,p_branch,p_terminal,actor,proof.key_id);
 IF NOT EXISTS(SELECT 1 FROM public.stores s WHERE s.id=p_branch AND s.code=p_marker AND s.parent_id IS NULL
  AND s.group_id='codex-stock401-cluster-'||substr(p_branch,length('codex-stock401-')+1)
  AND s.is_active AND s.archived_at IS NULL AND s.private_catalogue)
 OR EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.location_id=p_branch
   AND t.id::text NOT IN(terminals[1]::text,terminals[2]::text))
 OR (SELECT count(*) FROM unnest(terminals,authors) AS expected(terminal_id,author_id)
   JOIN public.terminal_tokens t ON t.id::text=expected.terminal_id::text AND t.location_id=p_branch AND t.platform='pc'
    AND t.status IN('used','active') AND t.revoked_at IS NULL AND (t.is_claimed OR t.claimed_at IS NOT NULL)
    AND NOT COALESCE(t.management_sync_enabled,false)
   JOIN public.app_users a ON a.id=expected.author_id AND a.store_id=p_branch AND a.is_active
    AND (a.role::text='admin' OR a.role_slug='admin'))<>2
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROSTER_UNCONFIRMED';END IF;
 IF EXISTS(SELECT 1 FROM private.stock_history_pilot_enrollment_receipts r WHERE r.store_id=p_branch AND
  ROW(r.previous_store_id,r.project_origin,r.marker,r.cohort) IS DISTINCT FROM ROW(p_previous,p_project,p_marker,canonical_cohort))
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_CONFLICT';END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE retired_at IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND OR gate.project_origin<>p_project OR gate.store_id NOT IN(p_previous,p_branch)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;
 IF gate.store_id=p_previous AND (gate.marker<>upper(p_previous COLLATE "C")
  OR gate.cluster_id<>'codex-stock401-cluster-'||substr(p_previous,length('codex-stock401-')+1)
  OR gate.active_id IS NOT NULL OR gate.gate_revision<>0
  OR EXISTS(SELECT 1 FROM private.stock_history_cutover_leases WHERE store_id=p_previous)
  OR EXISTS(SELECT 1 FROM private.stock_history_cutover_publications WHERE store_id=p_previous)
  OR EXISTS(SELECT 1 FROM private.stock_history_stocktakes WHERE store_id=p_previous)
  OR EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id IN(p_previous,p_branch))
  OR (SELECT count(*) FROM private.stock_history_cutover_enrollment WHERE store_id=p_previous)<>2
  OR NOT private.stock_history_cutover_guard_ready(p_previous,gate.cluster_id)
  OR NOT private.stock_history_opening_capture_ready())
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;

 INSERT INTO private.stock_history_pilot_enrollment_receipts(store_id,previous_store_id,project_origin,terminal_id,
  database_id,author_id,marker,cohort,challenge_id)
 VALUES(p_branch,p_previous,p_project,p_terminal::uuid,p_database,actor,p_marker,canonical_cohort,p_challenge)
 ON CONFLICT(store_id,terminal_id) DO NOTHING;
 SELECT count(*) INTO enrolled_count FROM private.stock_history_pilot_enrollment_receipts WHERE store_id=p_branch;
 IF enrolled_count=2 THEN
  IF gate.store_id=p_branch THEN
   -- An exact retry confirms the existing cohort without touching its lease.
   IF gate.marker<>p_marker OR EXISTS(SELECT 1 FROM unnest(terminals,databases) AS expected(terminal_id,database_id)
    WHERE NOT EXISTS(SELECT 1 FROM private.stock_history_cutover_enrollment e WHERE e.store_id=p_branch
     AND e.terminal_id=expected.terminal_id AND e.database_id=expected.database_id))
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_ENROLLMENT_CONFLICT';END IF;
   PERFORM private.stock_history_cutover_roster(p_branch);
  ELSE
   -- Keep the original guard rollback-safe. NOWAIT leaves ordinary business
   -- writes alone and lets the same enrollment retry if a writer is active.
   LOCK TABLE public.products,public.terminal_tokens,public.stores,public.stock_transfers,public.stock_transfer_items
    IN ACCESS EXCLUSIVE MODE NOWAIT;
   IF NOT private.stock_history_cutover_guard_ready(p_previous,gate.cluster_id)
    OR NOT private.stock_history_opening_capture_ready()
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;
   IF EXISTS(SELECT 1 FROM private.stock_history_pilot_enrollment_receipts r
    JOIN private.stock_history_frontier_receipts f ON f.challenge_id=r.challenge_id
    WHERE r.store_id=p_branch AND private.stock_history_stocktake_authorize(
     (f.proof_json::jsonb)->>'subject',r.terminal_id::text,p_branch) IS DISTINCT FROM r.author_id)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';END IF;
   PERFORM private.stock_history_frontier_identity(p_project,p_branch,r.terminal_id::text,r.author_id,f.key_id)
    FROM private.stock_history_pilot_enrollment_receipts r
    JOIN private.stock_history_frontier_receipts f ON f.challenge_id=r.challenge_id
    WHERE r.store_id=p_branch;
   IF EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.location_id=p_branch
     AND t.id::text NOT IN(terminals[1]::text,terminals[2]::text))
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROSTER_UNCONFIRMED';END IF;
   UPDATE private.stock_history_cutover_scope SET retired_at=clock_timestamp() WHERE store_id=p_previous;
   FOREACH rel IN ARRAY ARRAY['products','terminal_tokens','stores','stock_transfers','stock_transfer_items'] LOOP
    EXECUTE format('DROP TRIGGER stock_history_cutover_rows ON public.%I',rel);
    EXECUTE format('DROP TRIGGER stock_history_cutover_truncate ON public.%I',rel);
   END LOOP;
   PERFORM private.stock_history_install_cutover_guard(p_project,p_branch,p_marker,terminals,databases);
  END IF;
  ready:=true;
 END IF;
 RETURN jsonb_build_object('projectOrigin',p_project,'branchId',p_branch,'terminalId',p_terminal,
  'databaseId',p_database,'cohortReady',ready);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_enroll_stocktake_till(text,text,text,text,text,text,jsonb,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_enroll_stocktake_till(text,text,text,text,text,text,jsonb,uuid,uuid)
 TO service_role;
