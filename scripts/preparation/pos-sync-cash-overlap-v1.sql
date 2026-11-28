-- Isolated only. Install with the cash bridge as owner in the same transaction.
-- This coordinates the ordinary RPCs for exact accepted checkout identities.
CREATE TABLE pos_sync_cash_v1.checkout_route_owners (
  entity text COLLATE "C" NOT NULL,
  identity text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL,
  PRIMARY KEY (entity, identity)
);

ALTER TABLE pos_sync_cash_v1.checkout_route_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_cash_v1.checkout_route_owners FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_cash_v1.checkout_route_keys(p_operations jsonb)
RETURNS TABLE(entity text, identity text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $keys$
  WITH relevant AS MATERIALIZED (
    SELECT op->>'table' AS entity, op->'rows' AS rows, op->'changes' AS changes,
      CASE WHEN op->>'table' = 'stock_delta_applied' THEN 'movement_id' ELSE 'id' END AS key_name
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_operations) = 'array' THEN p_operations ELSE '[]'::jsonb END) AS op
    WHERE op->>'table' IN ('sales', 'sale_items', 'payment_transactions', 'item_activity_logs', 'stock_delta_applied')
  )
  SELECT keys.entity, keys.identity
  FROM relevant AS op
  CROSS JOIN LATERAL jsonb_array_elements(op.rows) AS row_data
  CROSS JOIN LATERAL (VALUES
    (op.entity, (row_data->>op.key_name)::uuid::text),
    ('sale_bill', CASE WHEN op.entity = 'sales' THEN row_data->>'bill_number' END),
    ('sale_client', CASE WHEN op.entity = 'sales' THEN row_data->>'client_transaction_id' END)
  ) AS keys(entity, identity)
  WHERE nullif(keys.identity, '') IS NOT NULL
  UNION ALL
  SELECT op.entity, coalesce(change->'key'->>op.key_name, (change->>'entityId')::jsonb->>op.key_name,
    (change->>'entity_id')::jsonb->>op.key_name)
  FROM relevant AS op
  CROSS JOIN LATERAL jsonb_array_elements(op.changes) AS change
  WHERE upper(coalesce(change->>'operation', '')) IN ('D', 'DELETE');
$keys$;

CREATE FUNCTION pos_sync_cash_v1.lock_checkout_routes()
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $lock$
BEGIN
  -- A fresh statement snapshot must see the preceding holder's reservation.
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'POS_CASH_V1_ROUTE_ISOLATION_UNSUPPORTED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-cash-v1-checkout-route', 0));
END;
$lock$;

CREATE FUNCTION pos_sync_cash_v1.check_checkout_route(p_operations jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $check_route$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_sync_cash_v1.checkout_route_keys(p_operations)) THEN RETURN; END IF;
  PERFORM pos_sync_cash_v1.lock_checkout_routes();
  IF EXISTS (
    SELECT 1 FROM pos_sync_cash_v1.checkout_route_keys(p_operations) AS keys
    JOIN pos_sync_cash_v1.checkout_route_owners AS owner USING (entity, identity)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_LEGACY_ROUTE_FENCED';
  END IF;
END;
$check_route$;

REVOKE ALL ON FUNCTION pos_sync_cash_v1.checkout_route_keys(jsonb), pos_sync_cash_v1.lock_checkout_routes(),
  pos_sync_cash_v1.check_checkout_route(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Place the guard before any existing idempotency or domain locks. Preserve the
-- routine OIDs, original implementation, ACL and default arguments. If a
-- compatibility overload is installed, it must participate without a terminal.
DO $install$
DECLARE
  v_route record;
  v_oid regprocedure;
  v_definition text;
  v_begin constant text := E'\nBEGIN\n';
BEGIN
  FOR v_route IN SELECT * FROM (VALUES
    ('public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)', false, true),
    ('public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)', true, true),
    ('public.pos_sync_push_aggregate(uuid,text,text,jsonb)', false, false),
    ('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)', true, false)
  ) AS routes(signature, required, batch)
  LOOP
    v_oid := to_regprocedure(v_route.signature);
    IF v_oid IS NULL AND NOT v_route.required THEN CONTINUE; END IF;
    SELECT pg_get_functiondef(proc.oid) INTO v_definition FROM pg_proc AS proc
    WHERE proc.oid = v_oid AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
    IF v_definition IS NULL OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR split_part(v_definition, v_begin, 2) = ''
       OR split_part(v_definition, v_begin, 3) <> ''
       OR position('pos_sync_cash_v1.check_checkout_route' IN v_definition) <> 0 THEN
      RAISE EXCEPTION 'Unexpected cash fence writer definition for %', v_route.signature;
    END IF;
    EXECUTE replace(v_definition, v_begin, v_begin || '  PERFORM pos_sync_cash_v1.check_checkout_route(' ||
      CASE WHEN v_route.batch THEN 'jsonb_build_array(jsonb_build_object(''table'', p_table, ''rows'', coalesce(p_rows, ''[]''::jsonb), ''changes'', coalesce(p_changes, ''[]''::jsonb)))'
      ELSE 'p_operations' END || E');\n');
  END LOOP;
END;
$install$;
