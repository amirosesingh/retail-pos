-- STOCK401 preparation. The caller owns the schema transaction. Installing the
-- routines does not activate a pause. A separate reviewed, database-owner-only
-- install must bind the guard to one dedicated synthetic Beta branch.
DO $guard$ BEGIN
 IF to_regprocedure('public.pos_stock_history_start_stocktake(text,text,text,text,uuid)') IS NULL
  OR to_regprocedure('private.stock_history_opening_latest_frontiers(text,text,jsonb,timestamptz,uuid[])') IS NULL
  OR to_regclass('private.stock_history_cutover_scope') IS NOT NULL THEN RAISE EXCEPTION 'STOCK_CUTOVER_DEPENDENCY_SCOPE';END IF;
END $guard$;

CREATE TABLE private.stock_history_cutover_scope(
 store_id text PRIMARY KEY,project_origin text NOT NULL,cluster_id text NOT NULL,marker text NOT NULL,
 singleton boolean NOT NULL UNIQUE DEFAULT true CHECK(singleton),active_id uuid,gate_revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE private.stock_history_cutover_enrollment(
 store_id text NOT NULL REFERENCES private.stock_history_cutover_scope(store_id),terminal_id uuid NOT NULL,database_id uuid NOT NULL,
 PRIMARY KEY(store_id,terminal_id),UNIQUE(store_id,database_id)
);
CREATE TABLE private.stock_history_cutover_leases(
 id uuid PRIMARY KEY,store_id text NOT NULL REFERENCES private.stock_history_cutover_scope(store_id),
 witness_id uuid NOT NULL,witness_subject text NOT NULL,witness_terminal text NOT NULL,
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at=issued_at+interval '5 minutes'),
 armed_at timestamptz,cutoff_at text,arm_claims jsonb,released_at timestamptz,expired_write_at timestamptz,
 CHECK(expired_write_at IS NULL OR expired_write_at>=expires_at),
 CHECK((armed_at IS NULL AND cutoff_at IS NULL AND arm_claims IS NULL)
    OR (armed_at IS NOT NULL AND cutoff_at IS NOT NULL AND arm_claims IS NOT NULL))
);
CREATE TABLE private.stock_history_cutover_publications(
 baseline_id uuid PRIMARY KEY REFERENCES public.stock_history_baselines(id),
 store_id text NOT NULL,project_origin text NOT NULL,stocktake_evidence_hash text NOT NULL,
 reviewer_id uuid NOT NULL,reviewer_subject text NOT NULL,reviewer_terminal text NOT NULL,
 custody_hash text NOT NULL CHECK(custody_hash~'^[a-f0-9]{64}$'),published_at timestamptz NOT NULL,
 arm_claims jsonb NOT NULL,confirm_claims jsonb NOT NULL
);
DO $tables$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_cutover_scope','stock_history_cutover_enrollment','stock_history_cutover_leases','stock_history_cutover_publications'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['stock_history_cutover_enrollment','stock_history_cutover_publications'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name||'_immutable',name);
 END LOOP;
END $tables$;

CREATE FUNCTION private.stock_history_cutover_utc(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $fn$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z'
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_utc(timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_cutover_branch_matches(p_id text,p_branch text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $fn$
 SELECT btrim(p_id)=p_branch OR (p_branch~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' AND lower(btrim(p_id))=p_branch)
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_branch_matches(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_cutover_stock_slot(p_map jsonb,p_branch text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb)
 FROM jsonb_each(CASE WHEN jsonb_typeof(p_map)='object' THEN p_map ELSE '{}'::jsonb END)
 WHERE private.stock_history_cutover_branch_matches(key,p_branch)
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_stock_slot(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- All stock-changing central writers meet here even if they are not using a
-- report adapter. Share locks are transaction-length and only scoped writes
-- take them. Older MVCC snapshots fail on an updated/missing fixed sentinel.
CREATE FUNCTION private.stock_history_cutover_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE old_row jsonb;new_row jsonb;scope text:=TG_ARGV[0];cluster text:=TG_ARGV[1];
 gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;
 inventory boolean:=false;membership boolean:=false;owns_target boolean;old_slot jsonb;new_slot jsonb;at_time timestamptz;
BEGIN
 IF TG_OP NOT IN('INSERT','TRUNCATE') THEN old_row:=to_jsonb(OLD);END IF;
 IF TG_OP NOT IN('DELETE','TRUNCATE') THEN new_row:=to_jsonb(NEW);END IF;
 IF TG_OP='TRUNCATE' THEN inventory:=true;membership:=true;
 ELSIF TG_TABLE_NAME='products' THEN
  owns_target:=private.stock_history_cutover_branch_matches(old_row->>'owner_store_id',scope)
    OR private.stock_history_cutover_branch_matches(new_row->>'owner_store_id',scope);
  old_slot:=private.stock_history_cutover_stock_slot(old_row->'stock_by_store',scope);
  new_slot:=private.stock_history_cutover_stock_slot(new_row->'stock_by_store',scope);
  inventory:=old_slot IS DISTINCT FROM new_slot
   OR (old_row->>'owner_store_id',old_row->>'name',old_row->>'sku',old_row->>'barcode',old_row->>'deleted_at',old_row->>'archived_at')
     IS DISTINCT FROM (new_row->>'owner_store_id',new_row->>'name',new_row->>'sku',new_row->>'barcode',new_row->>'deleted_at',new_row->>'archived_at')
     AND (owns_target OR old_slot<>'{}'::jsonb OR new_slot<>'{}'::jsonb);
  IF NOT COALESCE(inventory,false) AND owns_target THEN
   inventory:=((old_row->>'stock_quantity') IS DISTINCT FROM (new_row->>'stock_quantity')
    AND old_row->'stock_by_store' IS NOT DISTINCT FROM new_row->'stock_by_store')
    OR (old_row->'stock_by_store' IS DISTINCT FROM new_row->'stock_by_store'
        AND (jsonb_typeof(old_row->'stock_by_store') IS DISTINCT FROM 'object' OR jsonb_typeof(new_row->'stock_by_store') IS DISTINCT FROM 'object'));
  END IF;
 ELSIF TG_TABLE_NAME='terminal_tokens' THEN
  membership:=(private.stock_history_cutover_branch_matches(old_row->>'location_id',scope)
     OR private.stock_history_cutover_branch_matches(new_row->>'location_id',scope)) AND
   (old_row->>'id',old_row->>'location_id',old_row->>'platform',old_row->>'status',old_row->>'revoked_at',old_row->>'is_claimed',old_row->>'claimed_at',old_row->>'management_sync_enabled')
    IS DISTINCT FROM (new_row->>'id',new_row->>'location_id',new_row->>'platform',new_row->>'status',new_row->>'revoked_at',new_row->>'is_claimed',new_row->>'claimed_at',new_row->>'management_sync_enabled');
 ELSIF TG_TABLE_NAME='stores' THEN
  inventory:=old_row->>'id'=scope OR new_row->>'id'=scope OR old_row->>'group_id'=cluster OR new_row->>'group_id'=cluster
   OR old_row->>'parent_id'=scope OR new_row->>'parent_id'=scope;
 ELSIF TG_TABLE_NAME='stock_transfers' THEN
  inventory:=scope IN(old_row->>'from_store_id',old_row->>'to_store_id',new_row->>'from_store_id',new_row->>'to_store_id');
 ELSIF TG_TABLE_NAME='stock_transfer_items' THEN
  inventory:=EXISTS(SELECT 1 FROM public.stock_transfers t WHERE t.id::text IN(old_row->>'transfer_id',new_row->>'transfer_id')
    AND scope IN(t.from_store_id,t.to_store_id));
 END IF;
 IF inventory IS TRUE OR membership IS TRUE THEN
  SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=scope FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_GUARD_UNAVAILABLE';END IF;
  SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=gate.active_id;
  IF FOUND AND lease.released_at IS NULL AND lease.expired_write_at IS NULL THEN
   at_time:=clock_timestamp();
   IF at_time>=lease.expires_at THEN
    -- A write allowed after expiry makes this lease permanently unusable,
    -- including after an upstream PostgreSQL wall-clock correction.
    UPDATE private.stock_history_cutover_leases SET expired_write_at=at_time WHERE id=lease.id AND expired_write_at IS NULL;
   ELSIF membership IS TRUE OR lease.armed_at IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_CUTOVER_PAUSED' USING ERRCODE='55P03';
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_cutover_stock_keys_ready(p_branch text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT NOT EXISTS(SELECT 1 FROM public.products p
  WHERE private.stock_history_cutover_stock_slot(p.stock_by_store,p_branch)-p_branch<>'{}'::jsonb
   OR (p.owner_store_id<>p_branch AND private.stock_history_cutover_branch_matches(p.owner_store_id,p_branch)))
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_stock_keys_ready(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_cutover_guard_ready(p_branch text,p_cluster text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT count(*)=10 FROM (VALUES('products'),('terminal_tokens'),('stores'),('stock_transfers'),('stock_transfer_items')) rel(name)
 CROSS JOIN (VALUES('stock_history_cutover_rows',31),('stock_history_cutover_truncate',34)) variant(name,kind)
 JOIN pg_trigger t ON t.tgname=variant.name AND t.tgtype=variant.kind
 WHERE t.tgrelid=to_regclass(format('public.%I',rel.name)) AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=2
  AND t.tgfoid=to_regprocedure('private.stock_history_cutover_guard()') AND t.tgqual IS NULL AND t.tgattr=''::int2vector
  AND t.tgargs=convert_to(p_branch,'UTF8')||decode('00','hex')||convert_to(p_cluster,'UTF8')||decode('00','hex')
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_guard_ready(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_cutover_roster(p_branch text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE scope private.stock_history_cutover_scope%ROWTYPE;claimed jsonb;enrolled jsonb;
BEGIN
 SELECT * INTO scope FROM private.stock_history_cutover_scope WHERE store_id=p_branch;
 IF NOT FOUND OR NOT private.stock_history_cutover_guard_ready(p_branch,scope.cluster_id) OR NOT EXISTS(
  SELECT 1 FROM public.stores s WHERE s.id=p_branch AND s.code=scope.marker AND s.group_id=scope.cluster_id
    AND s.parent_id IS NULL AND s.is_active IS TRUE AND s.archived_at IS NULL AND s.private_catalogue IS TRUE)
  OR EXISTS(SELECT 1 FROM public.stores s WHERE s.id<>p_branch AND (s.group_id=scope.cluster_id OR s.parent_id=p_branch))
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 claimed:=private.stock_history_opening_claimed_roster(p_branch);
 SELECT COALESCE(jsonb_agg(terminal_id::text ORDER BY terminal_id),'[]'::jsonb) INTO enrolled
  FROM private.stock_history_cutover_enrollment WHERE store_id=p_branch;
 IF jsonb_array_length(claimed) NOT BETWEEN 1 AND 16 OR EXISTS(SELECT 1 FROM jsonb_array_elements(claimed) t
   WHERE t->>1 IS DISTINCT FROM 'pc' OR (t->>2 IN ('active','used')) IS NOT TRUE OR t->>3 IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.location_id=p_branch AND t.management_sync_enabled IS TRUE)
  OR EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.location_id<>p_branch
    AND private.stock_history_cutover_branch_matches(t.location_id,p_branch) AND (t.is_claimed OR t.claimed_at IS NOT NULL))
  OR enrolled IS DISTINCT FROM (SELECT jsonb_agg(t->0 ORDER BY t->>0) FROM jsonb_array_elements(claimed) t)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROSTER_UNCONFIRMED';END IF;
 RETURN claimed;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_roster(text) FROM PUBLIC,anon,authenticated,service_role;

-- Exact scope provisioning is available only to the owning database role.
-- Serialize configuration with the owned trigger install in one transaction.
CREATE FUNCTION private.stock_history_install_cutover_guard(p_project text,p_branch text,p_marker text,
 p_terminals uuid[],p_databases uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE name text;cluster text;
BEGIN
 IF p_project IS NULL OR p_project!~'^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' OR length(p_project)>2048
  OR p_branch IS NULL OR p_branch!~'^[A-Za-z0-9-]{1,128}$' OR p_marker IS NULL OR p_marker!~'^CODEX-STOCK401-[A-Z0-9-]{6,64}$'
  OR (p_branch~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' AND p_branch<>lower(p_branch))
  OR cardinality(p_terminals) IS NULL OR cardinality(p_terminals) NOT BETWEEN 1 AND 16 OR cardinality(p_terminals) IS DISTINCT FROM cardinality(p_databases)
  OR array_ndims(p_terminals)<>1 OR array_ndims(p_databases)<>1 THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_INVALID';END IF;
 SELECT s.group_id INTO cluster FROM public.stores s WHERE s.id=p_branch AND s.code=p_marker AND s.private_catalogue IS TRUE;
 IF cluster IS NULL OR cluster!~'^[A-Za-z0-9-]{1,128}$' THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_INVALID';END IF;
 INSERT INTO private.stock_history_cutover_scope(store_id,project_origin,cluster_id,marker) VALUES(p_branch,p_project,cluster,p_marker);
 INSERT INTO private.stock_history_cutover_enrollment SELECT p_branch,ids.terminal_id,ids.database_id FROM unnest(p_terminals,p_databases) ids(terminal_id,database_id);
 FOREACH name IN ARRAY ARRAY['products','terminal_tokens','stores','stock_transfers','stock_transfer_items'] LOOP
  EXECUTE format('CREATE TRIGGER stock_history_cutover_rows BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_cutover_guard(%L,%L)',name,p_branch,cluster);
  EXECUTE format('CREATE TRIGGER stock_history_cutover_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.stock_history_cutover_guard(%L,%L)',name,p_branch,cluster);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER stock_history_cutover_rows',name);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER stock_history_cutover_truncate',name);
 END LOOP;
 PERFORM private.stock_history_cutover_roster(p_branch);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_install_cutover_guard(text,text,text,uuid[],uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_prepare_stocktake_pause(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;at_time timestamptz;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'STOCK_CUTOVER_INVALID';END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 PERFORM private.stock_history_cutover_roster(p_branch);
 IF EXISTS(SELECT 1 FROM private.stock_history_cutover_publications WHERE store_id=p_branch) THEN RAISE EXCEPTION 'STOCK_CUTOVER_ALREADY_PUBLISHED';END IF;
 at_time:=clock_timestamp();
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id;
 IF FOUND THEN
  IF gate.active_id IS DISTINCT FROM p_id OR ROW(lease.store_id,lease.witness_id,lease.witness_subject,lease.witness_terminal)
   IS DISTINCT FROM ROW(p_branch,actor,p_subject,p_terminal) OR lease.released_at IS NOT NULL OR lease.expired_write_at IS NOT NULL OR at_time>=lease.expires_at
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM private.stock_history_cutover_leases WHERE id=gate.active_id AND released_at IS NULL AND expired_write_at IS NULL AND at_time<expires_at)
   OR EXISTS(SELECT 1 FROM private.stock_history_stocktakes WHERE id=p_id) THEN RAISE EXCEPTION 'STOCK_CUTOVER_BUSY';END IF;
  INSERT INTO private.stock_history_cutover_leases(id,store_id,witness_id,witness_subject,witness_terminal,issued_at,expires_at)
   VALUES(p_id,p_branch,actor,p_subject,p_terminal,at_time,at_time+interval '5 minutes') RETURNING * INTO lease;
  UPDATE private.stock_history_cutover_scope SET active_id=p_id,gate_revision=gate_revision+1 WHERE store_id=p_branch;
 END IF;
 RETURN jsonb_build_object('stocktakeId',p_id,'projectOrigin',p_project,'branchId',p_branch,
  'leaseIssuedAt',private.stock_history_cutover_utc(lease.issued_at),'leaseExpiresAt',private.stock_history_cutover_utc(lease.expires_at));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_prepare_stocktake_pause(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_prepare_stocktake_pause(text,text,text,text,uuid) TO service_role;

CREATE FUNCTION private.stock_history_cutover_proofs(p_branch text,p_project text,p_lease private.stock_history_cutover_leases,
 p_phase text,p_after timestamptz,p_claims jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE roster jsonb;claim jsonb;normalized jsonb;expected integer;actual integer;frontier_ids uuid[];
BEGIN
 IF p_phase NOT IN('arm','confirm') OR jsonb_typeof(p_claims) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
 IF jsonb_array_length(p_claims) NOT BETWEEN 1 AND 16 OR octet_length(convert_to(p_claims::text,'UTF8'))>16384
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
 FOR claim IN SELECT value FROM jsonb_array_elements(p_claims) LOOP
  IF jsonb_typeof(claim) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(claim))<>6 OR EXISTS(SELECT 1 FROM (VALUES('terminalId'),('challengeId'),('databaseId'),('fenceGeneration')) ids(name)
      WHERE jsonb_typeof(claim->name) IS DISTINCT FROM 'string' OR claim->>name!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
   OR EXISTS(SELECT 1 FROM (VALUES('localFencedAt'),('localExpiresAt')) fields(name) WHERE jsonb_typeof(claim->name) IS DISTINCT FROM 'string'
     OR claim->>name!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{7}Z$')
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
  IF private.stock_history_ticks(claim->>'localFencedAt')<extract(epoch FROM p_lease.issued_at)*10000000
   OR private.stock_history_ticks(claim->>'localFencedAt')>extract(epoch FROM clock_timestamp())*10000000
   OR private.stock_history_ticks(claim->>'localExpiresAt')<extract(epoch FROM p_lease.expires_at)*10000000
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_LOCAL_WINDOW_UNSAFE';END IF;
 END LOOP;
 roster:=private.stock_history_cutover_roster(p_branch);expected:=jsonb_array_length(roster);
 SELECT array_agg((x->>'challengeId')::uuid ORDER BY x->>'terminalId'),jsonb_agg(x ORDER BY x->>'terminalId')
 INTO frontier_ids,normalized FROM jsonb_array_elements(p_claims) x;
 IF cardinality(frontier_ids)<>expected OR (SELECT count(DISTINCT x->>'terminalId') FROM jsonb_array_elements(normalized) x)<>expected
  OR (SELECT count(DISTINCT x->>'challengeId') FROM jsonb_array_elements(normalized) x)<>expected
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_ROSTER_UNCONFIRMED';END IF;
 WITH valid AS MATERIALIZED(SELECT * FROM private.stock_history_opening_latest_frontiers(p_project,p_branch,roster,p_after,frontier_ids))
 SELECT count(*) INTO actual FROM jsonb_array_elements(normalized) x
 JOIN private.stock_history_cutover_enrollment e ON e.store_id=p_branch AND e.terminal_id::text=x->>'terminalId' AND e.database_id::text=x->>'databaseId'
 JOIN valid v ON v.terminal_id=e.terminal_id::text AND v.database_guid=e.database_id
 JOIN private.stock_history_frontier_receipts r ON r.challenge_id=(x->>'challengeId')::uuid AND r.terminal_id=v.terminal_id AND r.database_guid=v.database_guid
 JOIN private.stock_history_frontier_challenges c ON c.id=r.challenge_id
 WHERE r.accepted_at<p_lease.expires_at AND r.accepted_at<=clock_timestamp()
  AND private.stock_history_ticks(x->>'localFencedAt')<=extract(epoch FROM r.accepted_at)*10000000
  AND private.stock_history_ticks(r.observed_at_raw)>=private.stock_history_ticks(x->>'localFencedAt')
  AND private.stock_history_ticks(r.observed_at_raw)<private.stock_history_ticks(x->>'localExpiresAt')
  AND r.gap_hash=encode(sha256(convert_to(array_to_string(ARRAY['stock401-pause-v1',p_phase,p_project,p_branch,p_lease.id::text,
   x->>'terminalId',x->>'challengeId',x->>'databaseId',x->>'fenceGeneration',x->>'localFencedAt',x->>'localExpiresAt'],chr(31)),'UTF8')),'hex');
 IF actual<>expected THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_UNCONFIRMED';END IF;
 RETURN normalized;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_proofs(text,text,private.stock_history_cutover_leases,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_arm_stocktake_pause(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid,p_proofs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;
 claims jsonb;opened jsonb;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR jsonb_typeof(p_proofs) IS DISTINCT FROM 'array' OR current_setting('transaction_isolation')<>'read committed'
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_INVALID';END IF;
 IF jsonb_array_length(p_proofs) NOT BETWEEN 1 AND 16 OR octet_length(convert_to(p_proofs::text,'UTF8'))>16384
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR UPDATE NOWAIT;
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND OR gate.active_id IS DISTINCT FROM p_id OR lease.released_at IS NOT NULL OR lease.expired_write_at IS NOT NULL OR clock_timestamp()>=lease.expires_at
  OR ROW(lease.witness_id,lease.witness_subject,lease.witness_terminal) IS DISTINCT FROM ROW(actor,p_subject,p_terminal)
 THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 IF lease.armed_at IS NULL THEN
  claims:=private.stock_history_cutover_proofs(p_branch,p_project,lease,'arm',lease.issued_at,p_proofs);
  IF NOT private.stock_history_cutover_stock_keys_ready(p_branch) THEN RAISE EXCEPTION 'STOCK_CUTOVER_STOCK_KEYS_UNCONFIRMED';END IF;
  -- Existing physical staging becomes the witness's frozen roster. No central
  -- scoped writer can pass the guard while this transaction owns its gate.
  IF EXISTS(SELECT 1 FROM private.stock_history_stocktakes WHERE id=p_id) THEN RAISE EXCEPTION 'STOCK_CUTOVER_REPLAY_CONFLICT';END IF;
  opened:=public.pos_stock_history_start_stocktake(p_subject,p_terminal,p_project,p_branch,p_id);
  UPDATE private.stock_history_cutover_leases SET armed_at=clock_timestamp(),cutoff_at=opened->>'snapshotObservedAt',arm_claims=claims
   WHERE id=p_id RETURNING * INTO lease;
  UPDATE private.stock_history_cutover_scope SET gate_revision=gate_revision+1 WHERE store_id=p_branch;
 ELSE
  IF (SELECT jsonb_agg(x ORDER BY x->>'terminalId') FROM jsonb_array_elements(p_proofs) x) IS DISTINCT FROM lease.arm_claims
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_REPLAY_CONFLICT';END IF;
  opened:=public.pos_stock_history_start_stocktake(p_subject,p_terminal,p_project,p_branch,p_id);
 END IF;
 IF clock_timestamp()>=lease.expires_at THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 RETURN opened||jsonb_build_object('cutoff',lease.cutoff_at,'leaseExpiresAt',private.stock_history_cutover_utc(lease.expires_at));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_arm_stocktake_pause(text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_arm_stocktake_pause(text,text,text,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.pos_stock_history_publish_stocktake(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid,
 p_evidence_hash text,p_proofs jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;
 opened private.stock_history_stocktakes%ROWTYPE;sealed private.stock_history_stocktake_counts%ROWTYPE;
 receipt private.stock_history_cutover_publications%ROWTYPE;head public.stock_history_heads%ROWTYPE;
 claims jsonb;reviewed jsonb;candidate jsonb;watermarks jsonb;frontier_ids uuid[];
 at_time timestamptz;cutoff numeric;raw_at text;custody text;source_cursor bigint;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR p_evidence_hash IS NULL OR p_evidence_hash!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_proofs) IS DISTINCT FROM 'array'
  OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'STOCK_CUTOVER_INVALID';END IF;
 IF jsonb_array_length(p_proofs) NOT BETWEEN 1 AND 16 OR octet_length(convert_to(p_proofs::text,'UTF8'))>16384 THEN RAISE EXCEPTION 'STOCK_CUTOVER_PROOFS_INVALID';END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 SELECT * INTO receipt FROM private.stock_history_cutover_publications WHERE baseline_id=p_id;
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 IF receipt.baseline_id IS NOT NULL THEN
  IF ROW(receipt.store_id,receipt.project_origin,receipt.reviewer_id,receipt.reviewer_subject,receipt.reviewer_terminal,receipt.stocktake_evidence_hash)
   IS DISTINCT FROM ROW(p_branch,p_project,actor,p_subject,p_terminal,p_evidence_hash)
   OR (SELECT jsonb_agg(x ORDER BY x->>'terminalId') FROM jsonb_array_elements(p_proofs) x) IS DISTINCT FROM receipt.confirm_claims
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_REPLAY_CONFLICT';END IF;
 ELSE
  IF gate.active_id IS DISTINCT FROM p_id OR lease.released_at IS NOT NULL OR lease.expired_write_at IS NOT NULL OR lease.armed_at IS NULL OR clock_timestamp()>=lease.expires_at
   OR EXISTS(SELECT 1 FROM private.stock_history_cutover_publications WHERE store_id=p_branch)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
  SELECT * INTO opened FROM private.stock_history_stocktakes WHERE id=p_id AND store_id=p_branch AND project_origin=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_STOCKTAKE_REQUIRED';END IF;
  PERFORM private.stock_history_stocktake_authorize(opened.witness_subject,opened.witness_terminal,p_branch);
  SELECT * INTO sealed FROM private.stock_history_stocktake_counts WHERE stocktake_id=p_id;
  IF NOT FOUND OR sealed.evidence_hash IS DISTINCT FROM p_evidence_hash OR sealed.cutoff_at IS DISTINCT FROM lease.cutoff_at
   OR jsonb_array_length(sealed.corrections)<>0 OR sealed.observation_started_at<lease.armed_at
   OR sealed.reconciled_candidate->>'candidateHash' IS DISTINCT FROM opened.candidate->>'candidateHash'
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_STOCKTAKE_UNCONFIRMED';END IF;
  claims:=private.stock_history_cutover_proofs(p_branch,p_project,lease,'confirm',sealed.observed_at,p_proofs);
  IF (SELECT jsonb_agg(x-'challengeId' ORDER BY x->>'terminalId') FROM jsonb_array_elements(claims) x) IS DISTINCT FROM
     (SELECT jsonb_agg(x-'challengeId' ORDER BY x->>'terminalId') FROM jsonb_array_elements(lease.arm_claims) x)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_FENCE_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(lease.arm_claims) a JOIN jsonb_array_elements(claims) c ON a->>'terminalId'=c->>'terminalId'
    JOIN private.stock_history_frontier_receipts initial ON initial.challenge_id=(a->>'challengeId')::uuid
    JOIN private.stock_history_frontier_receipts final ON final.challenge_id=(c->>'challengeId')::uuid
    WHERE (initial.source_sequence,initial.source_root) IS DISTINCT FROM (final.source_sequence,final.source_root))
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_SOURCE_CHANGED';END IF;
  SELECT array_agg((x->>'challengeId')::uuid) INTO frontier_ids FROM jsonb_array_elements(claims) x;
  reviewed:=public.pos_stock_history_review_stocktake(p_subject,p_terminal,p_branch,p_id,p_evidence_hash,frontier_ids);
  IF reviewed->'scopedPcPrefixesMatched' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'STOCK_CUTOVER_REVIEW_UNCONFIRMED';END IF;
  -- Prevent cursor admission and the head/result from changing underneath the
  -- selected cutoff. Other branches retain their own independent row locks.
  SELECT * INTO head FROM public.stock_history_heads WHERE store_id=p_branch FOR UPDATE NOWAIT;
  IF head.baseline_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.stock_history_baselines WHERE store_id=p_branch AND verification_state='verified')
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_ALREADY_PUBLISHED';END IF;
  candidate:=private.stock_history_opening_candidate(p_branch);
  IF candidate->'ready' IS DISTINCT FROM 'true'::jsonb OR candidate->>'candidateHash' IS DISTINCT FROM sealed.reconciled_candidate->>'candidateHash'
   OR NOT private.stock_history_cutover_stock_keys_ready(p_branch)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_SOURCE_CHANGED';END IF;
  at_time:=clock_timestamp();
  IF at_time>=lease.expires_at OR at_time<sealed.observed_at THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
  raw_at:=private.stock_history_cutover_utc(at_time);cutoff:=private.stock_history_ticks(lease.cutoff_at);
  source_cursor:=(candidate->'source'->'head'->>'cursor')::bigint;
  custody:=encode(sha256(convert_to(jsonb_build_array('stock401-cutover-v1',p_project,p_branch,p_id,lease.cutoff_at,p_evidence_hash,
   lease.witness_id,actor,lease.arm_claims,claims,candidate->'cohort',candidate->'source')::text,'UTF8')),'hex');
  watermarks:=jsonb_build_object('version',1,'kind','paused_physical_stocktake','custodyHash',custody,'stocktakeId',p_id,
   'projectOrigin',p_project,'scopedWriterCohort',candidate->'cohort','sourceCursor',source_cursor::text);
  INSERT INTO public.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,
   opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
  VALUES(p_id,p_branch,lease.cutoff_at,cutoff,raw_at,private.stock_history_ticks(raw_at),source_cursor,'physical_count','verified',
   jsonb_array_length(sealed.physical_counts),watermarks,actor::text,custody);
  INSERT INTO public.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode,owner_store_id)
  SELECT gen_random_uuid(),p_id,(p->>'id')::uuid,p_branch,(x->>1)::numeric,p->>'name',p->>'sku',p->>'barcode',p->>'owner_store_id'
  FROM jsonb_array_elements(candidate->'pairs') p JOIN jsonb_array_elements(sealed.physical_counts) x ON x->>0=p->>'id';
  IF (SELECT count(*) FROM public.stock_history_openings WHERE baseline_id=p_id AND store_id=p_branch)<>jsonb_array_length(sealed.physical_counts)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_OPENING_INVALID';END IF;
  IF head.store_id IS NULL THEN
   INSERT INTO public.stock_history_heads(store_id,committed_cursor,coverage_generation,coverage_state,baseline_id,coverage_from_ticks,coverage_through_ticks,terminal_watermarks)
   VALUES(p_branch,source_cursor,1,'complete',p_id,cutoff,cutoff,watermarks);
  ELSE
   UPDATE public.stock_history_heads SET coverage_generation=coverage_generation+1,coverage_state='complete',baseline_id=p_id,
    coverage_from_ticks=cutoff,coverage_through_ticks=cutoff,terminal_watermarks=watermarks,updated_at=at_time WHERE store_id=p_branch;
  END IF;
  INSERT INTO private.stock_history_cutover_publications VALUES(p_id,p_branch,p_project,p_evidence_hash,actor,p_subject,p_terminal,
    custody,at_time,lease.arm_claims,claims) RETURNING * INTO receipt;
 END IF;
 RETURN jsonb_build_object('baselineId',receipt.baseline_id,'branchId',p_branch,'cutoff',lease.cutoff_at,
  'publishedAt',private.stock_history_cutover_utc(receipt.published_at),'verificationState','verified','custodyHash',receipt.custody_hash,
  'coverageFrom',lease.cutoff_at,'coverageThrough',lease.cutoff_at);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_publish_stocktake(text,text,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_publish_stocktake(text,text,text,text,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.pos_stock_history_release_stocktake_pause(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid;gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;
BEGIN
 actor:=private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND OR ROW(lease.witness_id,lease.witness_subject,lease.witness_terminal) IS DISTINCT FROM ROW(actor,p_subject,p_terminal)
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 IF lease.released_at IS NULL THEN
  IF gate.active_id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
  UPDATE private.stock_history_cutover_leases SET released_at=clock_timestamp() WHERE id=p_id RETURNING * INTO lease;
  UPDATE private.stock_history_cutover_scope SET active_id=NULL,gate_revision=gate_revision+1 WHERE store_id=p_branch;
 END IF;
 RETURN jsonb_build_object('stocktakeId',p_id,'branchId',p_branch,'releasedAt',private.stock_history_cutover_utc(lease.released_at));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_release_stocktake_pause(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_release_stocktake_pause(text,text,text,text,uuid) TO service_role;

CREATE FUNCTION private.stock_history_cutover_enrolled_lease(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid,
 p_database uuid) RETURNS private.stock_history_cutover_leases
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE gate private.stock_history_cutover_scope%ROWTYPE;lease private.stock_history_cutover_leases%ROWTYPE;
BEGIN
 PERFORM private.stock_history_stocktake_authorize(p_subject,p_terminal,p_branch);
 IF p_id IS NULL OR p_database IS NULL THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 SELECT * INTO gate FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND project_origin=p_project FOR SHARE;
 IF NOT FOUND OR NOT private.stock_history_cutover_guard_ready(p_branch,gate.cluster_id)
  OR NOT EXISTS(SELECT 1 FROM public.stores s WHERE s.id=p_branch AND s.code=gate.marker AND s.group_id=gate.cluster_id
   AND s.is_active IS TRUE AND s.archived_at IS NULL AND s.private_catalogue IS TRUE)
  OR NOT EXISTS(SELECT 1 FROM private.stock_history_cutover_enrollment e WHERE e.store_id=p_branch
   AND e.terminal_id::text=p_terminal AND e.database_id=p_database)
  OR EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal AND t.management_sync_enabled IS TRUE)
  THEN RAISE EXCEPTION 'STOCK_CUTOVER_SCOPE_UNCONFIRMED';END IF;
 SELECT * INTO lease FROM private.stock_history_cutover_leases WHERE id=p_id AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
 RETURN lease;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_cutover_enrolled_lease(text,text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_load_stocktake_lease(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid,
 p_database uuid,p_purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE lease private.stock_history_cutover_leases%ROWTYPE;state text;
BEGIN
 IF p_purpose IS NULL OR p_purpose NOT IN('arm','confirm','release') THEN RAISE EXCEPTION 'STOCK_CUTOVER_INVALID';END IF;
 lease:=private.stock_history_cutover_enrolled_lease(p_subject,p_terminal,p_project,p_branch,p_id,p_database);
 state:=CASE WHEN lease.released_at IS NOT NULL THEN 'released' WHEN lease.expired_write_at IS NOT NULL OR clock_timestamp()>=lease.expires_at THEN 'expired'
  WHEN lease.armed_at IS NULL THEN 'draining' ELSE 'armed' END;
 IF p_purpose<>'release' THEN
  IF state NOT IN('draining','armed') OR NOT EXISTS(SELECT 1 FROM private.stock_history_cutover_scope WHERE store_id=p_branch AND active_id=p_id)
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_LEASE_CLOSED';END IF;
  PERFORM private.stock_history_cutover_roster(p_branch);
  IF p_purpose='confirm' AND (state<>'armed' OR NOT EXISTS(SELECT 1 FROM private.stock_history_stocktake_counts s
    WHERE s.stocktake_id=p_id AND s.cutoff_at=lease.cutoff_at AND s.observation_started_at>=lease.armed_at AND jsonb_array_length(s.corrections)=0))
   THEN RAISE EXCEPTION 'STOCK_CUTOVER_STOCKTAKE_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('stocktakeId',lease.id,'projectOrigin',p_project,'branchId',p_branch,'terminalId',p_terminal,'databaseId',p_database,
  'leaseIssuedAt',private.stock_history_cutover_utc(lease.issued_at),'leaseExpiresAt',private.stock_history_cutover_utc(lease.expires_at),'state',state);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_load_stocktake_lease(text,text,text,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_load_stocktake_lease(text,text,text,text,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.pos_stock_history_load_stocktake_release(p_subject text,p_terminal text,p_project text,p_branch text,p_id uuid,
 p_database uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE lease private.stock_history_cutover_leases%ROWTYPE;
BEGIN
 lease:=private.stock_history_cutover_enrolled_lease(p_subject,p_terminal,p_project,p_branch,p_id,p_database);
 IF lease.released_at IS NULL OR lease.released_at<lease.issued_at THEN RAISE EXCEPTION 'STOCK_CUTOVER_RELEASE_UNCONFIRMED';END IF;
 RETURN jsonb_build_object('stocktakeId',lease.id,'projectOrigin',p_project,'branchId',p_branch,'terminalId',p_terminal,'databaseId',p_database,
  'state','released','releasedAt',private.stock_history_cutover_utc(lease.released_at));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_load_stocktake_release(text,text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_load_stocktake_release(text,text,text,text,uuid,uuid) TO service_role;
