-- Isolated preparation after the mixed cash/settings gateway. Index only
-- receipt rows owned by accepted cash births, independent of feed retention.
CREATE TABLE pos_sync_feed_v1.cash_receipt_owners (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  table_name text COLLATE "C" NOT NULL CHECK (table_name IN ('sales','sale_items','payment_transactions','item_activity_logs')),
  entity_id uuid NOT NULL,
  seq bigint NOT NULL,
  PRIMARY KEY (organization_id, scope_id, epoch, table_name, entity_id),
  FOREIGN KEY (organization_id, scope_id, epoch, seq)
    REFERENCES pos_sync_feed_v1.cash_publications(organization_id, scope_id, epoch, seq)
);
ALTER TABLE pos_sync_feed_v1.cash_receipt_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.cash_receipt_owners FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.index_cash_receipt(p_org text, p_scope text, p_epoch uuid, p_seq bigint, p_changes jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog
AS $index$
  INSERT INTO pos_sync_feed_v1.cash_receipt_owners
  SELECT p_org, p_scope, p_epoch, change->>'table_name', (change->'row_data'->>'id')::uuid, p_seq
  FROM jsonb_array_elements(p_changes) AS change;
$index$;

-- The backfill and trigger installation use one transaction so no accepted
-- publication can land between them. Prepared SQL is applied as a unit.
LOCK TABLE pos_sync_feed_v1.cash_publications IN SHARE ROW EXCLUSIVE MODE;
SELECT pos_sync_feed_v1.index_cash_receipt(organization_id, scope_id, epoch, seq, changes)
FROM pos_sync_feed_v1.cash_publications;

CREATE FUNCTION pos_sync_feed_v1.index_cash_receipt_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $on_insert$
BEGIN
  PERFORM pos_sync_feed_v1.index_cash_receipt(NEW.organization_id, NEW.scope_id, NEW.epoch, NEW.seq, NEW.changes);
  RETURN NULL;
END;
$on_insert$;
CREATE TRIGGER pos_sync_cash_receipt_owner AFTER INSERT ON pos_sync_feed_v1.cash_publications
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.index_cash_receipt_on_insert();

CREATE FUNCTION public.pos_sync_cash_legacy_coverage_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_epoch uuid, p_entries jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $coverage$
DECLARE
  v_owned jsonb;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  PERFORM 1 FROM pos_sync_feed_v1.feed_heads AS head
    JOIN pos_sync_feed_v1.cash_settings_pilots AS mixed USING (organization_id, scope_id, epoch)
    WHERE (head.organization_id, head.scope_id, head.epoch) = (p_organization_id, p_branch_id, p_epoch)
    FOR SHARE OF head;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;

  IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 100
     OR octet_length(p_entries::text) > 16384 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_entries) AS e(value)
       WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
         OR e.value - ARRAY['table_name','id'] <> '{}'::jsonb
         OR coalesce(e.value->>'table_name','') NOT IN ('sales','sale_items','payment_transactions','item_activity_logs')
         OR coalesce(e.value->>'id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
     ) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_LEGACY_V1_INVALID_KEYS'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table_name', owner.table_name, 'id', owner.entity_id, 'seq', owner.seq::text)
    ORDER BY owner.table_name, owner.entity_id), '[]'::jsonb) INTO v_owned
  FROM pos_sync_feed_v1.cash_receipt_owners AS owner
  JOIN (SELECT DISTINCT table_name, id FROM jsonb_to_recordset(p_entries) AS e(table_name text, id uuid)) AS requested
    ON (owner.table_name, owner.entity_id) = (requested.table_name, requested.id)
  WHERE (owner.organization_id, owner.scope_id, owner.epoch) = (p_organization_id, p_branch_id, p_epoch);
  RETURN jsonb_build_object('status', 'OK', 'scope_id', p_branch_id, 'epoch', p_epoch, 'entries', v_owned);
END;
$coverage$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.index_cash_receipt(text,text,uuid,bigint,jsonb),
  pos_sync_feed_v1.index_cash_receipt_on_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_sync_cash_legacy_coverage_v1(text,text,uuid,text,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_cash_legacy_coverage_v1(text,text,uuid,text,uuid,jsonb) TO service_role;
