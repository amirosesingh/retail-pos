-- Isolated preparation after the FIN62 live financial writers. The service
-- relay must verify the originating actor before calling this adapter.
BEGIN;

CREATE SCHEMA pos_sync_refund_v1;
REVOKE ALL ON SCHEMA pos_sync_refund_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE pos_sync_refund_v1.receipts (
  operation_id uuid PRIMARY KEY,
  sale_id uuid NOT NULL,
  branch_id text COLLATE "C" NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pos_sync_refund_v1.movement_aliases (
  movement_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES pos_sync_refund_v1.receipts(operation_id)
    DEFERRABLE INITIALLY DEFERRED,
  item_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id text COLLATE "C" NOT NULL,
  delta integer NOT NULL CHECK (delta > 0),
  canonical boolean NOT NULL,
  creator_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX refund_aliases_operation ON pos_sync_refund_v1.movement_aliases(operation_id);
ALTER TABLE pos_sync_refund_v1.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_refund_v1.movement_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA pos_sync_refund_v1 FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER refund_receipts_immutable BEFORE UPDATE OR DELETE ON pos_sync_refund_v1.receipts
FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();

CREATE FUNCTION pos_sync_refund_v1.native_id(p_json text)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $id$
  SELECT (substr(h,1,12) || '4' || substr(h,14,3) || '8' || substr(h,18,15))::uuid
  FROM (SELECT encode(sha256(convert_to(p_json,'UTF8')), 'hex') AS h) AS digest;
$id$;

-- ReceiptRepository uses stableUuid({ refundId, itemId }) and SQL Server
-- may return upper-case UUID text. Preserve the exact original refund key.
CREATE FUNCTION pos_sync_refund_v1.native_movement_id(p_refund text, p_item text)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $native$
  SELECT pos_sync_refund_v1.native_id('{"itemId":' || to_jsonb(p_item)::text ||
    ',"refundId":' || to_jsonb(p_refund)::text || '}');
$native$;

CREATE FUNCTION pos_sync_refund_v1.lock_movements(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $lock$
DECLARE v_id uuid;
BEGIN
  -- The guard reads alias ownership after waiting for the prior writer.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'POS_REFUND_V1_ISOLATION_UNSUPPORTED';
  END IF;
  FOR v_id IN SELECT DISTINCT id FROM unnest(p_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-refund-movement:' || v_id::text, 0));
  END LOOP;
END;
$lock$;

-- The existing refund writer updates line quantities before inserting stock.
-- Refuse an overlapping old route at its ledger insert so those earlier
-- changes roll back too. Only the matching authoritative transaction can
-- consume its one reserved canonical movement, even if its caller retries.
CREATE FUNCTION pos_sync_refund_v1.guard_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $guard$
DECLARE v_alias pos_sync_refund_v1.movement_aliases%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM pos_sync_refund_v1.lock_movements(CASE WHEN TG_OP = 'UPDATE'
      THEN ARRAY[OLD.movement_id,NEW.movement_id] ELSE ARRAY[OLD.movement_id] END);
    IF EXISTS (SELECT 1 FROM pos_sync_refund_v1.movement_aliases
      WHERE movement_id = OLD.movement_id OR (TG_OP = 'UPDATE' AND movement_id = NEW.movement_id)) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_REFUND_V1_MOVEMENT_OWNED';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  PERFORM pos_sync_refund_v1.lock_movements(ARRAY[NEW.movement_id]);
  SELECT * INTO v_alias FROM pos_sync_refund_v1.movement_aliases WHERE movement_id = NEW.movement_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NOT v_alias.canonical OR v_alias.consumed OR v_alias.creator_xid IS DISTINCT FROM pg_current_xact_id_if_assigned()
    OR (NEW.product_id,NEW.store_id,NEW.delta) IS DISTINCT FROM (v_alias.product_id,v_alias.branch_id,v_alias.delta) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_REFUND_V1_MOVEMENT_OWNED';
  END IF;
  UPDATE pos_sync_refund_v1.movement_aliases SET consumed = true WHERE movement_id = NEW.movement_id;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER pos_sync_refund_movement_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.stock_delta_applied
FOR EACH ROW EXECUTE FUNCTION pos_sync_refund_v1.guard_stock_movement();

CREATE FUNCTION public.pos_sync_refund_v1(
  p_author uuid, p_branch text, p_terminal text, p_operation uuid, p_refund_key text, p_sale uuid,
  p_expected_sale_version integer, p_lines jsonb, p_reason text, p_approval_basis jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $refund$
DECLARE
  v_prior pos_sync_refund_v1.receipts%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_shift uuid;
  v_hash text;
  v_cloud_lines jsonb;
  v_lines jsonb;
  v_aliases jsonb;
  v_ids uuid[];
  v_effects jsonb;
  v_stock_before jsonb;
  v_stock_after jsonb;
  v_historical_count integer;
  v_alias_conflict boolean;
  v_result jsonb;
  v_outcome jsonb;
  v_approval_basis jsonb;
  v_sale_after public.sales%ROWTYPE;
  v_exact boolean;
BEGIN
  PERFORM fin62_live_preparation.authorize(p_author,p_branch,p_terminal,'REFUND');
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_REFUND_V1_INVALID_COMMAND';
  END IF;
  IF p_operation IS NULL OR p_refund_key IS NULL OR char_length(p_refund_key) NOT BETWEEN 1 AND 128
     OR p_refund_key <> btrim(p_refund_key) OR p_refund_key ~ '[[:cntrl:]]'
     OR p_operation <> pos_sync_refund_v1.native_id('{"refundId":' || to_jsonb(p_refund_key)::text || '}')
     OR p_sale IS NULL OR p_expected_sale_version IS NULL OR p_expected_sale_version < 1
     OR octet_length(p_lines::text) > 65536
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR char_length(p_reason) > 400
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) AS line
       WHERE jsonb_typeof(line) <> 'object'
          OR NOT line ?& ARRAY['item_id','qty','expected_refunded_qty','expected_row_version']
          OR line - ARRAY['item_id','qty','expected_refunded_qty','expected_row_version'] <> '{}'::jsonb
          OR jsonb_typeof(line->'item_id') <> 'string'
          OR line->>'item_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
          OR jsonb_typeof(line->'qty') <> 'number' OR line->>'qty' !~ '^[1-9][0-9]{0,8}$'
          OR jsonb_typeof(line->'expected_refunded_qty') <> 'number' OR line->>'expected_refunded_qty' !~ '^(0|[1-9][0-9]{0,8})$'
          OR jsonb_typeof(line->'expected_row_version') <> 'number' OR line->>'expected_row_version' !~ '^[1-9][0-9]{0,9}$'
     ) OR (SELECT count(DISTINCT line->>'item_id') FROM jsonb_array_elements(p_lines) AS line) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_REFUND_V1_INVALID_COMMAND';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_array(
    p_author,p_branch,p_terminal,p_operation,p_refund_key,p_sale,p_expected_sale_version,p_lines,p_reason
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-refund-operation:' || p_operation::text, 0));
  -- Match FIN62's order before locking the canonical sale or its items.
  PERFORM pg_advisory_xact_lock(hashtextextended('fin62-live-sale:' || p_sale::text, 0));
  SELECT nullif(shift_id,'')::uuid INTO v_shift FROM public.sales WHERE id = p_sale AND store_id = p_branch;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_REFUND_V1_SCOPE_FORBIDDEN'; END IF;
  IF v_shift IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:' || v_shift::text, 0));
    PERFORM 1 FROM public.shifts WHERE id = v_shift AND store_id = p_branch FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_REFUND_V1_SCOPE_FORBIDDEN'; END IF;
  END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale AND store_id = p_branch FOR UPDATE;
  IF NOT FOUND OR nullif(v_sale.shift_id,'')::uuid IS DISTINCT FROM v_shift THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_REFUND_V1_SCOPE_FORBIDDEN';
  END IF;

  SELECT * INTO v_prior FROM pos_sync_refund_v1.receipts WHERE operation_id = p_operation;
  IF FOUND THEN
    IF v_prior.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_REFUND_V1_REPLAY_MISMATCH';
    END IF;
    RETURN v_prior.result;
  END IF;
  v_approval_basis := jsonb_build_object('bill_number',v_sale.bill_number,
    'total',abs(v_sale.total_amount)::text,'row_version',v_sale.row_version);
  IF p_approval_basis IS NULL THEN
    RETURN jsonb_build_object('status','APPROVAL_CHECK_REQUIRED','operation_id',p_operation,
      'sale_id',p_sale,'basis',v_approval_basis);
  END IF;
  IF p_approval_basis IS DISTINCT FROM v_approval_basis THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'POS_REFUND_V1_STALE_COMMAND';
  END IF;

  -- Retain the exact locked line facts and prepare both historical routes.
  SELECT jsonb_agg(jsonb_build_object('item_id',item.id,'product_id',item.product_id,'qty',requested.qty,
      'before',item.refunded_qty,'expected_before',requested.expected_refunded_qty,'row_version',item.row_version,
      'expected_row_version',requested.expected_row_version,'quantity',item.quantity) ORDER BY item.id)
    INTO v_lines
  FROM jsonb_to_recordset(p_lines) AS requested(item_id uuid,qty integer,expected_refunded_qty integer,expected_row_version bigint)
  JOIN LATERAL (
    SELECT i.id,i.product_id,i.refunded_qty,i.row_version,i.quantity
    FROM public.sale_items AS i
    WHERE i.id = requested.item_id AND i.sale_id = p_sale AND (i.branch_id IS NULL OR i.branch_id = p_branch)
    FOR UPDATE
  ) AS item ON true;
  IF v_lines IS NULL OR jsonb_array_length(v_lines) <> jsonb_array_length(p_lines)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE line->>'product_id' IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_REFUND_V1_SCOPE_FORBIDDEN';
  END IF;
  WITH keys AS (
    SELECT p_refund_key AS key
    UNION SELECT 'refund:' || p_sale::text WHERE lower(p_refund_key) = 'refund:' || p_sale::text
    UNION SELECT 'refund:' || upper(p_sale::text) WHERE lower(p_refund_key) = 'refund:' || p_sale::text
  )
  SELECT array_agg(alias.movement_id ORDER BY alias.movement_id),
         jsonb_agg(to_jsonb(alias) ORDER BY alias.movement_id) INTO v_ids,v_aliases
  FROM (
    SELECT line.item_id,line.product_id,line.qty,ids.movement_id,bool_or(ids.canonical) AS canonical
    FROM jsonb_to_recordset(v_lines) AS line(item_id uuid,product_id uuid,qty integer)
    CROSS JOIN LATERAL (
      SELECT md5(keys.key || ':' || line.item_id::text)::uuid AS movement_id, keys.key = p_refund_key AS canonical
        FROM keys
      UNION ALL SELECT pos_sync_refund_v1.native_movement_id(keys.key,item.id), false
        FROM keys
        CROSS JOIN (VALUES(line.item_id::text),(upper(line.item_id::text))) AS item(id)
    ) AS ids
    GROUP BY line.item_id,line.product_id,line.qty,ids.movement_id
  ) AS alias;
  PERFORM pos_sync_refund_v1.lock_movements(v_ids);

  -- Historical stock facts are insufficient to reconstruct the original line
  -- versions and accepted receipt. Keep exact matches as well as conflicts
  -- visible for review. Neither case reruns the refund.
  SELECT count(*),bool_and((ledger.product_id,ledger.store_id,ledger.delta) IS NOT DISTINCT FROM
      (alias.product_id,p_branch,alias.qty)) AND count(*) = jsonb_array_length(p_lines)
      AND count(*) = count(DISTINCT alias.item_id)
    INTO v_historical_count,v_exact
  FROM jsonb_to_recordset(v_aliases) AS alias(item_id uuid,product_id uuid,qty integer,movement_id uuid)
  JOIN public.stock_delta_applied AS ledger USING (movement_id);
  SELECT EXISTS (
    SELECT 1 FROM pos_sync_refund_v1.movement_aliases WHERE movement_id = ANY(v_ids)
  ) INTO v_alias_conflict;
  IF v_alias_conflict OR v_historical_count > 0 OR EXISTS (
    SELECT 1 FROM fin62_live_preparation.receipts
    WHERE action = 'REFUND' AND sale_id = p_sale AND request_key = p_refund_key
  ) THEN
    v_outcome := jsonb_build_object('status','REVIEW_REQUIRED','operation_id',p_operation,'sale_id',p_sale,
      'code',CASE WHEN v_alias_conflict OR (v_historical_count > 0 AND v_exact IS FALSE)
        THEN 'REFUND_MOVEMENT_COLLISION' ELSE 'LEGACY_REFUND_MOVEMENT' END);
    INSERT INTO pos_sync_refund_v1.receipts(operation_id,sale_id,branch_id,request_hash,result)
      VALUES (p_operation,p_sale,p_branch,v_hash,v_outcome);
    -- Hold the exact aliases as well as the request. An old upload must not
    -- add its other route's stock movement while this refund is under review.
    INSERT INTO pos_sync_refund_v1.movement_aliases(movement_id,operation_id,item_id,product_id,branch_id,delta,canonical)
      SELECT movement_id,p_operation,item_id,product_id,p_branch,qty,false
      FROM jsonb_to_recordset(v_aliases) AS alias(item_id uuid,product_id uuid,qty integer,movement_id uuid)
      ON CONFLICT (movement_id) DO NOTHING;
    RETURN v_outcome;
  END IF;

  IF v_sale.row_version IS DISTINCT FROM p_expected_sale_version OR v_sale.is_refunded IS TRUE
     OR EXISTS (
       SELECT 1 FROM jsonb_to_recordset(v_lines) AS line(
         before integer,expected_before integer,row_version bigint,expected_row_version bigint,quantity integer,qty integer)
       WHERE line.before IS DISTINCT FROM line.expected_before OR line.row_version IS DISTINCT FROM line.expected_row_version
          OR line.qty > greatest(line.quantity,0) - line.before
     ) THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'POS_REFUND_V1_STALE_COMMAND'; END IF;

  INSERT INTO pos_sync_refund_v1.movement_aliases(movement_id,operation_id,item_id,product_id,branch_id,delta,canonical)
    SELECT movement_id,p_operation,item_id,product_id,p_branch,qty,canonical
    FROM jsonb_to_recordset(v_aliases) AS alias(item_id uuid,product_id uuid,qty integer,movement_id uuid,canonical boolean);
  SELECT jsonb_agg(jsonb_build_object('item_id',line.item_id,'qty',line.qty) ORDER BY line.item_id)
    INTO v_cloud_lines FROM jsonb_to_recordset(v_lines) AS line(item_id uuid,qty integer);
  -- The movement locks are held first, matching the canonical stock writer.
  -- Keep the branch's product values stable until the refund commits.
  SELECT jsonb_agg(to_jsonb(saved) ORDER BY saved.product_id) INTO v_stock_before FROM (
    SELECT product.id AS product_id,delta.qty,coalesce((product.stock_by_store->>p_branch)::integer,0) AS balance
    FROM public.products AS product
    JOIN (SELECT product_id,sum(qty) AS qty
      FROM jsonb_to_recordset(v_lines) AS line(product_id uuid,qty integer) GROUP BY product_id) AS delta
      ON delta.product_id = product.id
    ORDER BY product.id
    FOR UPDATE OF product
  ) AS saved;
  v_result := public.pos_live_financial_refund(p_author,p_branch,p_terminal,p_sale,v_cloud_lines,p_refund_key,p_reason);
  SELECT * INTO STRICT v_sale_after FROM public.sales WHERE id = p_sale AND store_id = p_branch;

  SELECT jsonb_agg(jsonb_build_object('item_id',alias.item_id,'product_id',alias.product_id,
    'branch_id',alias.branch_id,'delta',alias.delta,'movement_id',alias.movement_id,
    'refunded_qty',item.refunded_qty,'row_version',item.row_version) ORDER BY alias.item_id) INTO v_effects
  FROM pos_sync_refund_v1.movement_aliases AS alias
  JOIN public.stock_delta_applied AS ledger USING (movement_id)
  JOIN public.sale_items AS item ON item.id = alias.item_id AND item.sale_id = p_sale
    AND (item.branch_id IS NULL OR item.branch_id = p_branch)
  JOIN jsonb_to_recordset(v_lines) AS saved(item_id uuid,before integer,row_version bigint) ON saved.item_id = alias.item_id
  WHERE alias.operation_id = p_operation AND alias.canonical AND alias.consumed
    AND (ledger.product_id,ledger.store_id,ledger.delta) = (alias.product_id,alias.branch_id,alias.delta)
    AND item.refunded_qty = saved.before + alias.delta AND item.row_version = saved.row_version + 1;
  SELECT jsonb_agg(jsonb_build_object('product_id',saved.product_id,'branch_id',p_branch,
    'balance',saved.balance + saved.qty) ORDER BY saved.product_id) INTO v_stock_after
  FROM jsonb_to_recordset(v_stock_before) AS saved(product_id uuid,qty bigint,balance integer)
  JOIN public.products AS product ON product.id = saved.product_id
  WHERE (product.stock_by_store->>p_branch)::integer = saved.balance + saved.qty;
  IF v_effects IS NULL OR jsonb_array_length(v_effects) <> jsonb_array_length(p_lines)
     OR v_stock_after IS NULL OR jsonb_array_length(v_stock_after) <> jsonb_array_length(v_stock_before)
     OR v_result->>'sale_id' IS DISTINCT FROM p_sale::text
     OR v_result->'fully_refunded' IS DISTINCT FROM to_jsonb(coalesce(v_sale_after.is_refunded,false))
     OR v_sale_after.row_version IS DISTINCT FROM
       (p_expected_sale_version::bigint + CASE WHEN v_sale_after.is_refunded THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_REFUND_V1_EFFECT_UNVERIFIED';
  END IF;
  v_outcome := jsonb_build_object('status','APPLIED','operation_id',p_operation,'sale_id',p_sale,
    'effects',v_effects,'stock',v_stock_after,'fully_refunded',coalesce(v_sale_after.is_refunded,false),
    'sale_row_version',v_sale_after.row_version);
  INSERT INTO pos_sync_refund_v1.receipts(operation_id,sale_id,branch_id,request_hash,result)
    VALUES (p_operation,p_sale,p_branch,v_hash,v_outcome);
  RETURN v_outcome;
END;
$refund$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pos_sync_refund_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_sync_refund_v1(uuid,text,text,uuid,text,uuid,integer,jsonb,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_refund_v1(uuid,text,text,uuid,text,uuid,integer,jsonb,text,jsonb) TO service_role;
COMMIT;
