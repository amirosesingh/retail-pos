-- Isolated branch stock projection. Install with the extended grouped gateway
-- and paged recovery. The canonical product writer still owns stock arithmetic.
CREATE TABLE pos_sync_feed_v1.stock_pilots (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  armed_after bigint NOT NULL CHECK (armed_after >= 0),
  PRIMARY KEY (organization_id, scope_id, epoch),
  FOREIGN KEY (organization_id, scope_id, epoch)
    REFERENCES pos_sync_feed_v1.cash_settings_pilots (organization_id, scope_id, epoch)
);

CREATE TABLE pos_sync_feed_v1.stock_revision_coverage (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  product_id uuid NOT NULL,
  product_version integer NOT NULL CHECK (product_version > 0),
  seq bigint NOT NULL,
  PRIMARY KEY (organization_id, scope_id, epoch, product_id, product_version),
  FOREIGN KEY (organization_id, scope_id, epoch, seq)
    REFERENCES pos_sync_feed_v1.feed_groups (organization_id, scope_id, epoch, seq) ON DELETE CASCADE
);
CREATE INDEX stock_revision_coverage_feed ON pos_sync_feed_v1.stock_revision_coverage
  (organization_id, scope_id, epoch, seq);
-- Retirement remains recoverable after live groups expire. A later return
-- of the same product to the same branch replaces the retired projection.
CREATE TABLE pos_sync_feed_v1.stock_retirements (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  product_id uuid NOT NULL,
  product_version integer NOT NULL CHECK (product_version > 0),
  seq bigint NOT NULL CHECK (seq > 0),
  PRIMARY KEY (organization_id, scope_id, epoch, product_id),
  FOREIGN KEY (organization_id, scope_id, epoch) REFERENCES pos_sync_feed_v1.stock_pilots
);
CREATE INDEX stock_retirements_product_version ON pos_sync_feed_v1.stock_retirements
  (organization_id, product_id, product_version);
-- Transaction-only staging. The deferred trigger consumes every row before
-- commit and has access to the first old owner and the final product state.
CREATE TABLE pos_sync_feed_v1.stock_transaction_writes (
  transaction_id xid8 NOT NULL,
  product_id uuid NOT NULL,
  previous_owner text COLLATE "C",
  previous_balance jsonb,
  previous_version integer,
  PRIMARY KEY (transaction_id, product_id)
);
ALTER TABLE pos_sync_feed_v1.stock_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.stock_revision_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.stock_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.stock_transaction_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_sync_feed_v1.stock_pilots, pos_sync_feed_v1.stock_revision_coverage,
  pos_sync_feed_v1.stock_retirements, pos_sync_feed_v1.stock_transaction_writes
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE pos_sync_feed_v1.cash_publications ADD COLUMN stock_after jsonb;

CREATE FUNCTION pos_sync_feed_v1.arm_cash_stock_scope(p_org text, p_branch text, p_epoch uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $arm$
DECLARE
  v_seq bigint;
BEGIN
  SELECT head.head_seq INTO v_seq FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.cash_settings_pilots USING (organization_id, scope_id, epoch)
  WHERE (head.organization_id, head.scope_id, head.epoch) = (p_org, p_branch, p_epoch)
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_BASELINE_UNVERIFIED';
  END IF;
  -- Touch the locked head so an older repeatable-read writer cannot observe
  -- an unchanged head but miss this new enrollment in its prior snapshot.
  UPDATE pos_sync_feed_v1.feed_heads SET head_seq=head_seq
  WHERE (organization_id, scope_id, epoch)=(p_org, p_branch, p_epoch);
  INSERT INTO pos_sync_feed_v1.stock_pilots VALUES (p_org, p_branch, p_epoch, v_seq);
  -- An already-open recovery export predates this newly owned projection.
  DELETE FROM pos_sync_feed_v1.snapshot_pins AS pin
  USING pos_sync_feed_v1.cash_settings_recovery_exports AS export
  WHERE (pin.organization_id, pin.scope_id, pin.pin_id) = (export.organization_id, export.scope_id, export.pin_id)
    AND (pin.organization_id, pin.scope_id) = (p_org, p_branch);
END;
$arm$;

CREATE FUNCTION pos_sync_feed_v1.live_stock_row(p_id uuid, p_stock jsonb, p_branch text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $stock$
DECLARE
  v_balance text := coalesce(p_stock->>p_branch, '0');
BEGIN
  IF p_id IS NULL OR p_version IS NULL OR p_version < 1 OR jsonb_typeof(p_stock) IS DISTINCT FROM 'object'
     OR (p_stock ? p_branch AND jsonb_typeof(p_stock->p_branch) IS DISTINCT FROM 'number')
     OR v_balance !~ '^-?(0|[1-9][0-9]{0,9})$' OR v_balance::bigint NOT BETWEEN -2147483648 AND 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_INVALID_BALANCE';
  END IF;
  RETURN jsonb_build_object('product_id', p_id, 'branch_balance', v_balance::integer, 'row_version', p_version);
END;
$stock$;

CREATE FUNCTION pos_sync_feed_v1.is_live_stock_projection(p_changes jsonb, p_branch text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
RETURN coalesce(p_branch <> '' AND jsonb_array_length(p_changes) = 1
  AND (p_changes->0) - ARRAY['table_name','entity_id','row_version','tombstone','row_data'] = '{}'::jsonb
  AND p_changes->0->>'table_name' = 'products_stock'
  AND jsonb_typeof(p_changes->0->'entity_id') = 'string'
  AND p_changes->0->>'entity_id' = jsonb_build_object('id', p_changes->0->'row_data'->>'product_id')::text
  AND p_changes->0->'row_data'->>'product_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND (CASE p_changes->0->'tombstone'
    WHEN 'true'::jsonb THEN (p_changes->0->'row_data') - ARRAY['product_id','row_version'] = '{}'::jsonb
    WHEN 'false'::jsonb THEN (p_changes->0->'row_data') - ARRAY['product_id','branch_balance','row_version'] = '{}'::jsonb
      AND jsonb_typeof(p_changes->0->'row_data'->'branch_balance') = 'number'
      AND p_changes->0->'row_data'->>'branch_balance' ~ '^-?(0|[1-9][0-9]{0,9})$'
      AND (p_changes->0->'row_data'->>'branch_balance')::numeric BETWEEN -2147483648 AND 2147483647
    ELSE false END)
  AND jsonb_typeof(p_changes->0->'row_data'->'row_version') = 'number'
  AND p_changes->0->'row_data'->>'row_version' ~ '^[1-9][0-9]{0,9}$'
  AND (p_changes->0->'row_data'->>'row_version')::numeric <= 2147483647
  AND jsonb_typeof(p_changes->0->'row_version') = 'string'
  AND p_changes->0->>'row_version' = p_changes->0->'row_data'->>'row_version', false);

-- A cash/refund publisher may claim only the exact committed product revision
-- in its own already-appended group. The deferred product writer sees it.
CREATE FUNCTION pos_sync_feed_v1.cover_stock_revision(
  p_org text, p_branch text, p_epoch uuid, p_seq bigint, p_product uuid, p_balance integer, p_version integer
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $cover$
DECLARE
  v_stock jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_sync_feed_v1.stock_pilots AS pilot
    WHERE (pilot.organization_id, pilot.scope_id, pilot.epoch) = (p_org, p_branch, p_epoch)
      AND p_seq > pilot.armed_after)
    OR pos_sync_feed_v1.extended_scope_epoch(p_org, p_branch) IS DISTINCT FROM p_epoch THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_SCOPE_UNVERIFIED';
  END IF;
  SELECT pos_sync_feed_v1.live_stock_row(p.id, p.stock_by_store, p_branch, p.row_version)
  INTO v_stock FROM public.products AS p WHERE p.id = p_product AND p.owner_store_id = p_branch;
  IF NOT FOUND OR (v_stock->>'branch_balance')::integer IS DISTINCT FROM p_balance
     OR (v_stock->>'row_version')::integer IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_REVISION_UNVERIFIED';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_sync_feed_v1.stock_retirements AS retired
    WHERE retired.organization_id=p_org AND retired.product_id=p_product
      AND (retired.product_version>p_version OR
        (retired.scope_id=p_branch AND retired.product_version=p_version))) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_REVISION_UNVERIFIED';
  END IF;
  INSERT INTO pos_sync_feed_v1.stock_revision_coverage VALUES (p_org, p_branch, p_epoch, p_product, p_version, p_seq);
  DELETE FROM pos_sync_feed_v1.stock_retirements AS retired
  WHERE (retired.organization_id, retired.scope_id, retired.epoch, retired.product_id) =
    (p_org, p_branch, p_epoch, p_product) AND retired.product_version < p_version;
END;
$cover$;

CREATE FUNCTION pos_sync_feed_v1.capture_cash_stock_after()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $cash$
DECLARE
  v_product uuid := (NEW.changes->1->'row_data'->>'product_id')::uuid;
  v_movement uuid := (NEW.changes->3->'row_data'->>'id')::uuid;
BEGIN
  IF pos_sync_feed_v1.extended_scope_epoch(NEW.organization_id, NEW.scope_id) IS DISTINCT FROM NEW.epoch
     OR NOT EXISTS (SELECT 1 FROM pos_sync_feed_v1.stock_pilots AS pilot
       WHERE (pilot.organization_id, pilot.scope_id, pilot.epoch) = (NEW.organization_id, NEW.scope_id, NEW.epoch)
         AND NEW.seq > pilot.armed_after) THEN RETURN NEW; END IF;
  SELECT pos_sync_feed_v1.live_stock_row(product.id, product.stock_by_store, NEW.scope_id, product.row_version)
  INTO NEW.stock_after FROM public.products AS product
  JOIN public.stock_delta_applied AS delta ON delta.product_id = product.id AND delta.store_id = NEW.scope_id
  WHERE product.id = v_product AND product.owner_store_id = NEW.scope_id AND delta.movement_id = v_movement
    AND delta.delta::text = NEW.changes->3->'row_data'->>'quantity_delta';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_LIVE_STOCK_V1_CASH_MOVEMENT_UNVERIFIED';
  END IF;
  PERFORM pos_sync_feed_v1.cover_stock_revision(NEW.organization_id, NEW.scope_id, NEW.epoch, NEW.seq,
    v_product, (NEW.stock_after->>'branch_balance')::integer, (NEW.stock_after->>'row_version')::integer);
  RETURN NEW;
END;
$cash$;
CREATE TRIGGER pos_sync_capture_cash_stock_after BEFORE INSERT ON pos_sync_feed_v1.cash_publications
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.capture_cash_stock_after();

CREATE FUNCTION pos_sync_feed_v1.stage_product_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $stage$
BEGIN
  INSERT INTO pos_sync_feed_v1.stock_transaction_writes
  VALUES (pg_current_xact_id(), coalesce(NEW.id, OLD.id), OLD.owner_store_id,
    OLD.stock_by_store->OLD.owner_store_id, OLD.row_version)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$stage$;

-- Acquire all involved scope heads in one consistent order after ordinary
-- product DML. A move publishes the old owner's retirement and the new
-- owner's balance together, without sharing one branch's data with the other.
CREATE FUNCTION pos_sync_feed_v1.publish_product_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $publish$
DECLARE
  v_product public.products%ROWTYPE;
  v_epoch uuid;
  v_row jsonb;
  v_change jsonb;
  v_seq bigint;
  v_retired_version integer;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id;
  PERFORM head.scope_id FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id='default' AND head.scope_id IN (
    SELECT saved.previous_owner FROM pos_sync_feed_v1.stock_transaction_writes AS saved WHERE saved.transaction_id=NEW.transaction_id
    UNION SELECT product.owner_store_id FROM pos_sync_feed_v1.stock_transaction_writes AS saved
      JOIN public.products AS product ON product.id=saved.product_id WHERE saved.transaction_id=NEW.transaction_id
  )
  ORDER BY head.scope_id FOR NO KEY UPDATE OF head;
  DELETE FROM pos_sync_feed_v1.stock_transaction_writes
  WHERE transaction_id=NEW.transaction_id AND product_id=NEW.product_id;

  IF NEW.previous_owner IS NOT NULL AND NEW.previous_owner IS DISTINCT FROM v_product.owner_store_id THEN
    v_epoch := pos_sync_feed_v1.extended_scope_epoch('default', NEW.previous_owner);
    IF v_epoch IS NOT NULL THEN
      v_retired_version := coalesce(v_product.row_version, NEW.previous_version + 1);
      IF v_retired_version IS NULL OR v_retired_version <= NEW.previous_version THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_LIVE_STOCK_V1_RETIREMENT_UNVERIFIED';
      END IF;
      v_change := jsonb_build_array(jsonb_build_object('table_name','products_stock',
        'entity_id',jsonb_build_object('id',NEW.product_id)::text,'row_version',v_retired_version::text,'tombstone',true,
        'row_data',jsonb_build_object('product_id',NEW.product_id,'row_version',v_retired_version)));
      v_seq := pos_sync_feed_v1.append_extended_group('default', NEW.previous_owner, v_epoch, NULL, v_change, '{"stock":true}'::jsonb);
      INSERT INTO pos_sync_feed_v1.stock_retirements VALUES
        ('default', NEW.previous_owner, v_epoch, NEW.product_id, v_retired_version, v_seq)
      ON CONFLICT (organization_id, scope_id, epoch, product_id) DO UPDATE
        SET product_version=EXCLUDED.product_version,seq=EXCLUDED.seq
        WHERE stock_retirements.product_version<EXCLUDED.product_version;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_LIVE_STOCK_V1_RETIREMENT_UNVERIFIED'; END IF;
    END IF;
  END IF;

  IF v_product.owner_store_id IS NULL OR
     (NEW.previous_owner IS NOT DISTINCT FROM v_product.owner_store_id AND
      NEW.previous_balance IS NOT DISTINCT FROM v_product.stock_by_store->v_product.owner_store_id)
  THEN RETURN NULL; END IF;
  v_epoch := pos_sync_feed_v1.extended_scope_epoch('default', v_product.owner_store_id);
  IF v_epoch IS NULL
     OR NOT EXISTS (SELECT 1 FROM pos_sync_feed_v1.stock_pilots AS pilot
       WHERE (pilot.organization_id, pilot.scope_id, pilot.epoch) = ('default', v_product.owner_store_id, v_epoch))
     OR EXISTS (SELECT 1 FROM pos_sync_feed_v1.stock_revision_coverage AS covered
       WHERE (covered.organization_id, covered.scope_id, covered.epoch, covered.product_id, covered.product_version) =
         ('default', v_product.owner_store_id, v_epoch, v_product.id, v_product.row_version)) THEN RETURN NULL; END IF;
  v_row := pos_sync_feed_v1.live_stock_row(v_product.id, v_product.stock_by_store,
    v_product.owner_store_id, v_product.row_version);
  v_change := jsonb_build_array(jsonb_build_object('table_name','products_stock',
    'entity_id', jsonb_build_object('id', v_product.id)::text, 'row_version', v_product.row_version::text,
    'tombstone', false, 'row_data', v_row));
  v_seq := pos_sync_feed_v1.append_extended_group('default', v_product.owner_store_id, v_epoch, NULL,
    v_change, '{"stock":true}'::jsonb);
  PERFORM pos_sync_feed_v1.cover_stock_revision('default', v_product.owner_store_id, v_epoch, v_seq,
    v_product.id, (v_row->>'branch_balance')::integer, v_product.row_version);
  RETURN NULL;
END;
$publish$;
CREATE TRIGGER pos_sync_stage_product_stock_insert_delete AFTER INSERT OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.stage_product_stock();
CREATE TRIGGER pos_sync_stage_product_stock_update AFTER UPDATE ON public.products FOR EACH ROW
WHEN (OLD.owner_store_id IS DISTINCT FROM NEW.owner_store_id OR OLD.stock_by_store IS DISTINCT FROM NEW.stock_by_store)
EXECUTE FUNCTION pos_sync_feed_v1.stage_product_stock();
CREATE CONSTRAINT TRIGGER pos_sync_publish_product_stock AFTER INSERT ON pos_sync_feed_v1.stock_transaction_writes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_product_stock();

REVOKE ALL ON FUNCTION pos_sync_feed_v1.arm_cash_stock_scope(text,text,uuid),
  pos_sync_feed_v1.live_stock_row(uuid,jsonb,text,integer), pos_sync_feed_v1.is_live_stock_projection(jsonb,text),
  pos_sync_feed_v1.cover_stock_revision(text,text,uuid,bigint,uuid,integer,integer),
  pos_sync_feed_v1.capture_cash_stock_after(), pos_sync_feed_v1.stage_product_stock(), pos_sync_feed_v1.publish_product_stock()
  FROM PUBLIC, anon, authenticated, service_role;
