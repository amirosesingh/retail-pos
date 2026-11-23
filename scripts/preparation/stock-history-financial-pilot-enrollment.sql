-- Schema only. The named pilot Administrators confirm the two physical SQL
-- databases through the existing signed application workflow after stocktake.
DO $ready$ BEGIN
 IF to_regclass('private.stock_history_pilot_enrollment_receipts') IS NULL
  OR to_regclass('fin62_rollout_preparation.approvals') IS NULL
  OR to_regprocedure('public.pos_live_financial_ready()') IS NULL
  OR to_regprocedure('public.pos_sync_financial_capability(text,text,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_READINESS_REQUIRED';END IF;
END $ready$;

CREATE TABLE private.stock_history_financial_pilot_confirmations(
 challenge_id uuid PRIMARY KEY REFERENCES private.stock_history_frontier_receipts(challenge_id),
 store_id text NOT NULL,baseline_id uuid NOT NULL REFERENCES private.stock_history_cutover_publications(baseline_id),
 project_origin text NOT NULL,terminal_id uuid NOT NULL,database_id uuid NOT NULL,author_id uuid NOT NULL,
 accepted_at timestamptz NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(store_id,terminal_id) REFERENCES private.stock_history_pilot_enrollment_receipts(store_id,terminal_id)
);
CREATE INDEX stock_history_financial_pilot_latest ON private.stock_history_financial_pilot_confirmations
 (store_id,baseline_id,terminal_id,accepted_at DESC,challenge_id);

CREATE TABLE private.stock_history_financial_pilot_rollouts(
 store_id text PRIMARY KEY,baseline_id uuid NOT NULL UNIQUE REFERENCES private.stock_history_cutover_publications(baseline_id),
 project_origin text NOT NULL,rollout_id uuid NOT NULL UNIQUE,approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 first_confirmation uuid NOT NULL REFERENCES private.stock_history_financial_pilot_confirmations(challenge_id),
 second_confirmation uuid NOT NULL REFERENCES private.stock_history_financial_pilot_confirmations(challenge_id),
 CHECK(first_confirmation<>second_confirmation)
);

DO $protect$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_financial_pilot_confirmations','stock_history_financial_pilot_rollouts'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name);
 END LOOP;
END $protect$;

CREATE FUNCTION public.pos_stock_history_approve_financial_till(p_subject text,p_terminal text,p_project text,p_branch text,
 p_database uuid,p_challenge uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='1s' AS $fn$
DECLARE actor uuid;gate private.stock_history_cutover_scope%ROWTYPE;baseline uuid;released timestamptz;
 proof private.stock_history_frontier_receipts%ROWTYPE;rollout private.stock_history_financial_pilot_rollouts%ROWTYPE;
 prior_count integer;terminals text[];confirmations uuid[];registrations jsonb;at_time timestamptz;
 ready boolean:=false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR p_project IS NULL OR length(p_project)>255
  OR p_project!~'^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$'
  OR p_branch IS NULL OR p_branch!~'^codex-stock401-[a-f0-9]{6,64}$'
  OR p_database IS NULL OR p_challenge IS NULL
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_INVALID';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('stock-history-financial-pilot:'||p_branch,0))
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_BUSY';END IF;

 SELECT * INTO gate FROM private.stock_history_cutover_scope
 WHERE store_id=p_branch AND project_origin=p_project AND retired_at IS NULL AND active_id IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND OR gate.marker<>upper(p_branch COLLATE "C")
  OR gate.cluster_id<>'codex-stock401-cluster-'||substr(p_branch,length('codex-stock401-')+1)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 SELECT * INTO proof FROM private.stock_history_frontier_receipts
 WHERE challenge_id=p_challenge AND project_origin=p_project AND store_id=p_branch AND terminal_id=p_terminal
  AND database_guid=p_database AND author_id=actor AND prefix_state='accepted'
  AND pending='{"business":"0","metadata":"0","unsigned":"0","unknown":"0"}'::jsonb
  AND cardinality(reasons)=0 AND gap_hash=encode(sha256(convert_to(concat_ws(chr(31),'stock401-financial-approval-v1',
   p_project,p_branch,p_terminal,p_database::text,p_challenge::text),'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_PROOF_REQUIRED';END IF;
 PERFORM private.stock_history_frontier_identity(p_project,p_branch,p_terminal,actor,proof.key_id);
 IF NOT EXISTS(SELECT 1 FROM private.stock_history_pilot_enrollment_receipts e WHERE e.store_id=p_branch
  AND e.terminal_id::text=p_terminal AND e.database_id=p_database AND e.author_id=actor AND e.project_origin=p_project)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';END IF;

 -- The two confirmations cannot race with a roster, sale, shift, or rollout
 -- write. These locks never wait and the caller's transaction owns them.
 LOCK TABLE public.stores,public.terminal_tokens,public.shifts,public.sales IN SHARE MODE NOWAIT;
 LOCK TABLE fin62_rollout_preparation.approvals IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 IF EXISTS(SELECT 1 FROM public.shifts WHERE store_id=p_branch) OR EXISTS(SELECT 1 FROM public.sales WHERE store_id=p_branch)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_BRANCH_USED';END IF;
 IF public.pos_live_financial_ready() IS DISTINCT FROM '{"ready":true,"version":2}'::jsonb
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_READINESS_REQUIRED';END IF;

 registrations:=private.stock_history_cutover_roster(p_branch);
 SELECT array_agg(e.terminal_id::text ORDER BY e.terminal_id) INTO terminals
 FROM private.stock_history_pilot_enrollment_receipts e JOIN private.stock_history_cutover_enrollment g
  ON g.store_id=e.store_id AND g.terminal_id=e.terminal_id AND g.database_id=e.database_id
 JOIN public.app_users a ON a.id=e.author_id AND a.store_id=e.store_id AND a.is_active
  AND (a.role::text='admin' OR a.role_slug='admin')
 WHERE e.store_id=p_branch AND e.project_origin=p_project;
 IF cardinality(terminals) IS DISTINCT FROM 2 OR jsonb_array_length(registrations)<>2
  OR EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.location_id=p_branch AND NOT(t.id::text=ANY(terminals)))
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROSTER_UNCONFIRMED';END IF;

 SELECT p.baseline_id,l.released_at INTO baseline,released
 FROM private.stock_history_cutover_publications p
 JOIN private.stock_history_cutover_leases l ON l.id=p.baseline_id AND l.store_id=p.store_id
 JOIN public.stock_history_baselines b ON b.id=p.baseline_id AND b.store_id=p.store_id
 JOIN public.stock_history_heads h ON h.baseline_id=p.baseline_id AND h.store_id=p.store_id
 JOIN private.stock_history_pilot_enrollment_receipts w ON w.store_id=p.store_id AND w.author_id=l.witness_id AND w.terminal_id::text=l.witness_terminal
 JOIN private.stock_history_pilot_enrollment_receipts r ON r.store_id=p.store_id AND r.author_id=p.reviewer_id AND r.terminal_id::text=p.reviewer_terminal
 WHERE p.store_id=p_branch AND p.project_origin=p_project AND b.opening_kind='physical_count' AND b.verification_state='verified'
  AND r.terminal_id<>w.terminal_id AND r.author_id<>w.author_id AND l.released_at>=p.published_at;
 IF NOT FOUND OR (SELECT count(*) FROM private.stock_history_cutover_publications WHERE store_id=p_branch)<>1
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_OPENING_REQUIRED';END IF;
 at_time:=clock_timestamp();
 IF proof.accepted_at<greatest(released,at_time-interval '5 minutes') OR proof.accepted_at>at_time
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_PROOF_REQUIRED';END IF;

 SELECT * INTO rollout FROM private.stock_history_financial_pilot_rollouts WHERE store_id=p_branch;
 SELECT count(*) INTO prior_count FROM fin62_rollout_preparation.approvals WHERE branch_id=p_branch;
 IF rollout.rollout_id IS NOT NULL THEN
  -- Only the same complete original enablement can be read back. A revised,
  -- revoked or externally approved cohort cannot be overwritten or revived.
  IF rollout.baseline_id<>baseline OR rollout.project_origin<>p_project OR prior_count<>2
   OR (SELECT count(*) FROM fin62_rollout_preparation.approvals WHERE organization_id='default' AND branch_id=p_branch
    AND terminal_id=ANY(terminals) AND revision=1 AND rollout_id=rollout.rollout_id AND status='approved')<>2
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_ROLLOUT_CONFLICT';END IF;
  ready:=true;
 ELSE
  IF prior_count<>0 THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_ROLLOUT_CONFLICT';END IF;
  INSERT INTO private.stock_history_financial_pilot_confirmations(challenge_id,store_id,baseline_id,project_origin,
   terminal_id,database_id,author_id,accepted_at)
  VALUES(p_challenge,p_branch,baseline,p_project,p_terminal::uuid,p_database,actor,proof.accepted_at)
  ON CONFLICT(challenge_id) DO NOTHING;
  SELECT array_agg(c.challenge_id ORDER BY c.terminal_id) INTO confirmations FROM (
   SELECT DISTINCT ON (terminal_id) terminal_id,challenge_id
   FROM private.stock_history_financial_pilot_confirmations
   WHERE store_id=p_branch AND baseline_id=baseline AND project_origin=p_project
    AND terminal_id::text=ANY(terminals) AND accepted_at>=greatest(released,at_time-interval '5 minutes') AND accepted_at<=at_time
   ORDER BY terminal_id,accepted_at DESC,challenge_id
  ) c;
  IF cardinality(confirmations)=2 THEN
   IF EXISTS(SELECT 1 FROM private.stock_history_financial_pilot_confirmations c
    JOIN private.stock_history_frontier_receipts f ON f.challenge_id=c.challenge_id
    WHERE c.challenge_id=ANY(confirmations) AND private.stock_history_stocktake_authorize(
     (f.proof_json::jsonb)->>'subject',c.terminal_id::text,p_branch) IS DISTINCT FROM c.author_id)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_DENIED' USING ERRCODE='42501';END IF;
   PERFORM private.stock_history_frontier_identity(p_project,p_branch,c.terminal_id::text,c.author_id,f.key_id)
    FROM private.stock_history_financial_pilot_confirmations c
    JOIN private.stock_history_frontier_receipts f ON f.challenge_id=c.challenge_id WHERE c.challenge_id=ANY(confirmations);
   INSERT INTO private.stock_history_financial_pilot_rollouts(store_id,baseline_id,project_origin,rollout_id,first_confirmation,second_confirmation)
   VALUES(p_branch,baseline,p_project,gen_random_uuid(),confirmations[1],confirmations[2]) RETURNING * INTO rollout;
   INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status)
   SELECT 'default',p_branch,t.terminal_id,1,rollout.rollout_id,'approved' FROM unnest(terminals) AS t(terminal_id);
   IF EXISTS(SELECT 1 FROM unnest(terminals) AS t(terminal_id) WHERE
    public.pos_sync_financial_capability('default',p_branch,t.terminal_id,NULL)->>'mode' IS DISTINCT FROM 'required')
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_FINANCIAL_READINESS_REQUIRED';END IF;
   ready:=true;
  END IF;
 END IF;
 RETURN jsonb_build_object('projectOrigin',p_project,'branchId',p_branch,'terminalId',p_terminal,
  'databaseId',p_database,'cohortReady',ready);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_approve_financial_till(text,text,text,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_approve_financial_till(text,text,text,text,uuid,uuid) TO service_role;
