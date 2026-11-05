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
DO $protect$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['stock_history_accepted_effects','stock_history_source_receipts','stock_history_effect_sources','stock_history_capture_gaps'] LOOP
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
 UPDATE public.stock_history_heads SET coverage_state='incomplete',coverage_generation=coverage_generation+1,updated_at=clock_timestamp()
 WHERE p_branch IS NULL OR store_id=p_branch;
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
  -- Until the complete accepted-effect set is linked to validated ledger facts
  -- and cohort watermarks, an older head cannot claim it contains this write.
  UPDATE public.stock_history_heads SET coverage_state='incomplete',coverage_generation=coverage_generation+1,updated_at=clock_timestamp()
   WHERE store_id=branch;
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
COMMIT;
