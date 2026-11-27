-- Optional STOCK401 preparation. No historical witness is reconstructed.
-- Install only with the reviewed stock-history and grouped cash contracts.
BEGIN;

DO $dependencies$
BEGIN
 IF to_regclass('pos_sync_inbox_v1.operation_receipts') IS NULL
  OR to_regclass('pos_sync_feed_v1.cash_publications') IS NULL
  OR to_regclass('private.stock_history_accepted_effects') IS NULL
  OR to_regprocedure('private.stock_history_record_source_verification(jsonb,text,text,text)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_CASH_DEPENDENCY_REQUIRED'; END IF;
END $dependencies$;

CREATE TABLE private.stock_history_grouped_cash_witnesses (
 organization_id text COLLATE "C" NOT NULL,
 operation_id uuid NOT NULL,
 capture_transaction bigint NOT NULL,
 accepted_result jsonb NOT NULL CHECK(jsonb_typeof(accepted_result)='object'),
 PRIMARY KEY(organization_id,operation_id)
);
ALTER TABLE private.stock_history_grouped_cash_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_grouped_cash_witnesses FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_grouped_cash_witness_immutable
 BEFORE UPDATE OR DELETE ON private.stock_history_grouped_cash_witnesses
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_grouped_cash_witness() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $witness$
BEGIN
 -- APPLIED deliberately clears claim_xid. Only preserve it during the
 -- original transition, once the business writer has its accepted receipt.
 IF NEW.organization_id='default' AND NEW.disposition='APPLIED'
  AND OLD.disposition IN ('PENDING','WAITING_DEPENDENCY')
  AND OLD.claim_xid=pg_current_xact_id()
  AND NEW.result->>'operation_id'=NEW.operation_id::text
  AND NEW.result->>'installation_generation'=NEW.origin_installation_id::text
  AND NEW.result->>'checkout_sha256'~'^[a-f0-9]{64}$'
  AND NEW.result->>'author_id'~'^[a-f0-9-]{36}$'
  AND NEW.result->>'author_key_id'~'^[a-f0-9-]{36}$'
 THEN
  BEGIN
   INSERT INTO private.stock_history_grouped_cash_witnesses
    VALUES(NEW.organization_id,NEW.operation_id,OLD.claim_xid::text::bigint,NEW.result)
    ON CONFLICT(organization_id,operation_id) DO NOTHING;
  EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
   -- An optional witness failure leaves an unvalidated accepted effect.
   -- It cannot revoke the protected checkout or alter its acknowledgement.
   NULL;
  END;
 END IF;
 RETURN NULL;
END $witness$;
REVOKE ALL ON FUNCTION private.stock_history_grouped_cash_witness() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_grouped_cash_witness
 AFTER UPDATE OF disposition ON pos_sync_inbox_v1.operation_receipts
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_grouped_cash_witness();

CREATE FUNCTION private.stock_history_grouped_cash_source_origin(
 p_project text,p_operation uuid,p_author uuid,p_key uuid,p_branch text,p_terminal text,p_product uuid,p_effects uuid[]
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $origin$
 SELECT COALESCE(cardinality(p_effects)=1 AND EXISTS(
  SELECT
  FROM private.stock_history_grouped_cash_witnesses witness
  JOIN pos_sync_inbox_v1.operation_receipts receipt USING (organization_id,operation_id)
  JOIN pos_sync_feed_v1.cash_publications archive USING (organization_id,operation_id)
  JOIN pos_sync_private.shift_author_keys original_key ON original_key.key_id=p_key AND original_key.author_id=p_author
   AND original_key.terminal_id=p_terminal AND original_key.project_origin=p_project
  JOIN private.stock_history_accepted_effects effect ON effect.id=p_effects[1]
   AND effect.transaction_id=witness.capture_transaction AND effect.product_id=p_product AND effect.store_id=p_branch
  JOIN private.stock_history_effect_sources link ON link.effect_id=effect.id
  JOIN private.stock_history_source_receipts source ON source.movement_id=link.movement_id
   AND source.transaction_id=effect.transaction_id AND source.product_id=effect.product_id
   AND source.store_id=effect.store_id AND source.quantity_delta=effect.quantity_delta
  CROSS JOIN LATERAL (SELECT archive.changes->0->'row_data' sale,archive.changes->1->'row_data' item,
                             archive.changes->3->'row_data' movement) graph
  WHERE witness.organization_id='default' AND witness.operation_id=p_operation AND receipt.disposition='APPLIED'
   AND receipt.result=witness.accepted_result AND receipt.claim_xid IS NULL AND archive.scope_id=p_branch
   AND receipt.result->>'scope_id'=p_branch AND receipt.result->>'terminal_id'=p_terminal
   AND receipt.result->>'epoch'=archive.epoch::text AND receipt.result->>'seq'=archive.seq::text
   AND receipt.result->>'author_id'=p_author::text AND receipt.result->>'author_key_id'=p_key::text
   AND receipt.result->>'installation_generation'=receipt.origin_installation_id::text
   -- The feed intentionally redacts the subject. Reconstruct the exact inbox
   -- claim to bind the archived checkout to its original enrolled author.
   AND receipt.payload_hash=sha256(convert_to(jsonb_build_object(
    'scope_id',p_branch,'terminal_id',p_terminal,'database_guid',receipt.result->>'database_guid',
    'epoch',archive.epoch,'checkout_sha256',receipt.result->>'checkout_sha256',
    'author',jsonb_build_object('author_id',p_author,'author_key_id',p_key,
     'subject',original_key.subject,'project_origin',p_project))::text,'UTF8'))
   AND ARRAY[archive.acceptance->>'terminal_id',archive.acceptance->>'database_guid',
             archive.acceptance->>'installation_generation',archive.acceptance->>'checkout_sha256']
       =ARRAY[p_terminal,receipt.result->>'database_guid',receipt.origin_installation_id::text,receipt.result->>'checkout_sha256']
   AND receipt.result->>'database_guid'~'^[a-f0-9-]{36}$'
   AND archive.changes->0->>'table_name'='sales' AND archive.changes->1->>'table_name'='sale_items'
   AND archive.changes->3->>'table_name'='item_activity_logs'
   AND sale->>'id'=receipt.result->>'sale_id' AND sale->>'store_id'=p_branch AND sale->>'branch_id'=p_branch
   AND item->>'sale_id'=sale->>'id' AND item->>'branch_id'=p_branch
   AND item->>'product_id'=p_product::text AND item->'is_return'='false'::jsonb
   AND movement->>'id'=source.movement_id::text AND movement->>'product_id'=p_product::text
   AND movement->>'store_id'=p_branch AND movement->>'terminal_id'=p_terminal
   AND movement->>'activity_type'='sale' AND movement->>'reference'=sale->>'bill_number'
   AND movement->'quantity_delta'=to_jsonb(effect.quantity_delta)
   AND CASE WHEN item->>'quantity'~'^[1-9][0-9]{0,9}$' THEN -(item->>'quantity')::numeric=effect.quantity_delta ELSE false END
 ), false);
$origin$;
REVOKE ALL ON FUNCTION private.stock_history_grouped_cash_source_origin(text,uuid,uuid,uuid,text,text,uuid,uuid[])
 FROM PUBLIC,anon,authenticated,service_role;

DO $enable$
DECLARE definition text:=pg_get_functiondef(to_regprocedure('public.pos_stock_history_accept_claims(text,text,text,jsonb)'));
 anchor text:=$a$IF proof->>'action'='SALE' AND NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)$a$;
 replacement text:=$a$IF proof->>'action'='SALE'
    AND NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)
    AND NOT private.stock_history_grouped_cash_source_origin(p_project,operation,author,registered.key_id,p_branch,p_terminal,product,effects)$a$;
BEGIN
 IF definition IS NULL OR length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_CASH_CLAIM_CONTRACT_UNVERIFIED'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $enable$;

COMMIT;
