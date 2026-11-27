-- STOCK401 preparation. Link real merge effects to the original accepted
-- operation without changing quantities, acknowledgements or clock authority.
BEGIN;

DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('private.stock_history_product_merges')
   AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres'
   AND NOT has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
   AND NOT has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
   AND NOT has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass('private.stock_history_product_merges')
   AND t.tgname='stock_history_product_merge_immutable' AND t.tgenabled='O'
   AND t.tgfoid=to_regprocedure('private.stock_history_immutable()')
 ) THEN RAISE EXCEPTION 'STOCK_HISTORY_MERGE_RECEIPT_CONTRACT_UNVERIFIED'; END IF;
END $guard$;

CREATE TABLE private.stock_history_product_merge_effects (
 effect_id uuid PRIMARY KEY REFERENCES private.stock_history_accepted_effects(id),
 operation_id uuid NOT NULL REFERENCES private.stock_history_product_merges(operation_id),
 product_id uuid NOT NULL,
 leg text NOT NULL CHECK(leg IN ('master','removed')),
 UNIQUE(operation_id,product_id)
);
ALTER TABLE private.stock_history_product_merge_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_product_merge_effects FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_product_merge_effect_immutable
 BEFORE UPDATE OR DELETE ON private.stock_history_product_merge_effects
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_bind_product_merge_effects() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE expected_count integer; matched_count integer; matches jsonb; inserted integer;
BEGIN
 IF NEW.capture_xid IS DISTINCT FROM pg_current_xact_id() OR NEW.outcome->'ok' IS DISTINCT FROM 'true'::jsonb
  OR NEW.outcome->>'operationId' IS DISTINCT FROM NEW.operation_id::text
  OR NEW.outcome->>'branchId' IS DISTINCT FROM NEW.branch_id
  OR NEW.outcome->'master'->>'id' IS DISTINCT FROM NEW.master_id::text
  OR jsonb_typeof(NEW.outcome->'removed') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.outcome->'removed') NOT BETWEEN 1 AND 49 THEN RETURN NULL; END IF;

 WITH retired AS MATERIALIZED(
  SELECT (row->>'id')::uuid product,(row->>'quantity')::numeric quantity FROM jsonb_array_elements(NEW.outcome->'removed') row
 ), delta AS MATERIALIZED(SELECT COALESCE(sum(quantity),0) quantity FROM retired),
 expected AS MATERIALIZED(
  SELECT product,'removed' leg,'DELETE' operation,-quantity difference,0::numeric resulting FROM retired WHERE quantity<>0
  UNION ALL SELECT NEW.master_id,'master','UPDATE',quantity,(NEW.outcome->'master'->>'quantity')::numeric
   FROM delta WHERE quantity<>0
 ), found AS MATERIALIZED(
  SELECT expected.*,result.effect::text effect,result.candidate_count FROM expected
  CROSS JOIN LATERAL (
   SELECT (array_agg(id))[1] effect,count(*) candidate_count FROM (
    SELECT e.id FROM private.stock_history_accepted_effects e
    WHERE e.transaction_id=NEW.capture_xid::text::bigint AND e.store_id=NEW.branch_id
     AND e.product_id=expected.product AND e.operation=expected.operation
     AND e.quantity_delta=expected.difference AND e.next_quantity=expected.resulting LIMIT 2
   ) one_effect
  ) result
 )
 SELECT count(*),count(*) FILTER(WHERE candidate_count=1),
  COALESCE(jsonb_agg(jsonb_build_array(product,leg,effect) ORDER BY product) FILTER(WHERE candidate_count=1),'[]'::jsonb)
 INTO expected_count,matched_count,matches FROM found;
 IF expected_count<>matched_count THEN RETURN NULL; END IF;

 INSERT INTO private.stock_history_product_merge_effects(effect_id,operation_id,product_id,leg)
 SELECT (x->>2)::uuid,NEW.operation_id,(x->>0)::uuid,x->>1 FROM jsonb_array_elements(matches) x;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted<>expected_count THEN RAISE EXCEPTION 'STOCK_HISTORY_MERGE_EFFECTS_CHANGED'; END IF;
 RETURN NULL;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
 -- Unlinked effects remain visible to the existing capture-coverage checks.
 -- An optional evidence error cannot change the accepted merge receipt.
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_bind_product_merge_effects() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_product_merge_effects AFTER INSERT ON private.stock_history_product_merges
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_bind_product_merge_effects();

COMMIT;
