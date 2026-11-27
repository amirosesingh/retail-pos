-- STOCK401 preparation. The caller owns the schema transaction. No ordinary
-- count, stock, sync queue, baseline, coverage or reader is modified here.
DO $guard$ BEGIN
 IF to_regprocedure('private.stock_history_opening_candidate(text)') IS NULL
  OR to_regprocedure('private.stock_history_opening_latest_frontiers(text,text,jsonb,timestamptz,uuid[])') IS NULL
  OR to_regclass('private.stock_history_original_sources') IS NULL
  OR to_regclass('private.stock_history_source_claim_verifications') IS NULL
  THEN RAISE EXCEPTION 'STOCKTAKE_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_stocktakes') IS NOT NULL THEN RAISE EXCEPTION 'STOCKTAKE_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;

CREATE TABLE private.stock_history_stocktakes(
 id uuid PRIMARY KEY,project_origin text NOT NULL,store_id text NOT NULL,witness_id uuid NOT NULL,
 witness_subject text NOT NULL,witness_terminal text NOT NULL,observation_started_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL CHECK(observed_at>=observation_started_at),
 candidate jsonb NOT NULL,roster_hash text NOT NULL CHECK(roster_hash~'^[a-f0-9]{64}$')
);
CREATE TABLE private.stock_history_stocktake_counts(
 stocktake_id uuid PRIMARY KEY REFERENCES private.stock_history_stocktakes(id),cutoff_at text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'),evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),
 physical_counts jsonb NOT NULL,corrections jsonb NOT NULL,reconciled_candidate jsonb NOT NULL,
 observation_started_at timestamptz NOT NULL,observed_at timestamptz NOT NULL CHECK(observed_at>=observation_started_at)
);
CREATE TABLE private.stock_history_stocktake_reviews(
 stocktake_id uuid PRIMARY KEY REFERENCES private.stock_history_stocktake_counts(stocktake_id),reviewer_id uuid NOT NULL,
 reviewer_subject text NOT NULL,reviewer_terminal text NOT NULL,reviewed_at timestamptz NOT NULL,
 reviewed_evidence_hash text NOT NULL CHECK(reviewed_evidence_hash~'^[a-f0-9]{64}$'),
 frontier_receipts uuid[] NOT NULL,scoped_pc_prefixes_matched boolean NOT NULL
);
DO $tables$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_stocktakes','stock_history_stocktake_counts','stock_history_stocktake_reviews'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name||'_immutable',name);
 END LOOP;
END $tables$;

CREATE FUNCTION private.stock_history_stocktake_authorize(p_subject text,p_terminal text,p_branch text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;
BEGIN
 PERFORM private.stock_history_opening_authorize(p_subject,p_terminal,p_branch);
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal AND t.location_id=p_branch
  AND t.platform='pc' AND t.status IN('active','used') AND t.revoked_at IS NULL AND (t.is_claimed OR t.claimed_at IS NOT NULL) FOR SHARE)
  THEN RAISE EXCEPTION 'STOCKTAKE_TERMINAL_DENIED' USING ERRCODE='42501';END IF;
 SELECT a.id INTO STRICT actor FROM public.app_users a WHERE a.user_id=p_subject AND a.is_active IS TRUE
  AND COALESCE(a.role::text='admin' OR a.role_slug='admin',false) FOR SHARE;
 RETURN actor;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'STOCKTAKE_ACTOR_DENIED' USING ERRCODE='42501';
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_stocktake_authorize(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_stocktake_pairs(p_candidate jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(p - 'quantity' ORDER BY p->>'id'),'[]'::jsonb)
 FROM jsonb_array_elements(p_candidate->'pairs') p
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_stocktake_pairs(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_start_stocktake(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;opened private.stock_history_stocktakes%ROWTYPE;candidate jsonb;started timestamptz;seen timestamptz;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR p_project IS NULL OR length(p_project)>2048 OR p_project!~'^https://[^/?#@[:space:]]+$'
  THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-stocktake:'||p_id::text,0));
 SELECT * INTO opened FROM private.stock_history_stocktakes WHERE id=p_id;
 IF FOUND THEN
  IF ROW(opened.project_origin,opened.store_id,opened.witness_id,opened.witness_subject,opened.witness_terminal)
   IS DISTINCT FROM ROW(p_project,p_branch,actor,p_subject,p_terminal) THEN RAISE EXCEPTION 'STOCKTAKE_REPLAY_CONFLICT';END IF;
 ELSE
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'STOCKTAKE_ISOLATION_REQUIRED';END IF;
  started:=clock_timestamp();candidate:=private.stock_history_opening_candidate(p_branch);seen:=clock_timestamp();
  IF candidate->'ready' IS DISTINCT FROM 'true'::jsonb OR seen<started THEN RAISE EXCEPTION 'STOCKTAKE_START_EVIDENCE_REQUIRED';END IF;
  INSERT INTO private.stock_history_stocktakes VALUES(p_id,p_project,p_branch,actor,p_subject,p_terminal,started,seen,candidate,
   encode(sha256(convert_to(private.stock_history_stocktake_pairs(candidate)::text,'UTF8')),'hex')) RETURNING * INTO opened;
 END IF;
 RETURN jsonb_build_object('stocktakeId',opened.id,'branchId',opened.store_id,'rosterHash',opened.roster_hash,
  'roster',private.stock_history_stocktake_pairs(opened.candidate),
  'snapshotObservedAt',to_char(opened.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z');
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_start_stocktake(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_start_stocktake(text,text,text,text,uuid) TO service_role;

-- Only original, admitted count corrections attributed to this physical
-- stocktake can reconcile a changed quantity. Current draft rows are mutable.
CREATE FUNCTION private.stock_history_stocktake_corrections(p_open private.stock_history_stocktakes,p_candidate jsonb,
 p_cutoff numeric,p_movements uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE first_cursor bigint:=(p_open.candidate->'source'->'head'->>'cursor')::bigint;
 final_cursor bigint:=(p_candidate->'source'->'head'->>'cursor')::bigint;
 opening_ticks numeric:=extract(epoch FROM p_open.observed_at)*10000000;effects jsonb;changed bigint;
BEGIN
 IF final_cursor-first_cursor<>cardinality(p_movements) OR
  split_part(p_candidate->'source'->'capture'->>'revision',':',1)::bigint-
  split_part(p_open.candidate->'source'->'capture'->>'revision',':',1)::bigint<>cardinality(p_movements)
  THEN RAISE EXCEPTION 'STOCKTAKE_INTERVAL_UNRECONCILED';END IF;
 WITH before_pairs AS MATERIALIZED(SELECT x->>'id' id,x->>'quantity' quantity FROM jsonb_array_elements(p_open.candidate->'pairs') x),
 after_pairs AS MATERIALIZED(SELECT x->>'id' id,x->>'quantity' quantity FROM jsonb_array_elements(p_candidate->'pairs') x),
 differences AS MATERIALIZED(SELECT p.id,p.quantity previous_quantity,n.quantity next_quantity FROM before_pairs p JOIN after_pairs n USING(id)
  WHERE p.quantity<>n.quantity),
 accepted AS MATERIALIZED(
  SELECT m.id,m.product_id,m.ingested_cursor,v.author_id,v.terminal_id,v.database_guid,v.source_sequence,v.source_root,e.id effect_id
  FROM public.stock_history_movements m JOIN differences d ON d.id=m.product_id::text
  JOIN private.stock_history_claim_receipts r ON (r.movement_id,r.store_id,r.ingested_cursor,r.payload_hash,r.author_id::text)
   =(m.id,m.store_id,m.ingested_cursor,m.payload_hash,m.actor_id) AND cardinality(r.effect_ids)=1
  JOIN private.stock_history_source_claim_verifications v ON (v.movement_id,v.project_origin,v.store_id,v.terminal_id,v.operation_id,v.author_id,v.key_id)
   =(m.id,p_open.project_origin,p_open.store_id,m.terminal_id,m.operation_id,r.author_id,r.key_id)
  JOIN private.stock_history_original_sources s ON (s.batch_id,s.project_origin,s.store_id,s.terminal_id)
   =(v.business_batch_id,v.project_origin,v.store_id,v.terminal_id)
  JOIN private.stock_history_accepted_effects e ON e.id=r.effect_ids[1] AND e.id=ANY(s.effect_ids)
   AND (e.transaction_id,e.store_id,e.product_id,e.previous_quantity,e.next_quantity,e.quantity_delta)
   =(s.capture_xid,p_open.store_id,m.product_id,d.previous_quantity::numeric,d.next_quantity::numeric,m.quantity_delta)
  JOIN private.stock_history_effect_coverage c ON (c.effect_id,c.movement_id)=(e.id,m.id)
  WHERE m.store_id=p_open.store_id AND m.ingested_cursor>first_cursor AND m.ingested_cursor<=final_cursor AND m.id=ANY(p_movements)
   AND m.source_kind='stock' AND (v.manifest_json::jsonb)->>'action'='ADJUST'
   AND m.effective_ticks BETWEEN opening_ticks AND p_cutoff
   AND extract(epoch FROM r.accepted_at)*10000000 BETWEEN opening_ticks AND p_cutoff
   AND extract(epoch FROM s.accepted_at)*10000000 BETWEEN opening_ticks AND p_cutoff
   AND 1=(SELECT count(*) FROM jsonb_array_elements(s.operations) AS ops(entry)
    CROSS JOIN LATERAL jsonb_array_elements(ops.entry->'rows') AS rows(adjustment)
    WHERE ops.entry->>'table'='stock_adjustments' AND adjustment->>'id'=(v.manifest_json::jsonb)->'document'->>'id'
     AND adjustment->>'draft_id'=p_open.id::text AND adjustment->>'reason'='count'
     AND (adjustment->>'product_id',adjustment->>'store_id')=(m.product_id::text,m.store_id))
 ) SELECT (SELECT count(*) FROM differences),COALESCE(jsonb_agg(jsonb_build_object('movementId',id,'productId',product_id,
  'cursor',ingested_cursor::text,'authorId',author_id,'terminalId',terminal_id,'databaseGuid',database_guid,
  'sourceSequence',source_sequence::text,'sourceRoot',source_root,'effectId',effect_id) ORDER BY ingested_cursor),'[]'::jsonb)
 INTO changed,effects FROM accepted;
 IF jsonb_array_length(effects)<>changed OR changed<>cardinality(p_movements)
  OR changed<>(SELECT count(DISTINCT x->>'productId') FROM jsonb_array_elements(effects) x)
  THEN RAISE EXCEPTION 'STOCKTAKE_INTERVAL_UNRECONCILED';END IF;
 RETURN effects;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_stocktake_corrections(private.stock_history_stocktakes,jsonb,numeric,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_seal_stocktake(p_subject text,p_terminal text,p_branch text,p_id uuid,p_roster_hash text,
 p_cutoff text,p_counts jsonb,p_movements uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;opened private.stock_history_stocktakes%ROWTYPE;sealed private.stock_history_stocktake_counts%ROWTYPE;
 counts jsonb;system_counts jsonb;candidate jsonb;after_candidate jsonb;corrections jsonb;start_read timestamptz;end_read timestamptz;
 cutoff_ticks numeric;input_hash text;binding_hash text;movement_ids uuid[];
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR p_cutoff IS NULL OR jsonb_typeof(p_counts) IS DISTINCT FROM 'array' OR p_movements IS NULL OR array_ndims(p_movements)>1
  THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 IF p_cutoff!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{7}Z$'
  OR octet_length(convert_to(p_counts::text,'UTF8'))>2097152 OR jsonb_array_length(p_counts)>10000 OR cardinality(p_movements)>10000
  OR array_position(p_movements,NULL) IS NOT NULL
  THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_counts) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'array'
  OR CASE WHEN jsonb_typeof(x)='array' THEN jsonb_array_length(x)<>2 ELSE true END
  OR jsonb_typeof(x->0) IS DISTINCT FROM 'string' OR jsonb_typeof(x->1) IS DISTINCT FROM 'string'
  OR x->>0!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR x->>1!~'^(0|[1-9][0-9]{0,37})$')
  THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x->>0),'[]'::jsonb) INTO counts FROM jsonb_array_elements(p_counts) x;
 SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO movement_ids FROM unnest(p_movements) id;
 IF cardinality(p_movements)<>cardinality(movement_ids) OR jsonb_array_length(counts)<>(SELECT count(DISTINCT x->>0) FROM jsonb_array_elements(counts) x)
  THEN RAISE EXCEPTION 'STOCKTAKE_DUPLICATE_INPUT';END IF;
 cutoff_ticks:=private.stock_history_ticks(p_cutoff);
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-stocktake:'||p_id::text,0));
 SELECT * INTO opened FROM private.stock_history_stocktakes WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND OR ROW(opened.witness_id,opened.witness_subject,opened.witness_terminal) IS DISTINCT FROM ROW(actor,p_subject,p_terminal)
  THEN RAISE EXCEPTION 'STOCKTAKE_WITNESS_DENIED' USING ERRCODE='42501';END IF;
 IF opened.roster_hash IS DISTINCT FROM p_roster_hash OR
  (SELECT COALESCE(jsonb_agg(x->0 ORDER BY x->>0),'[]'::jsonb) FROM jsonb_array_elements(counts) x) IS DISTINCT FROM
  (SELECT COALESCE(jsonb_agg(x->'id' ORDER BY x->>'id'),'[]'::jsonb) FROM jsonb_array_elements(opened.candidate->'pairs') x)
  THEN RAISE EXCEPTION 'STOCKTAKE_ROSTER_INCOMPLETE';END IF;
 input_hash:=encode(sha256(convert_to(jsonb_build_array(p_id,p_roster_hash,p_cutoff,counts,movement_ids)::text,'UTF8')),'hex');
 SELECT * INTO sealed FROM private.stock_history_stocktake_counts WHERE stocktake_id=p_id;
 IF FOUND THEN
  IF sealed.input_hash IS DISTINCT FROM input_hash THEN RAISE EXCEPTION 'STOCKTAKE_REPLAY_CONFLICT';END IF;
 ELSE
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'STOCKTAKE_ISOLATION_REQUIRED';END IF;
  start_read:=clock_timestamp();
  IF cutoff_ticks<extract(epoch FROM opened.observed_at)*10000000 OR cutoff_ticks>extract(epoch FROM start_read)*10000000
   THEN RAISE EXCEPTION 'STOCKTAKE_CUTOFF_OUTSIDE_OBSERVATION';END IF;
  candidate:=private.stock_history_opening_candidate(p_branch);end_read:=clock_timestamp();
  IF candidate->'ready' IS DISTINCT FROM 'true'::jsonb OR end_read<start_read THEN RAISE EXCEPTION 'STOCKTAKE_FINAL_EVIDENCE_REQUIRED';END IF;
  IF private.stock_history_stocktake_pairs(candidate) IS DISTINCT FROM private.stock_history_stocktake_pairs(opened.candidate) OR
   candidate->'cohort' IS DISTINCT FROM opened.candidate->'cohort'
   THEN RAISE EXCEPTION 'STOCKTAKE_CATALOGUE_OR_COHORT_CHANGED';END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x->'id',x->'quantity') ORDER BY x->>'id'),'[]'::jsonb) INTO system_counts
   FROM jsonb_array_elements(candidate->'pairs') x;
  IF system_counts IS DISTINCT FROM counts THEN RAISE EXCEPTION 'STOCKTAKE_QUANTITIES_UNRECONCILED';END IF;
  corrections:=private.stock_history_stocktake_corrections(opened,candidate,cutoff_ticks,movement_ids);
  after_candidate:=private.stock_history_opening_candidate(p_branch);
  IF after_candidate->>'candidateHash' IS DISTINCT FROM candidate->>'candidateHash' THEN RAISE EXCEPTION 'STOCKTAKE_SOURCE_CHANGED';END IF;
  binding_hash:=encode(sha256(convert_to(jsonb_build_array(input_hash,opened.project_origin,p_branch,actor,p_terminal,
   extract(epoch FROM opened.observation_started_at)::text,extract(epoch FROM opened.observed_at)::text,
   opened.candidate->>'candidateHash',opened.candidate->>'snapshotHash',extract(epoch FROM start_read)::text,extract(epoch FROM end_read)::text,
   candidate->>'candidateHash',candidate->>'snapshotHash',corrections)::text,'UTF8')),'hex');
  INSERT INTO private.stock_history_stocktake_counts VALUES(p_id,p_cutoff,input_hash,binding_hash,counts,corrections,candidate,
   start_read,end_read) RETURNING * INTO sealed;
 END IF;
 RETURN jsonb_build_object('stocktakeId',p_id,'branchId',p_branch,'cutoff',sealed.cutoff_at,'evidenceHash',sealed.evidence_hash,
  'countedPairs',jsonb_array_length(sealed.physical_counts),'corrections',jsonb_array_length(sealed.corrections),
  'state','awaiting_independent_review');
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_seal_stocktake(text,text,text,uuid,text,text,jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_seal_stocktake(text,text,text,uuid,text,text,jsonb,uuid[]) TO service_role;

CREATE FUNCTION public.pos_stock_history_stocktake_for_review(p_subject text,p_terminal text,p_branch text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE opened private.stock_history_stocktakes%ROWTYPE;sealed private.stock_history_stocktake_counts%ROWTYPE;
BEGIN
 PERFORM private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 SELECT o.* INTO opened FROM private.stock_history_stocktakes o WHERE o.id=p_id AND o.store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCKTAKE_REVIEW_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO sealed FROM private.stock_history_stocktake_counts WHERE stocktake_id=opened.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCKTAKE_COUNT_REQUIRED';END IF;
 RETURN jsonb_build_object('stocktakeId',opened.id,'branchId',opened.store_id,'witnessId',opened.witness_id,'cutoff',sealed.cutoff_at,
  'evidenceHash',sealed.evidence_hash,'rosterHash',opened.roster_hash,'roster',private.stock_history_stocktake_pairs(opened.candidate),
  'physicalCounts',sealed.physical_counts,'correctionMovements',(SELECT COALESCE(jsonb_agg(x->'movementId' ORDER BY (x->>'cursor')::bigint),'[]'::jsonb)
   FROM jsonb_array_elements(sealed.corrections) x));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_stocktake_for_review(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_stocktake_for_review(text,text,text,uuid) TO service_role;

CREATE FUNCTION public.pos_stock_history_review_stocktake(p_subject text,p_terminal text,p_branch text,p_id uuid,p_evidence_hash text,
 p_frontiers uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;opened private.stock_history_stocktakes%ROWTYPE;sealed private.stock_history_stocktake_counts%ROWTYPE;
 reviewed private.stock_history_stocktake_reviews%ROWTYPE;frontier_ids uuid[];cohort jsonb;expected integer;matched boolean;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR p_frontiers IS NULL OR cardinality(p_frontiers)>1024 OR array_ndims(p_frontiers)>1
  THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 IF array_position(p_frontiers,NULL) IS NOT NULL THEN RAISE EXCEPTION 'STOCKTAKE_INVALID';END IF;
 SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO frontier_ids FROM unnest(p_frontiers) id;
 IF cardinality(frontier_ids)<>cardinality(p_frontiers) THEN RAISE EXCEPTION 'STOCKTAKE_DUPLICATE_INPUT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-stocktake:'||p_id::text,0));
 SELECT * INTO opened FROM private.stock_history_stocktakes WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCKTAKE_REVIEW_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO sealed FROM private.stock_history_stocktake_counts WHERE stocktake_id=p_id;
 IF NOT FOUND OR sealed.evidence_hash IS DISTINCT FROM p_evidence_hash THEN RAISE EXCEPTION 'STOCKTAKE_EVIDENCE_CHANGED';END IF;
 IF actor=opened.witness_id OR p_subject=opened.witness_subject OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(sealed.corrections) x WHERE x->>'authorId'=actor::text)
  THEN RAISE EXCEPTION 'STOCKTAKE_INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT * INTO reviewed FROM private.stock_history_stocktake_reviews WHERE stocktake_id=p_id;
 IF FOUND THEN
  IF ROW(reviewed.reviewer_id,reviewed.reviewer_subject,reviewed.reviewer_terminal,reviewed.frontier_receipts)
   IS DISTINCT FROM ROW(actor,p_subject,p_terminal,frontier_ids) THEN RAISE EXCEPTION 'STOCKTAKE_REPLAY_CONFLICT';END IF;
 ELSE
  cohort:=opened.candidate->'cohort';expected:=jsonb_array_length(cohort);
  WITH f AS MATERIALIZED(SELECT * FROM private.stock_history_opening_latest_frontiers(opened.project_origin,p_branch,cohort,sealed.observed_at,frontier_ids))
  SELECT expected BETWEEN 1 AND 1024 AND expected=cardinality(frontier_ids)
   AND cohort=private.stock_history_opening_claimed_roster(p_branch)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cohort) w WHERE w->>1 IS DISTINCT FROM 'pc' OR (w->>2 IN('active','used')) IS NOT TRUE OR w->>3 IS NOT NULL)
   AND (SELECT count(*)=expected AND count(DISTINCT terminal_id)=expected FROM f)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sealed.corrections) x WHERE NOT EXISTS(SELECT 1 FROM f
    WHERE (f.terminal_id,f.database_guid::text)=(x->>'terminalId',x->>'databaseGuid') AND (x->>'sourceSequence')::bigint<=f.source_sequence
      AND ((x->>'sourceSequence')::bigint<f.source_sequence OR x->>'sourceRoot'=f.source_root))) INTO matched;
  IF NOT matched THEN
   RETURN jsonb_build_object('stocktakeId',p_id,'branchId',p_branch,'cutoff',sealed.cutoff_at,'evidenceHash',sealed.evidence_hash,
    'state','held','scopedPcPrefixesMatched',false,'effectiveOpeningEligible',false,
    'reasons','["STOCKTAKE_PC_PREFIX_UNCONFIRMED","STOCKTAKE_ALL_WRITER_BOUNDARY_UNPROVEN","STOCKTAKE_PHYSICAL_CLOCK_UNVERIFIED"]'::jsonb);
  END IF;
  INSERT INTO private.stock_history_stocktake_reviews VALUES(p_id,actor,p_subject,p_terminal,clock_timestamp(),p_evidence_hash,
   frontier_ids,matched) RETURNING * INTO reviewed;
 END IF;
 -- Hosted snapshot consistency and current signed PC prefixes provide neither
 -- physical clock authority nor a fence on mobile/web/offline/non-PC writers.
 RETURN jsonb_build_object('stocktakeId',p_id,'branchId',p_branch,'cutoff',sealed.cutoff_at,'evidenceHash',sealed.evidence_hash,
  'state','held','scopedPcPrefixesMatched',reviewed.scoped_pc_prefixes_matched,'effectiveOpeningEligible',false,
  'reasons','["STOCKTAKE_ALL_WRITER_BOUNDARY_UNPROVEN","STOCKTAKE_PHYSICAL_CLOCK_UNVERIFIED"]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_review_stocktake(text,text,text,uuid,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_review_stocktake(text,text,text,uuid,text,uuid[]) TO service_role;
