-- STOCK401 DRAFT. Typed identity observations, never business/clock authority.
-- Exact-project approval is required before any application or activation.
BEGIN;
DO $guard$ BEGIN
 IF to_regclass('private.stock_history_source_claim_verifications') IS NULL OR to_regclass('pos_sync_private.shift_author_keys') IS NULL
  OR to_regprocedure('private.stock_history_ticks(text)') IS NULL THEN RAISE EXCEPTION 'STOCK_FRONTIER_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_frontier_challenges') IS NOT NULL OR to_regclass('private.stock_history_frontier_receipts') IS NOT NULL
  THEN RAISE EXCEPTION 'STOCK_FRONTIER_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;
CREATE TABLE private.stock_history_frontier_challenges(
 id uuid PRIMARY KEY,project_origin text NOT NULL,store_id text NOT NULL,terminal_id text NOT NULL,author_id uuid NOT NULL,key_id uuid NOT NULL,
 nonce text NOT NULL CHECK(nonce~'^[A-Za-z0-9_-]{43}$'),cohort_hash text NOT NULL CHECK(cohort_hash~'^[a-f0-9]{64}$'),
 cohort jsonb NOT NULL CHECK(jsonb_typeof(cohort)='array' AND jsonb_array_length(cohort) BETWEEN 1 AND 1024),
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes')
);
CREATE TABLE private.stock_history_frontier_receipts(
 challenge_id uuid PRIMARY KEY REFERENCES private.stock_history_frontier_challenges(id),project_origin text NOT NULL,store_id text NOT NULL,terminal_id text NOT NULL,
 author_id uuid NOT NULL,key_id uuid NOT NULL,database_guid uuid NOT NULL,frontier_hash text NOT NULL CHECK(frontier_hash~'^[a-f0-9]{64}$'),
 frontier_json text NOT NULL CHECK(octet_length(convert_to(frontier_json,'UTF8'))<=8192),
 proof_json text NOT NULL CHECK(octet_length(convert_to(proof_json,'UTF8'))<=8192),
 source_sequence bigint NOT NULL CHECK(source_sequence>=0),source_root text,source_generation text NOT NULL CHECK(source_generation~'^[a-f0-9]{64}$'),
 gap_hash text NOT NULL CHECK(gap_hash~'^[a-f0-9]{64}$'),pending jsonb NOT NULL,observed_at_raw text NOT NULL,
 prefix_state text NOT NULL CHECK(prefix_state IN('accepted','unconfirmed')),reasons text[] NOT NULL,accepted_at timestamptz NOT NULL,
 CHECK(frontier_hash=encode(sha256(convert_to(frontier_json,'UTF8')),'hex')),
 CHECK((source_sequence=0 AND source_root IS NULL) OR (source_sequence>0 AND source_root~'^[a-f0-9]{64}$'))
);
CREATE INDEX stock_history_frontier_latest ON private.stock_history_frontier_receipts(project_origin,store_id,terminal_id,accepted_at DESC);
DO $protect$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_frontier_challenges','stock_history_frontier_receipts'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name||'_immutable',name);
 END LOOP;
END $protect$;

CREATE FUNCTION private.stock_history_frontier_cohort(p_branch text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE result jsonb;BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_array(id::text,platform,status,COALESCE(is_claimed,false)) ORDER BY id),'[]'::jsonb) INTO result
 FROM public.terminal_tokens WHERE location_id=p_branch AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL);
 IF jsonb_array_length(result) NOT BETWEEN 1 AND 1024 OR octet_length(convert_to(result::text,'UTF8'))>262144 THEN RAISE EXCEPTION 'STOCK_FRONTIER_COHORT_UNAVAILABLE';END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_frontier_cohort(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_frontier_identity(p_project text,p_branch text,p_terminal text,p_author uuid,p_key uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE person public.app_users%ROWTYPE;registered pos_sync_private.shift_author_keys%ROWTYPE;branch_scope text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
 IF p_project IS NULL OR length(p_project)>2048 OR p_project!~'^https://'
  OR NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal AND location_id=p_branch AND platform='pc'
   AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL)) THEN RAISE EXCEPTION 'STOCK_FRONTIER_IDENTITY_INVALID';END IF;
 SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE key_id=p_key AND author_id=p_author AND terminal_id=p_terminal
  AND project_origin=p_project AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_FRONTIER_IDENTITY_INVALID';END IF;
 SELECT * INTO person FROM public.app_users WHERE id=p_author FOR SHARE;
 branch_scope:=CASE WHEN person.store_id~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN lower(person.store_id) ELSE person.store_id END;
 IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM registered.subject
  OR(person.store_id IS NOT NULL AND branch_scope IS DISTINCT FROM p_branch) THEN RAISE EXCEPTION 'STOCK_FRONTIER_IDENTITY_INVALID';END IF;
 -- Identity observation grants no inventory/report read, opening or stock write.
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_frontier_identity(text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_frontier_challenge(p_id uuid,p_project text,p_branch text,p_terminal text,p_author uuid,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE prior private.stock_history_frontier_challenges%ROWTYPE;members jsonb;at timestamptz:=clock_timestamp();BEGIN
 PERFORM private.stock_history_frontier_identity(p_project,p_branch,p_terminal,p_author,p_key);
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-frontier-challenge:'||p_id::text,0));
 SELECT * INTO prior FROM private.stock_history_frontier_challenges WHERE id=p_id;
 IF FOUND THEN
  IF ROW(prior.project_origin,prior.store_id,prior.terminal_id,prior.author_id,prior.key_id) IS DISTINCT FROM ROW(p_project,p_branch,p_terminal,p_author,p_key)
   THEN RAISE EXCEPTION 'STOCK_FRONTIER_CHALLENGE_CONFLICT';END IF;
 ELSE
  members:=private.stock_history_frontier_cohort(p_branch);
  INSERT INTO private.stock_history_frontier_challenges VALUES(p_id,p_project,p_branch,p_terminal,p_author,p_key,
   rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'base64'),'+/','-_'),'='),
   encode(sha256(convert_to(members::text,'UTF8')),'hex'),members,at,at+interval '5 minutes') RETURNING * INTO prior;
 END IF;
 RETURN jsonb_build_object('challengeId',prior.id,'nonce',prior.nonce,'cohortHash',prior.cohort_hash,
  'issuedAt',to_char(prior.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
  'expiresAt',to_char(prior.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z');
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_frontier_challenge(uuid,text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_frontier_challenge(uuid,text,text,text,uuid,uuid) TO service_role;

CREATE FUNCTION public.pos_stock_history_accept_frontier(p_project text,p_branch text,p_terminal text,p_frontier_json text,p_proof_json text,p_author_verified boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE f jsonb;proof jsonb;c private.stock_history_frontier_challenges%ROWTYPE;prior private.stock_history_frontier_receipts%ROWTYPE;
 hash text;author uuid;key uuid;database_id uuid;sequence bigint;cohort jsonb;groups bigint;top_sequence bigint;last_root text;broken boolean;
 reasons text[]:=ARRAY[]::text[];name text;value text;at timestamptz:=clock_timestamp();observed numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
 IF p_frontier_json IS NULL OR p_proof_json IS NULL OR octet_length(convert_to(p_frontier_json,'UTF8'))>8192 OR octet_length(convert_to(p_proof_json,'UTF8'))>8192
  THEN RAISE EXCEPTION 'STOCK_FRONTIER_INVALID';END IF;
 f:=p_frontier_json::jsonb;proof:=p_proof_json::jsonb;hash:=encode(sha256(convert_to(p_frontier_json,'UTF8')),'hex');
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(f))<>16 OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
  OR NOT f ?& ARRAY['version','projectOrigin','branchId','terminalId','authorId','databaseId','challengeId','nonce','cohortHash','writerRevision','sourceSequence','sourceRoot','sourceGeneration','gapHash','pending','observedAt']
  OR NOT proof ?& ARRAY['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','challengeId','frontierHash','signature']
  OR (SELECT count(*) FROM jsonb_object_keys(proof))<>11 OR f->'version' IS DISTINCT FROM '1'::jsonb OR proof->'version' IS DISTINCT FROM '1'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_each(f) item WHERE item.key NOT IN('version','pending','sourceRoot') AND jsonb_typeof(item.value)<>'string')
  OR(f->'sourceRoot'<>'null'::jsonb AND jsonb_typeof(f->'sourceRoot')<>'string')
  OR f->>'writerRevision' IS DISTINCT FROM 'stock-history-source.v1' OR proof->>'algorithm' IS DISTINCT FROM 'Ed25519'
  OR f->>'projectOrigin' IS DISTINCT FROM p_project OR proof->>'projectOrigin' IS DISTINCT FROM p_project
  OR f->>'branchId' IS DISTINCT FROM p_branch OR proof->>'branchId' IS DISTINCT FROM p_branch
  OR f->>'terminalId' IS DISTINCT FROM p_terminal OR proof->>'terminalId' IS DISTINCT FROM p_terminal
  OR f->>'authorId' IS DISTINCT FROM proof->>'authorId' OR f->>'challengeId' IS DISTINCT FROM proof->>'challengeId'
  OR proof->>'frontierHash' IS DISTINCT FROM hash OR f->>'sourceSequence'!~'^(0|[1-9][0-9]{0,18})$'
  OR f->>'sourceGeneration'!~'^[a-f0-9]{64}$' OR f->>'gapHash'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'STOCK_FRONTIER_INVALID';END IF;
 author:=(proof->>'authorId')::uuid;key:=(proof->>'keyId')::uuid;database_id:=(f->>'databaseId')::uuid;sequence:=(f->>'sourceSequence')::bigint;
 SELECT * INTO c FROM private.stock_history_frontier_challenges WHERE id=(f->>'challengeId')::uuid FOR SHARE;
 IF NOT FOUND OR ROW(c.project_origin,c.store_id,c.terminal_id,c.author_id,c.key_id,c.nonce,c.cohort_hash)
  IS DISTINCT FROM ROW(p_project,p_branch,p_terminal,author,key,f->>'nonce',f->>'cohortHash') THEN RAISE EXCEPTION 'STOCK_FRONTIER_CHALLENGE_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-frontier-receipt:'||c.id::text,0));
 SELECT * INTO prior FROM private.stock_history_frontier_receipts WHERE challenge_id=c.id;
 IF FOUND THEN
  IF convert_to(prior.frontier_json,'UTF8') IS DISTINCT FROM convert_to(p_frontier_json,'UTF8') OR convert_to(prior.proof_json,'UTF8') IS DISTINCT FROM convert_to(p_proof_json,'UTF8')
   THEN RAISE EXCEPTION 'STOCK_FRONTIER_REPLAY_CONFLICT';END IF;
 ELSE
  IF p_author_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'STOCK_FRONTIER_AUTHOR_REQUIRED';END IF;
  PERFORM private.stock_history_frontier_identity(p_project,p_branch,p_terminal,author,key);
  IF proof->>'subject' IS DISTINCT FROM(SELECT subject FROM pos_sync_private.shift_author_keys WHERE key_id=key) THEN RAISE EXCEPTION 'STOCK_FRONTIER_IDENTITY_INVALID';END IF;
  cohort:=private.stock_history_frontier_cohort(p_branch);
  IF c.expires_at<at OR c.issued_at>at OR c.cohort IS DISTINCT FROM cohort THEN RAISE EXCEPTION 'STOCK_FRONTIER_CHALLENGE_STALE';END IF;
  IF jsonb_typeof(f->'pending') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(f->'pending'))<>4 THEN RAISE EXCEPTION 'STOCK_FRONTIER_INVALID';END IF;
  FOREACH name IN ARRAY ARRAY['business','metadata','unsigned','unknown'] LOOP
   value:=f->'pending'->>name;
   IF value IS NULL OR jsonb_typeof(f->'pending'->name)<>'string' OR value!~'^(0|[1-9][0-9]{0,18})$' OR value::numeric>9223372036854775807 THEN RAISE EXCEPTION 'STOCK_FRONTIER_INVALID';END IF;
   IF value<>'0' THEN reasons:=array_append(reasons,'PENDING_'||upper(name));END IF;
  END LOOP;
  observed:=private.stock_history_ticks(f->>'observedAt');
  IF observed<extract(epoch FROM c.issued_at)*10000000-3000000000 OR observed>extract(epoch FROM at)*10000000+3000000000
   THEN reasons:=array_append(reasons,'DEVICE_CLOCK_ANOMALY');END IF;
  WITH source_groups AS(SELECT source_sequence,min(source_root) root,min(source_count) size,max(source_count) maximum_size,count(*) members,
    count(DISTINCT source_root) roots,count(DISTINCT operation_id) operations,
    min(((envelope_json::jsonb->>'proofJson')::jsonb)->>'sourcePredecessorRoot') predecessor,
    count(DISTINCT COALESCE(((envelope_json::jsonb->>'proofJson')::jsonb)->>'sourcePredecessorRoot','<NULL>')) predecessors
   FROM private.stock_history_source_claim_verifications WHERE project_origin=p_project AND store_id=p_branch AND terminal_id=p_terminal AND database_guid=database_id
   GROUP BY source_sequence),ordered AS(SELECT *,row_number() OVER(ORDER BY source_sequence) expected,lag(root) OVER(ORDER BY source_sequence) previous FROM source_groups)
   SELECT count(*),COALESCE(max(source_sequence),0),max(root) FILTER(WHERE source_sequence=sequence),
    COALESCE(bool_or(source_sequence<>expected OR roots<>1 OR operations<>1 OR predecessors<>1 OR members<>size OR size<>maximum_size OR predecessor IS DISTINCT FROM previous),false)
   INTO groups,top_sequence,last_root,broken FROM ordered;
  IF groups<>sequence OR top_sequence<>sequence OR broken OR last_root IS DISTINCT FROM f->>'sourceRoot'
   THEN reasons:=array_append(reasons,'SOURCE_PREFIX_UNCONFIRMED');END IF;
  INSERT INTO private.stock_history_frontier_receipts VALUES(c.id,p_project,p_branch,p_terminal,author,key,database_id,hash,p_frontier_json,p_proof_json,
   sequence,f->>'sourceRoot',f->>'sourceGeneration',f->>'gapHash',f->'pending',f->>'observedAt',CASE WHEN cardinality(reasons)=0 THEN 'accepted' ELSE 'unconfirmed' END,reasons,at) RETURNING * INTO prior;
 END IF;
 RETURN jsonb_build_object('challengeId',prior.challenge_id,'frontierHash',prior.frontier_hash,'state',prior.prefix_state,'reasons',prior.reasons,
  'acceptedAt',to_char(prior.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z','observationGrade','author_claimed');
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_accept_frontier(text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_accept_frontier(text,text,text,text,text,boolean) TO service_role;
COMMIT;
