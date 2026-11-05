-- STOCK401 DRAFT preparation only. Writer/one-lane integration is unfinished.
-- Do not apply this file before final review/exact-project approval.
-- No baseline/backfill/activation and no business writes.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

DO $guard$
DECLARE present integer;
BEGIN
 SELECT count(*) INTO present FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN('stock_history_heads','stock_history_movements','stock_history_baselines','stock_history_openings') AND c.relkind='r';
 IF present<>0 THEN RAISE EXCEPTION 'STOCK_HISTORY_EXISTING_SCHEMA_REVIEW_REQUIRED'; END IF;
 IF to_regprocedure('private.stock_history_ticks(text)') IS NOT NULL
  OR to_regprocedure('private.stock_history_immutable()') IS NOT NULL
  OR to_regprocedure('private.stock_history_authorize_read(text,text,text,boolean)') IS NOT NULL
  OR to_regprocedure('public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'STOCK_HISTORY_EXISTING_ROUTINE_REVIEW_REQUIRED';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private.stock_history_ticks(p_raw text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $fn$
BEGIN
 IF p_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{7}Z$' THEN
  RAISE EXCEPTION 'STOCK_HISTORY_INVALID_INSTANT';
 END IF;
 RETURN extract(epoch FROM (left(p_raw,19)||'Z')::timestamptz)*10000000 + substring(p_raw,21,7)::integer;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_ticks(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.stock_history_heads(
 store_id text PRIMARY KEY,
 committed_cursor bigint NOT NULL DEFAULT 0 CHECK(committed_cursor>=0),
 coverage_generation bigint NOT NULL DEFAULT 0 CHECK(coverage_generation>=0),
 coverage_state text NOT NULL DEFAULT 'unverified' CHECK(coverage_state IN('unverified','complete','incomplete')),
 baseline_id uuid,
 coverage_from_ticks numeric(20,0), coverage_through_ticks numeric(20,0),
 terminal_watermarks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(terminal_watermarks)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT stock_history_heads_coverage CHECK(coverage_state<>'complete' OR
  (baseline_id IS NOT NULL AND coverage_from_ticks IS NOT NULL AND coverage_through_ticks IS NOT NULL AND coverage_through_ticks>=coverage_from_ticks))
);
CREATE TABLE IF NOT EXISTS public.stock_history_baselines(
 id uuid PRIMARY KEY,store_id text NOT NULL,
 cutoff_at_raw text NOT NULL,cutoff_ticks numeric(20,0) NOT NULL,
 captured_at_raw text NOT NULL,captured_ticks numeric(20,0) NOT NULL,
 source_cursor bigint NOT NULL CHECK(source_cursor>=0),
 opening_kind text NOT NULL CHECK(opening_kind IN('system_snapshot','physical_count')),
 verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state IN('unverified','verified')),
 expected_pairs integer NOT NULL CHECK(expected_pairs BETWEEN 0 AND 1000000),
 terminal_watermarks jsonb NOT NULL CHECK(jsonb_typeof(terminal_watermarks)='object'),
 verified_by text,evidence_hash text NOT NULL CHECK(evidence_hash~'^[0-9a-f]{64}$'),
 CONSTRAINT stock_history_baseline_clock CHECK(cutoff_ticks=private.stock_history_ticks(cutoff_at_raw)
  AND captured_ticks=private.stock_history_ticks(captured_at_raw) AND captured_ticks>=cutoff_ticks),
 CONSTRAINT stock_history_baseline_verified CHECK(verification_state<>'verified' OR NULLIF(btrim(verified_by),'') IS NOT NULL),
 UNIQUE(store_id,id)
);
CREATE TABLE IF NOT EXISTS public.stock_history_openings(
 id uuid PRIMARY KEY,baseline_id uuid NOT NULL,product_id uuid NOT NULL,store_id text NOT NULL,
 quantity numeric(38,0) NOT NULL,product_name text NOT NULL,sku text,barcode text,owner_store_id text,
 CONSTRAINT stock_history_opening_baseline FOREIGN KEY(store_id,baseline_id) REFERENCES public.stock_history_baselines(store_id,id),
 UNIQUE(baseline_id,product_id,store_id)
);
CREATE TABLE IF NOT EXISTS public.stock_history_movements(
 id uuid PRIMARY KEY,operation_id uuid NOT NULL,product_id uuid NOT NULL,store_id text NOT NULL,
 terminal_id text NOT NULL,actor_id text,source_kind text NOT NULL,
 quantity_delta numeric(38,0) NOT NULL CHECK(quantity_delta<>0),
 effective_at_raw text NOT NULL,effective_ticks numeric(20,0) NOT NULL,
 recorded_at_raw text NOT NULL,recorded_ticks numeric(20,0) NOT NULL,
 product_name text NOT NULL,sku text,barcode text,
 clock_state text NOT NULL CHECK(clock_state IN('verified','unverified')),
 payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),payload_json text NOT NULL CHECK(jsonb_typeof(payload_json::jsonb)='array'),
 ingested_cursor bigint NOT NULL CHECK(ingested_cursor>0),ingested_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT stock_history_movement_clock CHECK(effective_ticks=private.stock_history_ticks(effective_at_raw)
  AND recorded_ticks=private.stock_history_ticks(recorded_at_raw) AND effective_ticks<=recorded_ticks),
 UNIQUE(store_id,ingested_cursor),UNIQUE(operation_id,product_id,store_id)
);
CREATE INDEX IF NOT EXISTS stock_history_movement_cutoff ON public.stock_history_movements(store_id,effective_ticks,ingested_cursor,product_id);
CREATE INDEX IF NOT EXISTS stock_history_opening_page ON public.stock_history_openings(store_id,baseline_id,product_id);

-- Evidence is append-only; invalidation advances the separate head rather than
-- rewriting an earlier opening or movement. No generic client writer is granted.
CREATE OR REPLACE FUNCTION private.stock_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN RAISE EXCEPTION 'STOCK_HISTORY_IMMUTABLE'; END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_immutable() FROM PUBLIC,anon,authenticated,service_role;
DO $triggers$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_baselines','stock_history_openings','stock_history_movements'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||name)::regclass AND tgname=name||'_immutable') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name||'_immutable',name);
  END IF;
 END LOOP;
END $triggers$;
ALTER TABLE public.stock_history_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_history_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_history_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_history_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_history_heads,public.stock_history_baselines,public.stock_history_openings,public.stock_history_movements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.stock_history_heads,public.stock_history_baselines,public.stock_history_openings,public.stock_history_movements TO service_role;

-- The web/phone relay verifies the credential before passing its actual user_id.
-- Recheck current database authority here; an activation by itself is not staff.
CREATE OR REPLACE FUNCTION private.stock_history_authorize_read(p_actor text,p_terminal text,p_branch text,p_export boolean)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE person public.app_users%ROWTYPE;device public.terminal_tokens%ROWTYPE;owner boolean;supervisor boolean;flag text;
BEGIN
 SELECT * INTO person FROM public.app_users WHERE user_id=p_actor AND is_active IS TRUE FOR SHARE;
 IF NOT FOUND OR NULLIF(btrim(p_branch),'') IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
 owner:=COALESCE(person.role::text='admin' OR person.role_slug='admin',false);
 supervisor:=owner OR COALESCE(person.role::text='manager' OR person.role_slug='supervisor',false);
 IF NOT owner AND (person.permissions->'can_view_inventory' IS DISTINCT FROM 'true'::jsonb OR person.permissions->'page:inventory'='false'::jsonb) THEN
  RAISE EXCEPTION 'STOCK_HISTORY_PERMISSION_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_export AND NOT owner AND (person.permissions->'can_export_reports' IS DISTINCT FROM 'true'::jsonb OR person.permissions->'page:reports'='false'::jsonb) THEN
  RAISE EXCEPTION 'STOCK_HISTORY_EXPORT_DENIED' USING ERRCODE='42501';
 END IF;
 IF NULLIF(person.store_id,'') IS NOT NULL AND person.store_id IS DISTINCT FROM p_branch THEN
  RAISE EXCEPTION 'STOCK_HISTORY_BRANCH_DENIED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_branch) THEN RAISE EXCEPTION 'STOCK_HISTORY_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
 IF p_terminal IS NULL THEN
  IF NOT supervisor AND person.store_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'STOCK_HISTORY_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 SELECT * INTO device FROM public.terminal_tokens WHERE id::text=p_terminal AND status IN('active','used') AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_TERMINAL_DENIED' USING ERRCODE='42501'; END IF;
 IF device.location_id IS NOT NULL THEN
  PERFORM public.pos_sync_validate_read_scope('default',p_branch,p_terminal);
  IF device.location_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'STOCK_HISTORY_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 IF device.platform='pc' THEN PERFORM public.pos_sync_validate_read_scope('default',p_branch,p_terminal); END IF;
 flag:=CASE WHEN device.platform='mobile' THEN 'can_use_management_mobile' ELSE 'can_use_management_pc' END;
 IF NOT owner AND (CASE WHEN person.permissions ? flag THEN person.permissions->flag IS DISTINCT FROM 'true'::jsonb ELSE NOT supervisor END) THEN
  RAISE EXCEPTION 'STOCK_HISTORY_MANAGEMENT_DENIED' USING ERRCODE='42501';
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_authorize_read(text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pos_stock_history_page(p_actor text,p_terminal text,p_branch text,p_cutoff text,p_zone text,
 p_after uuid,p_limit integer,p_source_revision text,p_export boolean,p_closed_shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE h public.stock_history_heads%ROWTYPE;b public.stock_history_baselines%ROWTYPE;
 cutoff numeric;read_raw text;revision text;reasons jsonb:='[]'::jsonb;actual_pairs bigint;page jsonb;next_id uuid;
 candidate record;wire jsonb;page_rows jsonb[]:=ARRAY[]::jsonb[];page_bytes integer:=2;last_id uuid;balance numeric;
BEGIN
 PERFORM private.stock_history_authorize_read(p_actor,p_terminal,p_branch,COALESCE(p_export,false));
 IF p_limit NOT BETWEEN 1 AND 500 OR p_limit IS NULL OR p_zone IS NULL OR length(p_zone) NOT BETWEEN 1 AND 100
  OR length(COALESCE(p_source_revision,''))>512 THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_REQUEST'; END IF;
 IF p_closed_shift IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.app_users person WHERE person.user_id=p_actor AND person.is_active IS TRUE AND
   (COALESCE(person.role::text='admin' OR person.role_slug='admin',false) OR
    (person.permissions->'can_shift_closing_history_view'='true'::jsonb AND person.permissions->'page:shifts' IS DISTINCT FROM 'false'::jsonb)))
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SHIFT_PERMISSION_DENIED' USING ERRCODE='42501';END IF;
  SELECT to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z' INTO p_cutoff FROM public.shifts
   WHERE id=p_closed_shift AND store_id=p_branch AND closed_at IS NOT NULL AND lower(status) IN('closed','completed') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_SHIFT_UNAVAILABLE'; END IF;
 END IF;
 cutoff:=private.stock_history_ticks(p_cutoff);
 read_raw:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
 IF cutoff>private.stock_history_ticks(read_raw) THEN reasons:=reasons||'"FUTURE_CUTOFF"'::jsonb; END IF;
 SELECT * INTO h FROM public.stock_history_heads WHERE store_id=p_branch FOR SHARE;
 IF NOT FOUND OR h.baseline_id IS NULL THEN
  RETURN jsonb_build_object('status','incomplete','reasons',reasons||'"NO_VERIFIED_OPENING"'::jsonb,
   'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,'rows','[]'::jsonb,'next',NULL,'restatable',true);
 END IF;
 SELECT * INTO b FROM public.stock_history_baselines WHERE id=h.baseline_id AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_OPENING'; END IF;
 SELECT count(*) INTO actual_pairs FROM public.stock_history_openings WHERE baseline_id=b.id AND store_id=p_branch;
 IF b.verification_state<>'verified' OR b.expected_pairs<>actual_pairs THEN reasons:=reasons||'"UNVERIFIED_OPENING"'::jsonb; END IF;
 IF cutoff<b.cutoff_ticks THEN reasons:=reasons||'"BEFORE_BASELINE"'::jsonb; END IF;
 IF h.coverage_state<>'complete' OR h.coverage_from_ticks IS NULL OR h.coverage_through_ticks IS NULL
  OR h.coverage_from_ticks>b.cutoff_ticks OR h.coverage_through_ticks<cutoff THEN reasons:=reasons||'"INCOMPLETE_MOVEMENTS"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements WHERE store_id=p_branch AND effective_ticks<=b.cutoff_ticks
  AND ingested_cursor>b.source_cursor AND ingested_cursor<=h.committed_cursor) THEN reasons:=reasons||'"BASELINE_PREHISTORY_CHANGED"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements WHERE store_id=p_branch AND effective_ticks>b.cutoff_ticks
  AND effective_ticks<=cutoff AND ingested_cursor<=h.committed_cursor AND clock_state<>'verified') THEN reasons:=reasons||'"CLOCK_UNVERIFIED"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements m WHERE m.store_id=p_branch AND m.effective_ticks<=cutoff AND m.ingested_cursor<=h.committed_cursor
  AND NOT EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch AND o.product_id=m.product_id)) THEN reasons:=reasons||'"MISSING_OPENING"'::jsonb; END IF;
 revision:='stock-history.v1:'||p_branch||':'||h.committed_cursor||':'||h.coverage_generation||':'||b.id;
 IF p_source_revision IS NOT NULL AND p_source_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED'; END IF;
 IF jsonb_array_length(reasons)>0 THEN
  RETURN jsonb_build_object('status',CASE WHEN reasons ? 'BEFORE_BASELINE' OR reasons ? 'FUTURE_CUTOFF' THEN 'unsupported' ELSE 'incomplete' END,
   'reasons',reasons,'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,'baselineAt',b.cutoff_at_raw,'readAt',read_raw,
   'coverageThroughTicks',h.coverage_through_ticks::text,'sourceRevision',revision,'pendingCount','0','rows','[]'::jsonb,'next',NULL,'restatable',true);
 END IF;
 -- Build one immutable keyset page, stopping before its byte budget. A large
 -- product is never skipped or truncated; an oversized first row fails clearly.
 FOR candidate IN SELECT o.* FROM public.stock_history_openings o WHERE o.store_id=p_branch AND o.baseline_id=b.id
  AND (p_after IS NULL OR o.product_id>p_after) ORDER BY o.product_id LIMIT p_limit+1 LOOP
  IF cardinality(page_rows)>=p_limit THEN next_id:=last_id;EXIT;END IF;
  SELECT candidate.quantity+COALESCE(sum(m.quantity_delta),0) INTO balance FROM public.stock_history_movements m
   WHERE m.store_id=p_branch AND m.product_id=candidate.product_id AND m.effective_ticks>b.cutoff_ticks
    AND m.effective_ticks<=cutoff AND m.ingested_cursor<=h.committed_cursor;
  wire:=jsonb_build_object('productId',candidate.product_id,'locationId',p_branch,'name',candidate.product_name,
   'sku',candidate.sku,'barcode',candidate.barcode,'quantity',balance::text,'negative',balance<0);
  IF page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1>245760 THEN
   IF cardinality(page_rows)=0 THEN RAISE EXCEPTION 'STOCK_HISTORY_ROW_OVERSIZED';END IF;
   next_id:=last_id;EXIT;
  END IF;
  page_bytes:=page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1;
  page_rows:=array_append(page_rows,wire);last_id:=candidate.product_id;
 END LOOP;
 page:=to_jsonb(page_rows);
 RETURN jsonb_build_object('status','complete','reasons','[]'::jsonb,'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,
  'baselineAt',b.cutoff_at_raw,'readAt',read_raw,'sourceRevision',revision,'pendingCount','0','restatable',true,'rows',page,'next',next_id);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid) TO service_role;
COMMIT;
