-- STOCK401 DRAFT preparation only. Not canonical, applied or activated.
-- Records actual committed effects; it does not certify original author/time,
-- create a historical baseline or grant a generic history/stock writer.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.stock_history_heads') IS NULL OR to_regclass('public.products') IS NULL
  OR to_regclass('public.stock_delta_applied') IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_CAPTURE_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_accepted_effects') IS NOT NULL
  OR to_regclass('private.stock_history_source_receipts') IS NOT NULL
  OR to_regclass('private.stock_history_effect_sources') IS NOT NULL
  OR to_regclass('private.stock_history_capture_gaps') IS NOT NULL
  OR to_regclass('private.stock_history_effect_coverage') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('stock_history_accepted_products','stock_history_source_receipts'))
  THEN RAISE EXCEPTION 'STOCK_HISTORY_CAPTURE_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;

CREATE TABLE private.stock_history_accepted_effects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id bigint NOT NULL,
 product_id uuid NOT NULL,store_id text NOT NULL,
 previous_quantity numeric(38,0) NOT NULL,next_quantity numeric(38,0) NOT NULL,
 quantity_delta numeric(39,0) NOT NULL,
 operation text NOT NULL CHECK(operation IN('INSERT','UPDATE','DELETE')),
 product_snapshot jsonb NOT NULL CHECK(jsonb_typeof(product_snapshot)='object'),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 -- An accepted write proves its quantity, not the offline author's clock.
 timing_state text NOT NULL DEFAULT 'unverified' CHECK(timing_state='unverified'),
 CHECK(quantity_delta=next_quantity-previous_quantity),
 CHECK(operation<>'UPDATE' OR quantity_delta<>0),CHECK(length(store_id) BETWEEN 1 AND 128)
);
CREATE INDEX stock_history_effect_source_match ON private.stock_history_accepted_effects(transaction_id,product_id,store_id);
CREATE INDEX stock_history_effect_branch ON private.stock_history_accepted_effects(store_id,id);
CREATE TABLE private.stock_history_source_receipts(
 movement_id uuid PRIMARY KEY,transaction_id bigint NOT NULL,product_id uuid NOT NULL,store_id text NOT NULL,
 quantity_delta numeric(38,0) NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX stock_history_receipt_effect_match ON private.stock_history_source_receipts(transaction_id,product_id,store_id,quantity_delta);
CREATE TABLE private.stock_history_effect_sources(
 effect_id uuid PRIMARY KEY REFERENCES private.stock_history_accepted_effects(id),
 movement_id uuid NOT NULL UNIQUE REFERENCES private.stock_history_source_receipts(movement_id)
);
CREATE TABLE private.stock_history_capture_gaps(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id bigint NOT NULL,
 product_id uuid NOT NULL,store_id text,operation text NOT NULL,reason text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX stock_history_gap_branch ON private.stock_history_capture_gaps(store_id,id);
-- Future admission/baseline routines must prove each association atomically.
-- No API role can populate this table and this draft creates no coverage rows.
CREATE TABLE private.stock_history_effect_coverage(
 effect_id uuid PRIMARY KEY REFERENCES private.stock_history_accepted_effects(id),
 movement_id uuid REFERENCES public.stock_history_movements(id),
 baseline_id uuid REFERENCES public.stock_history_baselines(id),
 CHECK((movement_id IS NOT NULL)::integer+(baseline_id IS NOT NULL)::integer=1)
);
DO $protect$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_accepted_effects','stock_history_source_receipts','stock_history_effect_sources','stock_history_capture_gaps','stock_history_effect_coverage'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()',name||'_immutable',name);
 END LOOP;
END $protect$;

CREATE FUNCTION private.stock_history_capture_gap(p_product uuid,p_branch text,p_operation text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 INSERT INTO private.stock_history_capture_gaps(transaction_id,product_id,store_id,operation,reason)
 VALUES(txid_current(),p_product,p_branch,p_operation,p_reason);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_gap(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- A receipt is merely a candidate. It is linked only after an actual matching
-- product effect occurs in the same transaction, and never reused.
CREATE FUNCTION private.stock_history_capture_source_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 INSERT INTO private.stock_history_source_receipts(movement_id,transaction_id,product_id,store_id,quantity_delta)
 VALUES(NEW.movement_id,txid_current(),NEW.product_id,NEW.store_id,COALESCE(NEW.delta,0)) ON CONFLICT(movement_id) DO NOTHING;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_source_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_source_receipts AFTER INSERT ON public.stock_delta_applied
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_capture_source_receipt();

CREATE FUNCTION private.stock_history_capture_accepted_products() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE before_map jsonb:='{}'::jsonb;after_map jsonb:='{}'::jsonb;item jsonb;branch text;
 before_text text;after_text text;previous numeric;next_value numeric;delta numeric;effect uuid;source uuid;matches integer;
BEGIN
 IF TG_OP<>'INSERT' THEN before_map:=COALESCE(OLD.stock_by_store,'{}'::jsonb);END IF;
 IF TG_OP<>'DELETE' THEN after_map:=COALESCE(NEW.stock_by_store,'{}'::jsonb);item:=to_jsonb(NEW);
 ELSE item:=to_jsonb(OLD);END IF;
 IF TG_OP='UPDATE' AND before_map=after_map THEN RETURN NULL;END IF;
 IF jsonb_typeof(before_map)<>'object' OR jsonb_typeof(after_map)<>'object' THEN
  PERFORM private.stock_history_capture_gap((item->>'id')::uuid,NULL,TG_OP,'UNVERIFIED_STOCK_SHAPE');RETURN NULL;
 END IF;
 IF (SELECT count(*) FROM (SELECT 1 FROM jsonb_object_keys(before_map||after_map) LIMIT 2001) bounded)>2000 THEN
  PERFORM private.stock_history_capture_gap((item->>'id')::uuid,NULL,TG_OP,'UNVERIFIED_STOCK_SHAPE');RETURN NULL;
 END IF;
 IF TG_OP IN('INSERT','DELETE') AND before_map||after_map='{}'::jsonb THEN
  -- No branch quantity/cohort can be inferred from owner or today's aggregate.
  PERFORM private.stock_history_capture_gap((item->>'id')::uuid,NULL,TG_OP,'MISSING_SCOPED_COHORT');RETURN NULL;
 END IF;
 FOR branch IN SELECT jsonb_object_keys(before_map||after_map) ORDER BY 1 LOOP
  IF length(branch) NOT BETWEEN 1 AND 128 OR btrim(branch)<>branch THEN
   PERFORM private.stock_history_capture_gap((item->>'id')::uuid,NULL,TG_OP,'UNVERIFIED_BRANCH_KEY');CONTINUE;
  END IF;
  before_text:=COALESCE(before_map->>branch,'0');after_text:=COALESCE(after_map->>branch,'0');
  IF before_text!~'^-?(0|[1-9][0-9]{0,37})$' OR after_text!~'^-?(0|[1-9][0-9]{0,37})$'
   OR (before_map ? branch AND jsonb_typeof(before_map->branch) NOT IN('number','string'))
   OR (after_map ? branch AND jsonb_typeof(after_map->branch) NOT IN('number','string')) THEN
   PERFORM private.stock_history_capture_gap((item->>'id')::uuid,branch,TG_OP,'UNVERIFIED_STOCK_QUANTITY');CONTINUE;
  END IF;
  previous:=before_text::numeric;next_value:=after_text::numeric;delta:=next_value-previous;
  IF TG_OP='UPDATE' AND delta=0 THEN CONTINUE;END IF;
  INSERT INTO private.stock_history_accepted_effects(transaction_id,product_id,store_id,previous_quantity,next_quantity,quantity_delta,operation,product_snapshot)
   VALUES(txid_current(),(item->>'id')::uuid,branch,previous,next_value,delta,TG_OP,
    jsonb_build_object('name',item->'name','sku',item->'sku','barcode',item->'barcode','ownerStoreId',item->'owner_store_id')) RETURNING id INTO effect;
  -- Two indistinguishable pending receipts are ambiguous; preserve both rather
  -- than pick one by timestamp/UUID and invent a source association.
  SELECT count(*),(array_agg(r.movement_id))[1] INTO matches,source FROM(
   SELECT candidate.movement_id FROM private.stock_history_source_receipts candidate
    WHERE candidate.transaction_id=txid_current() AND candidate.product_id=(item->>'id')::uuid
     AND candidate.store_id=branch AND candidate.quantity_delta=delta
     AND NOT EXISTS(SELECT 1 FROM private.stock_history_effect_sources used WHERE used.movement_id=candidate.movement_id) LIMIT 2) r;
  IF matches=1 AND delta<>0 THEN INSERT INTO private.stock_history_effect_sources VALUES(effect,source);END IF;
 END LOOP;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_accepted_products() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_accepted_products AFTER INSERT OR UPDATE OR DELETE ON public.products
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_capture_accepted_products();

-- Read-only candidate proof for the future guarded claim writer. It is neither
-- upload admission nor an acknowledgement and is deliberately granted to no API
-- role. Author/time/action checks and exclusive effect consumption remain needed.
CREATE FUNCTION private.stock_history_match_effect_candidates(p_product uuid,p_branch text,p_quantity numeric,p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE ref jsonb;source uuid;effect record;ids uuid[]:=ARRAY[]::uuid[];seen text[]:=ARRAY[]::text[];
 source_key text;groups jsonb:='{}'::jsonb;total numeric:=0;accepted timestamptz;
BEGIN
 IF p_product IS NULL OR p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128
  OR p_quantity IS NULL OR p_quantity=0 OR p_quantity<>trunc(p_quantity)
  OR jsonb_typeof(p_refs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_SOURCE';END IF;
 IF jsonb_array_length(p_refs) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_NOT_ACCEPTED';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(ref) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_SOURCE';END IF;
  IF jsonb_array_length(ref)<>3 OR jsonb_typeof(ref->0) IS DISTINCT FROM 'string' OR jsonb_typeof(ref->1) IS DISTINCT FROM 'string'
   OR jsonb_typeof(ref->2) IS DISTINCT FROM 'string' OR ref->>0 NOT IN('item_activity_logs','stock_delta_applied')
   OR ref->>1!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR ref->>2!~'^-?(0|[1-9][0-9]{0,37})$'
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_NOT_ACCEPTED';END IF;
  source:=(ref->>1)::uuid;source_key:=(ref->>0)||':'||source;
  IF source_key=ANY(seen) THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_SOURCE';END IF;seen:=array_append(seen,source_key);
  SELECT actual.* INTO effect FROM private.stock_history_source_receipts receipt
   JOIN private.stock_history_effect_sources link ON link.movement_id=receipt.movement_id
   JOIN private.stock_history_accepted_effects actual ON actual.id=link.effect_id
   WHERE receipt.movement_id=source AND receipt.product_id=p_product AND receipt.store_id=p_branch AND receipt.quantity_delta=(ref->>2)::numeric
    AND actual.product_id=p_product AND actual.store_id=p_branch AND actual.quantity_delta=receipt.quantity_delta;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_NOT_ACCEPTED';END IF;
  IF ref->>0='item_activity_logs' THEN
   IF NOT EXISTS(SELECT 1 FROM public.item_activity_logs activity WHERE activity.id=source AND activity.product_id=p_product
    AND activity.store_id=p_branch AND activity.quantity_delta=(ref->>2)::numeric) THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_NOT_ACCEPTED';END IF;
  END IF;
  groups:=jsonb_set(groups,ARRAY[ref->>0],to_jsonb(COALESCE((groups->>(ref->>0))::numeric,0)+(ref->>2)::numeric));
  IF NOT effect.id=ANY(ids) THEN ids:=array_append(ids,effect.id);total:=total+effect.quantity_delta;END IF;
  IF accepted IS NULL OR accepted<effect.accepted_at THEN accepted:=effect.accepted_at;END IF;
 END LOOP;
 IF total<>p_quantity OR EXISTS(SELECT 1 FROM jsonb_each_text(groups) entry WHERE entry.value::numeric<>p_quantity)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_NOT_ACCEPTED';END IF;
 RETURN jsonb_build_object('effectIds',to_jsonb(ARRAY(SELECT id FROM unnest(ids) id ORDER BY id)),
  'quantity',total::text,'acceptedAt',to_char(accepted AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z','timingState','unverified');
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_match_effect_candidates(uuid,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Append-only status avoids a shared report-head lock after business product
-- locks. The reader checks this revision twice; it never certifies unlinked
-- effects/gaps as complete just because its older head was previously complete.
CREATE FUNCTION private.stock_history_capture_state(p_branch text,p_baseline uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH effects AS(SELECT e.id,c.effect_id FROM private.stock_history_accepted_effects e
  LEFT JOIN private.stock_history_effect_coverage c ON c.effect_id=e.id
   AND (c.movement_id IS NOT NULL OR c.baseline_id=p_baseline) WHERE e.store_id=p_branch),
 counts AS(SELECT count(*) total,count(effect_id) covered,count(*) FILTER(WHERE effect_id IS NULL) unvalidated FROM effects),
 gaps AS(SELECT count(*) total FROM private.stock_history_capture_gaps WHERE store_id=p_branch OR store_id IS NULL)
 SELECT jsonb_build_object('revision',counts.total::text||':'||counts.covered::text||':'||gaps.total::text,
  'unvalidatedEffects',counts.unvalidated::text,'captureGaps',gaps.total::text) FROM counts,gaps
 $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_state(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
