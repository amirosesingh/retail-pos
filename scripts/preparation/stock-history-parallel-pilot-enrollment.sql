-- Schema-only extension for a fresh isolated Beta Stock Report test pair.
-- The existing, used pilot keeps its stocktake guard, leases, and evidence.
-- Enrollment still runs through the authenticated Beta application.
DO $preflight$
BEGIN
 IF to_regclass('private.stock_history_cutover_scope_current_idx') IS NULL
  OR to_regprocedure('public.pos_stock_history_enroll_stocktake_till(text,text,text,text,text,text,jsonb,uuid,uuid)') IS NULL
  OR to_regprocedure('private.stock_history_cutover_guard_ready(text,text)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_PARALLEL_PREREQUISITES';END IF;
END $preflight$;

ALTER TABLE private.stock_history_cutover_scope ADD COLUMN parallel_scope boolean NOT NULL DEFAULT false;
DROP INDEX private.stock_history_cutover_scope_current_idx;
CREATE UNIQUE INDEX stock_history_cutover_scope_current_idx
 ON private.stock_history_cutover_scope(singleton) WHERE retired_at IS NULL AND NOT parallel_scope;
CREATE UNIQUE INDEX stock_history_cutover_scope_parallel_idx
 ON private.stock_history_cutover_scope(singleton) WHERE retired_at IS NULL AND parallel_scope;

CREATE OR REPLACE FUNCTION private.stock_history_cutover_guard_ready(p_branch text,p_cluster text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT count(*)=10 FROM (VALUES('products'),('terminal_tokens'),('stores'),('stock_transfers'),('stock_transfer_items')) rel(name)
 CROSS JOIN (VALUES('stock_history_cutover_rows',31),('stock_history_cutover_truncate',34)) variant(name,kind)
 JOIN private.stock_history_cutover_scope scope ON scope.store_id=p_branch AND scope.cluster_id=p_cluster
 JOIN pg_trigger t ON t.tgtype=variant.kind AND t.tgname=CASE WHEN scope.parallel_scope
  THEN replace(variant.name,'cutover_','cutover_parallel_') ELSE variant.name END
 WHERE t.tgrelid=to_regclass(format('public.%I',rel.name)) AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=2
  AND t.tgfoid=to_regprocedure('private.stock_history_cutover_guard()') AND t.tgqual IS NULL AND t.tgattr=''::int2vector
  AND t.tgargs=convert_to(p_branch,'UTF8')||decode('00','hex')||convert_to(p_cluster,'UTF8')||decode('00','hex')
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_guard_ready(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pos_stock_history_enroll_stocktake_till(p_subject text,p_terminal text,p_project text,p_branch text,
 p_previous text,p_marker text,p_cohort jsonb,p_database uuid,p_challenge uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;proof private.stock_history_frontier_receipts%ROWTYPE;gate private.stock_history_cutover_scope%ROWTYPE;
 canonical_cohort jsonb;terminals uuid[];databases uuid[];authors uuid[];enrolled_count integer;
 ready boolean:=false;parallel_cohort boolean:=false;rel text;companion_cluster text;
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
 -- An exact replay of either slot keeps its own existing guard.
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND retired_at IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND THEN
  SELECT * INTO gate FROM private.stock_history_cutover_scope
   WHERE store_id=p_previous AND retired_at IS NULL AND NOT parallel_scope FOR SHARE NOWAIT;
 END IF;
 IF NOT FOUND OR gate.project_origin<>p_project THEN
  RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;
 IF gate.store_id=p_previous THEN
  IF gate.marker<>upper(p_previous COLLATE "C")
   OR gate.cluster_id<>'codex-stock401-cluster-'||substr(p_previous,length('codex-stock401-')+1)
   OR gate.active_id IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id=p_branch)
   OR (SELECT count(*) FROM private.stock_history_cutover_enrollment WHERE store_id=p_previous)<>2
   OR NOT private.stock_history_cutover_guard_ready(p_previous,gate.cluster_id)
   OR NOT private.stock_history_opening_capture_ready()
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;
  parallel_cohort:=EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id=p_previous AND verification_state='verified');
  IF parallel_cohort THEN
   IF EXISTS(SELECT 1 FROM private.stock_history_cutover_scope WHERE retired_at IS NULL AND parallel_scope)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_PARALLEL_SLOT_OCCUPIED';END IF;
  ELSIF gate.gate_revision<>0
   OR EXISTS(SELECT 1 FROM private.stock_history_cutover_leases WHERE store_id=p_previous)
   OR EXISTS(SELECT 1 FROM private.stock_history_cutover_publications WHERE store_id=p_previous)
   OR EXISTS(SELECT 1 FROM private.stock_history_stocktakes WHERE store_id=p_previous)
   OR EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id=p_previous)
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_PREVIOUS_PILOT_UNVERIFIED';END IF;
 END IF;

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
   IF parallel_cohort THEN
    companion_cluster:='codex-stock401-cluster-'||substr(p_branch,length('codex-stock401-')+1);
    INSERT INTO private.stock_history_cutover_scope(store_id,project_origin,cluster_id,marker,parallel_scope)
    VALUES(p_branch,p_project,companion_cluster,p_marker,true);
    INSERT INTO private.stock_history_cutover_enrollment SELECT p_branch,ids.terminal_id,ids.database_id
     FROM unnest(terminals,databases) ids(terminal_id,database_id);
    FOREACH rel IN ARRAY ARRAY['products','terminal_tokens','stores','stock_transfers','stock_transfer_items'] LOOP
     EXECUTE format('CREATE TRIGGER stock_history_cutover_parallel_rows BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_cutover_guard(%L,%L)',
      rel,p_branch,companion_cluster);
     EXECUTE format('CREATE TRIGGER stock_history_cutover_parallel_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.stock_history_cutover_guard(%L,%L)',
      rel,p_branch,companion_cluster);
     EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER stock_history_cutover_parallel_rows',rel);
     EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER stock_history_cutover_parallel_truncate',rel);
    END LOOP;
    PERFORM private.stock_history_cutover_roster(p_branch);
   ELSE
    PERFORM 1 FROM private.stock_history_cutover_scope WHERE store_id=p_previous FOR UPDATE NOWAIT;
    UPDATE private.stock_history_cutover_scope SET retired_at=clock_timestamp() WHERE store_id=p_previous;
    FOREACH rel IN ARRAY ARRAY['products','terminal_tokens','stores','stock_transfers','stock_transfer_items'] LOOP
     EXECUTE format('DROP TRIGGER stock_history_cutover_rows ON public.%I',rel);
     EXECUTE format('DROP TRIGGER stock_history_cutover_truncate ON public.%I',rel);
    END LOOP;
    PERFORM private.stock_history_install_cutover_guard(p_project,p_branch,p_marker,terminals,databases);
   END IF;
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
