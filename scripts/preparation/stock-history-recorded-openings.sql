-- STOCK401 preparation. Record one scoped MVCC observation, without publishing
-- an effective-time opening or advancing report coverage. The caller owns the
-- schema transaction. This file is outside the automatic migration inventory.
DO $guard$ BEGIN
 IF to_regclass('private.stock_history_frontier_receipts') IS NULL
  OR to_regprocedure('private.stock_history_capture_state(text,uuid)') IS NULL
  OR to_regprocedure('public.product_available_in_catalogue(uuid,text)') IS NULL THEN RAISE EXCEPTION 'STOCK_OPENING_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_opening_publications') IS NOT NULL THEN RAISE EXCEPTION 'STOCK_OPENING_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;
CREATE TABLE private.stock_history_opening_publications(
 baseline_id uuid PRIMARY KEY REFERENCES public.stock_history_baselines(id),store_id text NOT NULL,actor_id text NOT NULL,terminal_id text,
 candidate_hash text NOT NULL CHECK(candidate_hash~'^[a-f0-9]{64}$'),pairs_hash text NOT NULL CHECK(pairs_hash~'^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 observation_started_at timestamptz NOT NULL,observed_at timestamptz NOT NULL CHECK(observed_at>=observation_started_at),
 pair_count integer NOT NULL CHECK(pair_count BETWEEN 0 AND 10000),cohort jsonb NOT NULL,source_revision jsonb NOT NULL,
 observation_grade text NOT NULL DEFAULT 'recorded_system_snapshot' CHECK(observation_grade='recorded_system_snapshot')
);
ALTER TABLE private.stock_history_opening_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_opening_publications FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_opening_publications_immutable BEFORE UPDATE OR DELETE ON private.stock_history_opening_publications
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_opening_authorize(p_actor text,p_terminal text,p_branch text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 PERFORM private.stock_history_authorize_read(p_actor,p_terminal,p_branch,false);
 IF NOT EXISTS(SELECT 1 FROM public.app_users p WHERE p.user_id=p_actor AND p.is_active IS TRUE
  AND COALESCE(p.role::text='admin' OR p.role_slug='admin',false)) THEN RAISE EXCEPTION 'STOCK_OPENING_ADMIN_REQUIRED' USING ERRCODE='42501';END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_opening_authorize(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_opening_capture_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT current_setting('session_replication_role')='origin'
 AND(SELECT count(*)=6 FROM(VALUES
  ('private.stock_history_capture_accepted_products()','095bc1c87665046222185af64538b6a1','plpgsql',true,'v',false),
  ('private.stock_history_capture_source_receipt()','d5ad038b43ac9040c3916d067f336e72','plpgsql',true,'v',false),
  ('private.stock_history_capture_state(text,uuid)','9c28e8decc29e2393dbb01eabb9cb269','sql',true,'s',false),
  ('private.stock_history_authorize_read(text,text,text,boolean)','6bd51631803540e143b63041e25b3671','plpgsql',false,'v',false),
  ('private.stock_history_ticks(text)','452bd8aabda37ee3a02504807a7b77aa','plpgsql',false,'i',true),
  ('public.product_available_in_catalogue(uuid,text)','13754ce50237809f51f5d382b60b9421','sql',true,'s',false)
 )expected(signature,body_hash,language,definer,volatility,strictness)
 JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) JOIN pg_language l ON l.oid=p.prolang
 WHERE md5(replace(p.prosrc,E'\r\n',E'\n'))=expected.body_hash AND l.lanname=expected.language AND p.prosecdef=expected.definer
  AND p.provolatile::text=expected.volatility AND p.proisstrict=expected.strictness AND p.prokind='f' AND NOT p.proleakproof AND p.proparallel='u'
  AND pg_get_userbyid(p.proowner)=current_user AND p.proconfig=ARRAY['search_path=""']::text[])
 AND(SELECT count(*)=2 FROM(VALUES
  ('public.products','stock_history_accepted_products','private.stock_history_capture_accepted_products()',29),
  ('public.stock_delta_applied','stock_history_source_receipts','private.stock_history_capture_source_receipt()',5)
 )expected(relation,name,signature,kind) JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation) AND t.tgname=expected.name
 WHERE t.tgfoid=to_regprocedure(expected.signature) AND t.tgtype=expected.kind AND t.tgenabled='O' AND NOT t.tgisinternal
  AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND octet_length(t.tgargs)=0)
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_opening_capture_ready() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_opening_claimed_roster(p_branch text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_array(id::text,platform,status,
   CASE WHEN revoked_at IS NULL THEN NULL ELSE to_char(revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z' END,is_claimed,
   CASE WHEN claimed_at IS NULL THEN NULL ELSE to_char(claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z' END) ORDER BY id),'[]'::jsonb)
 FROM (SELECT id,platform,status,revoked_at,is_claimed,claimed_at FROM public.terminal_tokens
  WHERE location_id=p_branch AND (is_claimed OR claimed_at IS NOT NULL) ORDER BY id LIMIT 1025) writers
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_opening_claimed_roster(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_opening_candidate(p_branch text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE pairs jsonb;members jsonb;head jsonb;capture jsonb;descriptor jsonb;reasons jsonb:='[]'::jsonb;total integer;source_ready boolean;unscoped bigint;snapshot_hash text;
BEGIN
 -- One statement snapshot for every candidate input. No business product lock.
 WITH h AS MATERIALIZED(SELECT * FROM public.stock_history_heads WHERE store_id=p_branch),
 old_identity AS MATERIALIZED(
  SELECT DISTINCT ON(o.product_id) o.product_id,o.product_name,o.sku,o.barcode,o.owner_store_id
  FROM public.stock_history_openings o JOIN public.stock_history_baselines b ON b.id=o.baseline_id AND b.store_id=p_branch
  WHERE o.store_id=p_branch AND b.verification_state='verified' AND(
   o.baseline_id=(SELECT baseline_id FROM h) OR NOT EXISTS(SELECT 1 FROM private.stock_history_opening_publications p WHERE p.baseline_id=(SELECT baseline_id FROM h)))
  ORDER BY o.product_id,b.cutoff_ticks DESC,b.id DESC),
 catalogue AS MATERIALIZED(SELECT p.id,p.name,p.sku,p.barcode,p.owner_store_id FROM public.products p WHERE public.product_available_in_catalogue(p.id,p_branch)),
 ids AS MATERIALIZED(SELECT id FROM catalogue UNION SELECT product_id FROM old_identity),
 bounded AS MATERIALIZED(SELECT id FROM ids ORDER BY id LIMIT 10001),
 selected AS MATERIALIZED(
  SELECT ids.id,CASE WHEN c.id IS NOT NULL THEN c.name ELSE o.product_name END name,
   CASE WHEN c.id IS NOT NULL THEN c.sku ELSE o.sku END sku,CASE WHEN c.id IS NOT NULL THEN c.barcode ELSE o.barcode END barcode,
   CASE WHEN c.id IS NOT NULL THEN c.owner_store_id ELSE o.owner_store_id END owner_store_id,
   CASE WHEN p.id IS NULL THEN '0' WHEN jsonb_typeof(p.stock_by_store) IS DISTINCT FROM 'object' THEN NULL
    WHEN NOT p.stock_by_store?p_branch THEN '0'
    WHEN jsonb_typeof(p.stock_by_store->p_branch) NOT IN('number','string') OR(p.stock_by_store->>p_branch)!~'^-?(0|[1-9][0-9]{0,37})$' THEN NULL
    ELSE(p.stock_by_store->>p_branch)::numeric::text END quantity
  FROM bounded ids LEFT JOIN catalogue c ON c.id=ids.id LEFT JOIN old_identity o ON o.product_id=ids.id LEFT JOIN public.products p ON p.id=ids.id)
 SELECT COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM selected s),'[]'::jsonb),
  private.stock_history_opening_claimed_roster(p_branch),
  COALESCE((SELECT jsonb_build_object('cursor',committed_cursor::text,'generation',coverage_generation::text,'baselineId',baseline_id) FROM h),jsonb_build_object('cursor','0','generation','0','baselineId',NULL)),
  private.stock_history_capture_state(p_branch,NULL),private.stock_history_opening_capture_ready(),
  (SELECT count(*) FROM public.products p WHERE p.stock_by_store?p_branch
   AND(jsonb_typeof(p.stock_by_store->p_branch) NOT IN('number','string') OR(p.stock_by_store->>p_branch)!~'^-?(0|[1-9][0-9]{0,37})$'
    OR CASE WHEN(p.stock_by_store->>p_branch)~'^-?(0|[1-9][0-9]{0,37})$' THEN(p.stock_by_store->>p_branch)::numeric<>0 ELSE false END)
   AND NOT EXISTS(SELECT 1 FROM catalogue c WHERE c.id=p.id) AND NOT EXISTS(SELECT 1 FROM old_identity o WHERE o.product_id=p.id)),
  encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex')
 INTO pairs,members,head,capture,source_ready,unscoped,snapshot_hash;
 total:=jsonb_array_length(pairs);
 IF total>10000 OR octet_length(convert_to(pairs::text,'UTF8'))>6291456 OR jsonb_array_length(members)>1024 THEN reasons:=reasons||'"OPENING_SCOPE_OVERSIZED"'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(pairs) p WHERE p->>'quantity' IS NULL OR p->>'name' IS NULL) THEN reasons:=reasons||'"STOCK_VALUE_UNVERIFIED"'::jsonb;END IF;
 IF(capture->>'unvalidatedEffects')::bigint>0 THEN reasons:=reasons||'"UNVALIDATED_STOCK_EFFECTS"'::jsonb;END IF;
 IF(capture->>'captureGaps')::bigint>0 THEN reasons:=reasons||'"CAPTURE_GAPS"'::jsonb;END IF;
 IF NOT source_ready THEN reasons:=reasons||'"CAPTURE_CONTRACT_UNVERIFIED"'::jsonb;END IF;
 IF unscoped>0 THEN reasons:=reasons||'"UNSCOPED_STOCK_PAIRS"'::jsonb;END IF;
 descriptor:=jsonb_build_object('version',1,'branchId',p_branch,'pairs',pairs,'cohort',members,'source',jsonb_build_object('head',head,'capture',capture,'captureReady',source_ready,'unscopedPairs',unscoped::text));
 RETURN jsonb_build_object('candidateHash',encode(sha256(convert_to(descriptor::text,'UTF8')),'hex'),
  'pairsHash',encode(sha256(convert_to(pairs::text,'UTF8')),'hex'),'pairs',pairs,'pairCount',total,'cohort',members,
  'source',descriptor->'source','reasons',reasons,'ready',jsonb_array_length(reasons)=0,'snapshotHash',snapshot_hash);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_opening_candidate(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_opening_plan(p_actor text,p_terminal text,p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE candidate jsonb;BEGIN
 PERFORM private.stock_history_opening_authorize(p_actor,p_terminal,p_branch);candidate:=private.stock_history_opening_candidate(p_branch);
 RETURN(candidate-'pairs'-'cohort'-'snapshotHash')||jsonb_build_object('branchId',p_branch,'observationGrade','recorded_system_snapshot',
  'writerCoverage','unknown','effectiveOpeningEligible',false);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_opening_plan(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_opening_plan(text,text,text) TO service_role;

CREATE FUNCTION public.pos_stock_history_publish_opening(p_actor text,p_terminal text,p_branch text,p_baseline uuid,p_candidate_hash text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE prior private.stock_history_opening_publications%ROWTYPE;candidate jsonb;after_candidate jsonb;
 started_at timestamptz;seen_at timestamptz;started_raw text;seen_raw text;watermarks jsonb;
BEGIN
 PERFORM private.stock_history_opening_authorize(p_actor,p_terminal,p_branch);
 IF p_baseline IS NULL OR p_candidate_hash IS NULL OR p_candidate_hash!~'^[a-f0-9]{64}$' OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
  OR p_reason~'[[:cntrl:]]' THEN RAISE EXCEPTION 'STOCK_OPENING_INVALID';END IF;
 -- Serialize idempotency for this observation, leaving stock and claim writers
 -- independent. The candidate's scope and stock come from one SQL snapshot.
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-opening-observation:'||p_baseline::text,0));
 SELECT * INTO prior FROM private.stock_history_opening_publications WHERE baseline_id=p_baseline;
 IF FOUND THEN
  IF ROW(prior.store_id,prior.actor_id,prior.terminal_id,prior.candidate_hash,prior.reason) IS DISTINCT FROM ROW(p_branch,p_actor,p_terminal,p_candidate_hash,p_reason)
   THEN RAISE EXCEPTION 'STOCK_OPENING_REPLAY_CONFLICT';END IF;
 ELSE
  -- At stronger isolation the caller's snapshot could precede this interval.
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'STOCK_OPENING_OBSERVATION_ISOLATION_REQUIRED';END IF;
  started_at:=clock_timestamp();
  candidate:=private.stock_history_opening_candidate(p_branch);
  seen_at:=clock_timestamp();
  IF candidate->'ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'STOCK_OPENING_EVIDENCE_REQUIRED';END IF;
  IF candidate->>'candidateHash' IS DISTINCT FROM p_candidate_hash THEN RAISE EXCEPTION 'STOCK_OPENING_SOURCE_CHANGED';END IF;
  IF seen_at<started_at THEN RAISE EXCEPTION 'STOCK_OPENING_OBSERVATION_CLOCK_CHANGED';END IF;
  started_raw:=to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
  seen_raw:=to_char(seen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
  watermarks:=jsonb_build_object('version',1,'publication','recorded_system_snapshot','writerCoverage','unknown',
    'effectiveOpeningEligible',false,'candidateHash',p_candidate_hash,'snapshotHash',candidate->>'snapshotHash');
  -- The legacy baseline schema requires time columns. For an unverified row
  -- these retain observation bounds only. Readers exclude unverified rows.
  INSERT INTO public.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
  VALUES(p_baseline,p_branch,started_raw,private.stock_history_ticks(started_raw),seen_raw,private.stock_history_ticks(seen_raw),
    (candidate->'source'->'head'->>'cursor')::bigint,'system_snapshot','unverified',(candidate->>'pairCount')::integer,
    watermarks,NULL,candidate->>'pairsHash');
  INSERT INTO public.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode,owner_store_id)
  SELECT gen_random_uuid(),p_baseline,(item->>'id')::uuid,p_branch,(item->>'quantity')::numeric,item->>'name',item->>'sku',item->>'barcode',item->>'owner_store_id'
  FROM jsonb_array_elements(candidate->'pairs') item;
  after_candidate:=private.stock_history_opening_candidate(p_branch);
  IF after_candidate->'ready' IS DISTINCT FROM 'true'::jsonb OR after_candidate->>'candidateHash' IS DISTINCT FROM p_candidate_hash THEN RAISE EXCEPTION 'STOCK_OPENING_SOURCE_CHANGED';END IF;
  INSERT INTO private.stock_history_opening_publications(baseline_id,store_id,actor_id,terminal_id,candidate_hash,pairs_hash,reason,
    observation_started_at,observed_at,pair_count,cohort,source_revision)
  VALUES(p_baseline,p_branch,p_actor,p_terminal,p_candidate_hash,candidate->>'pairsHash',p_reason,started_at,seen_at,
    (candidate->>'pairCount')::integer,candidate->'cohort',candidate->'source'||jsonb_build_object('snapshotHash',candidate->>'snapshotHash'))
  RETURNING * INTO prior;
 END IF;
 RETURN jsonb_build_object('baselineId',prior.baseline_id,'branchId',prior.store_id,'candidateHash',prior.candidate_hash,'pairCount',prior.pair_count,
  'observationStartedAt',to_char(prior.observation_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
  'observedAt',to_char(prior.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
  'observationGrade',prior.observation_grade,'writerCoverage','unknown','effectiveOpeningEligible',false);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_publish_opening(text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_publish_opening(text,text,text,uuid,text,text) TO service_role;

-- Compare stored stock evidence for one explicit effective-time request. A
-- signed source prefix authenticates the witnessed movements of a PC. It
-- supplies neither an independent opening quantity nor non-PC writer coverage.
CREATE FUNCTION private.stock_history_opening_eligibility(p_actor text,p_terminal text,p_project text,p_branch text,
 p_observation uuid,p_cutoff text,p_frontier_receipts uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE observed private.stock_history_opening_publications%ROWTYPE;
 cutoff numeric;cursor_at_observation bigint;effect_count bigint;expected integer;
 roster_matched boolean;effects_matched boolean;late_effective boolean;future_effective boolean;clock_unverified boolean;
BEGIN
 PERFORM private.stock_history_opening_authorize(p_actor,p_terminal,p_branch);
 IF p_project IS NULL OR p_project!~'^https://[^/?#[:space:]]+$' OR length(p_project)>2048
  OR p_observation IS NULL OR p_cutoff IS NULL OR cardinality(p_frontier_receipts) IS NULL
  OR cardinality(p_frontier_receipts)>1024 OR array_position(p_frontier_receipts,NULL) IS NOT NULL
  OR cardinality(p_frontier_receipts)<>(SELECT count(DISTINCT id) FROM unnest(p_frontier_receipts) chosen(id))
 THEN RAISE EXCEPTION 'STOCK_OPENING_EVIDENCE_INVALID';END IF;
 cutoff:=private.stock_history_ticks(p_cutoff);
 SELECT * INTO observed FROM private.stock_history_opening_publications
  WHERE baseline_id=p_observation AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_OPENING_EVIDENCE_INVALID';END IF;
 IF cutoff>extract(epoch FROM observed.observed_at)*10000000 THEN RAISE EXCEPTION 'STOCK_OPENING_CUTOFF_AFTER_OBSERVATION';END IF;
 cursor_at_observation:=(observed.source_revision->'head'->>'cursor')::bigint;
 effect_count:=split_part(observed.source_revision->'capture'->>'revision',':',1)::bigint;
 expected:=jsonb_array_length(observed.cohort);
 IF cursor_at_observation IS NULL OR effect_count IS NULL OR cursor_at_observation>100000 OR effect_count>100000
 THEN RAISE EXCEPTION 'STOCK_OPENING_EVIDENCE_BOUND';END IF;

 WITH roster AS MATERIALIZED(SELECT jsonb_array_elements(observed.cohort) member),
 challenge_roster AS MATERIALIZED(SELECT jsonb_agg(jsonb_build_array(member->>0,member->>1,member->>2,
  COALESCE((member->>4)::boolean,false)) ORDER BY member->>0) members FROM roster),
 frontiers AS MATERIALIZED(
  SELECT r.terminal_id,r.database_guid,r.source_sequence,r.source_root
  FROM private.stock_history_frontier_receipts r
  JOIN private.stock_history_frontier_challenges c ON (c.id,c.project_origin,c.store_id,c.terminal_id,c.author_id,c.key_id)
    =(r.challenge_id,r.project_origin,r.store_id,r.terminal_id,r.author_id,r.key_id)
  JOIN roster w ON w.member->>0=r.terminal_id
  JOIN pos_sync_private.shift_author_keys k ON (k.key_id,k.project_origin,k.terminal_id,k.author_id)
    =(r.key_id,r.project_origin,r.terminal_id,r.author_id) AND k.revoked_at IS NULL
  JOIN public.app_users a ON a.id=r.author_id AND a.is_active IS TRUE AND a.user_id=k.subject
    AND (a.store_id IS NULL OR (CASE WHEN a.store_id~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      THEN lower(a.store_id) ELSE a.store_id END)=p_branch)
  WHERE r.challenge_id=ANY(p_frontier_receipts) AND (r.project_origin,r.store_id)=(p_project,p_branch)
   AND r.prefix_state='accepted' AND cardinality(r.reasons)=0 AND r.accepted_at>=observed.observation_started_at
   AND c.cohort=(SELECT members FROM challenge_roster)
   AND NOT EXISTS(SELECT 1 FROM private.stock_history_frontier_receipts later
    WHERE (later.project_origin,later.store_id,later.terminal_id)=(r.project_origin,r.store_id,r.terminal_id)
     AND (later.accepted_at>r.accepted_at OR (later.accepted_at=r.accepted_at AND later.challenge_id<>r.challenge_id)))
 ), roster_result AS MATERIALIZED(SELECT expected BETWEEN 1 AND 1024
    AND observed.cohort=private.stock_history_opening_claimed_roster(p_branch)
    AND NOT EXISTS(SELECT 1 FROM roster WHERE member->>1 IS DISTINCT FROM 'pc'
     OR member->>2 NOT IN('active','used') OR member->>3 IS NOT NULL)
    AND cardinality(p_frontier_receipts)=expected
    AND (SELECT count(*)=expected AND count(DISTINCT terminal_id)=expected FROM frontiers) matched),
 movements AS MATERIALIZED(SELECT id,operation_id,product_id,terminal_id,actor_id,quantity_delta,effective_ticks,
    clock_state,payload_hash,ingested_cursor
   FROM public.stock_history_movements WHERE store_id=p_branch AND ingested_cursor<=cursor_at_observation),
 member_effects AS MATERIALIZED(
  SELECT m.id, cardinality(r.effect_ids) AS expected_effects, e.found, e.delta,
    v.movement_id IS NOT NULL AND f.terminal_id IS NOT NULL AS bound
  FROM movements m
  LEFT JOIN private.stock_history_claim_receipts r ON (r.movement_id,r.store_id,r.terminal_id,r.ingested_cursor,r.payload_hash,r.author_id::text)
    =(m.id,p_branch,m.terminal_id,m.ingested_cursor,m.payload_hash,m.actor_id)
  LEFT JOIN private.stock_history_source_claim_verifications v ON (v.movement_id,v.project_origin,v.store_id,v.terminal_id,
    v.operation_id,v.author_id,v.key_id)=(m.id,p_project,p_branch,m.terminal_id,m.operation_id,r.author_id,r.key_id)
  LEFT JOIN frontiers f ON (f.terminal_id,f.database_guid)=(v.terminal_id,v.database_guid)
    AND v.source_sequence<=f.source_sequence AND (v.source_sequence<f.source_sequence OR v.source_root=f.source_root)
  LEFT JOIN LATERAL (
   SELECT count(DISTINCT effect.id) found,sum(effect.quantity_delta) delta
   FROM unnest(r.effect_ids) id(value)
   JOIN private.stock_history_accepted_effects effect ON (effect.id,effect.store_id,effect.product_id)=(id.value,p_branch,m.product_id)
   JOIN private.stock_history_effect_coverage cover ON (cover.effect_id,cover.movement_id)=(effect.id,m.id)
  ) e ON true
 )
 SELECT (SELECT matched FROM roster_result),
  (SELECT count(*)=cursor_at_observation AND COALESCE(sum(e.found),0)=effect_count
    AND COALESCE(bool_and(e.bound AND e.found=e.expected_effects AND e.delta=m.quantity_delta),true)
    FROM member_effects e JOIN movements m USING(id)),
  EXISTS(SELECT 1 FROM public.stock_history_movements WHERE store_id=p_branch
   AND ingested_cursor>cursor_at_observation AND effective_ticks<=cutoff),
  EXISTS(SELECT 1 FROM movements WHERE effective_ticks>cutoff),
  EXISTS(SELECT 1 FROM movements WHERE clock_state<>'verified')
 INTO roster_matched,effects_matched,late_effective,future_effective,clock_unverified;

 RETURN jsonb_build_object('openingId',p_observation,'branchId',p_branch,'cutoff',p_cutoff,
  'sourceCursor',cursor_at_observation::text,'scopedPcRosterMatched',roster_matched,
  'observedEffectsAttested',COALESCE(roster_matched AND effects_matched,false),
  'lateEffectiveMovements',late_effective,'includedFutureEffectiveMovements',future_effective,
  'unverifiedMovementClock',clock_unverified,'allWriterCoverageProven',false,'effectiveOpeningEligible',false);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_opening_eligibility(text,text,text,text,uuid,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
