-- Optional STOCK401 preparation after stock claim membership and the attested
-- grouped refund gateway. No backfill or change to the financial receipt.
BEGIN;

DO $dependencies$
BEGIN
 IF to_regclass('pos_sync_refund_v1.receipts') IS NULL
  OR to_regclass('pos_sync_refund_v1.movement_aliases') IS NULL
  OR to_regclass('pos_sync_feed_v1.extended_publications') IS NULL
  OR to_regclass('private.stock_history_effect_sources') IS NULL
  OR to_regprocedure('private.stock_history_record_source_verification(jsonb,text,text,text)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_REFUND_DEPENDENCY_REQUIRED'; END IF;
END $dependencies$;

CREATE TABLE private.stock_history_grouped_refund_witnesses (
 operation_id uuid PRIMARY KEY,
 branch_id text COLLATE "C" NOT NULL,
 terminal_id text COLLATE "C" NOT NULL,
 author_id uuid NOT NULL,
 key_id uuid NOT NULL,
 project_origin text NOT NULL,
 epoch uuid NOT NULL,
 seq bigint NOT NULL CHECK(seq>0),
 capture_xid xid8 NOT NULL,
 accepted_hash bytea NOT NULL CHECK(octet_length(accepted_hash)=32),
 movement_map jsonb NOT NULL CHECK(jsonb_typeof(movement_map)='object')
);
ALTER TABLE private.stock_history_grouped_refund_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_grouped_refund_witnesses FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_grouped_refund_witness_immutable
 BEFORE UPDATE OR DELETE ON private.stock_history_grouped_refund_witnesses
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_record_grouped_refund(
 p_operation uuid,p_branch text,p_terminal text,p_author uuid,p_key uuid,p_project text,
 p_epoch uuid,p_seq bigint,p_refund_key text,p_result jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $witness$
DECLARE v_movements jsonb; v_count bigint;
BEGIN
 -- A saved receipt may replay APPLIED. Only the original writer still owns
 -- every canonical alias in the current transaction.
 SELECT count(*),jsonb_object_agg(alias.movement_id::text,jsonb_build_array(
    pos_sync_refund_v1.native_movement_id(p_refund_key,alias.item_id::text),
    pos_sync_refund_v1.native_movement_id(p_refund_key,upper(alias.item_id::text))))
 INTO v_count,v_movements
 FROM pos_sync_refund_v1.movement_aliases alias
 WHERE alias.operation_id=p_operation AND alias.branch_id=p_branch AND alias.canonical AND alias.consumed
  AND alias.creator_xid=pg_current_xact_id_if_assigned();
 IF v_count=0 OR v_count IS DISTINCT FROM jsonb_array_length(p_result->'effects')::bigint THEN RETURN; END IF;

 INSERT INTO private.stock_history_grouped_refund_witnesses
 VALUES(p_operation,p_branch,p_terminal,p_author,p_key,p_project,p_epoch,p_seq,pg_current_xact_id(),
  sha256(convert_to((p_result-ARRAY['feed_epoch','feed_seq'])::text,'UTF8')),v_movements)
 ON CONFLICT(operation_id) DO NOTHING;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
 -- A report witness failure leaves the stock effect unvalidated. The existing
 -- refund outcome, feed publication and money/stock transaction still commit.
 NULL;
END $witness$;
REVOKE ALL ON FUNCTION private.stock_history_record_grouped_refund(uuid,text,text,uuid,uuid,text,uuid,bigint,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_grouped_refund_source_refs(
 p_project text,p_operation uuid,p_author uuid,p_key uuid,p_branch text,p_terminal text,p_product uuid,p_refs jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $source$
DECLARE v_refs jsonb; v_count bigint; v_unique bigint; v_expected bigint;
BEGIN
 IF jsonb_typeof(p_refs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;
 IF jsonb_array_length(p_refs) NOT BETWEEN 1 AND 100 OR EXISTS (
  SELECT FROM jsonb_array_elements(p_refs) AS input(ref)
  WHERE ref->>0 IS DISTINCT FROM 'stock_delta_applied' OR jsonb_typeof(ref->1) IS DISTINCT FROM 'string'
   OR jsonb_typeof(ref->2) IS DISTINCT FROM 'string' OR CASE WHEN jsonb_typeof(ref)='array' THEN jsonb_array_length(ref)<>3 ELSE true END
 ) THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;

 SELECT count(*) INTO v_expected FROM pos_sync_refund_v1.movement_aliases alias
 WHERE alias.operation_id=p_operation AND alias.branch_id=p_branch AND alias.product_id=p_product AND alias.canonical;

 SELECT count(*),count(DISTINCT canonical.movement_id),jsonb_agg(
  jsonb_build_array('stock_delta_applied',canonical.movement_id,canonical.delta::text) ORDER BY canonical.movement_id)
 INTO v_count,v_unique,v_refs
 FROM private.stock_history_grouped_refund_witnesses witness
 JOIN pos_sync_private.shift_author_keys original ON original.key_id=witness.key_id AND original.author_id=witness.author_id
  AND original.project_origin=witness.project_origin AND original.terminal_id=witness.terminal_id
 JOIN pos_sync_refund_v1.receipts receipt ON receipt.operation_id=witness.operation_id AND receipt.branch_id=witness.branch_id
  AND receipt.result->>'status'='APPLIED' AND receipt.result->>'sale_id'=receipt.sale_id::text
  AND receipt.result->>'operation_id'=witness.operation_id::text
  AND sha256(convert_to(receipt.result::text,'UTF8'))=witness.accepted_hash
 JOIN pos_sync_feed_v1.extended_publications archive ON archive.organization_id='default' AND archive.scope_id=witness.branch_id
  AND archive.epoch=witness.epoch AND archive.seq=witness.seq AND archive.operation_id=witness.operation_id
  AND archive.metadata->'financial'->>'kind'='refund_v1' AND archive.metadata->'financial'->>'sale_id'=receipt.sale_id::text
 JOIN pos_sync_refund_v1.movement_aliases canonical ON canonical.operation_id=witness.operation_id
  AND canonical.branch_id=witness.branch_id AND canonical.product_id=p_product AND canonical.canonical AND canonical.consumed
  AND canonical.creator_xid=witness.capture_xid
 JOIN private.stock_history_source_receipts source ON source.movement_id=canonical.movement_id
  AND source.transaction_id=witness.capture_xid::text::bigint AND source.product_id=canonical.product_id
  AND source.store_id=canonical.branch_id AND source.quantity_delta=canonical.delta
 JOIN private.stock_history_effect_sources link ON link.movement_id=source.movement_id
 JOIN private.stock_history_accepted_effects effect ON effect.id=link.effect_id AND effect.transaction_id=source.transaction_id
  AND effect.product_id=source.product_id AND effect.store_id=source.store_id AND effect.quantity_delta=source.quantity_delta
 CROSS JOIN LATERAL jsonb_array_elements(p_refs) AS input(ref)
 JOIN pos_sync_refund_v1.movement_aliases native ON native.operation_id=canonical.operation_id
  AND native.item_id=canonical.item_id AND native.product_id=canonical.product_id AND native.branch_id=canonical.branch_id
  AND native.delta=canonical.delta AND NOT native.canonical AND NOT native.consumed AND native.creator_xid=witness.capture_xid
  AND native.movement_id::text=ref->>1 AND native.delta::text=ref->>2
  AND (witness.movement_map->canonical.movement_id::text) ? (ref->>1)
 WHERE witness.operation_id=p_operation AND witness.branch_id=p_branch AND witness.terminal_id=p_terminal
  AND witness.author_id=p_author AND witness.key_id=p_key AND witness.project_origin=p_project
  AND EXISTS (SELECT FROM jsonb_array_elements(receipt.result->'effects') AS entry(row_value)
   WHERE row_value @> jsonb_build_object('movement_id',canonical.movement_id,'item_id',canonical.item_id,
    'product_id',p_product,'branch_id',p_branch,'delta',canonical.delta))
  AND EXISTS (SELECT FROM jsonb_array_elements(archive.changes) AS change(row_value)
   WHERE row_value->>'table_name'='stock_delta_applied' AND row_value->'row_data' @> jsonb_build_object(
    'movement_id',canonical.movement_id,'item_id',canonical.item_id,'product_id',p_product,'store_id',p_branch,'delta',canonical.delta));
 IF v_expected=0 OR v_count<>v_expected OR v_unique<>v_count OR v_count<>jsonb_array_length(p_refs)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;
 RETURN v_refs;
END $source$;
REVOKE ALL ON FUNCTION private.stock_history_grouped_refund_source_refs(text,uuid,uuid,uuid,text,text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

DO $wire$
DECLARE gateway oid:=to_regprocedure('public.pos_sync_refund_attested_v1(uuid,text,text,uuid,text,uuid,integer,jsonb,text,jsonb,text,uuid,uuid,uuid,uuid,text,text,jsonb)');
 claims oid:=to_regprocedure('public.pos_stock_history_accept_claims(text,text,text,jsonb)');
 definition text; installed text;
 archive_anchor text:=$a$v_result := v_result || jsonb_build_object('feed_epoch',p_epoch,'feed_seq',v_seq::text);$a$;
 source_anchor text:=$a$ELSE matched:=private.stock_history_original_member_effects(p_project,p_branch,p_terminal,submitted,proof);END IF;$a$;
 generic_anchor text:=$a$proof->>'action'<>'SALE'$a$;
BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE oid IN(gateway,claims) AND proowner=current_user::regrole AND prosecdef)<>2
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_REFUND_ROUTINE_OWNER_UNVERIFIED'; END IF;
 definition:=pg_get_functiondef(gateway);
 IF definition IS NULL OR length(definition)-length(replace(definition,archive_anchor,''))<>length(archive_anchor)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_REFUND_GATEWAY_UNVERIFIED'; END IF;
 EXECUTE replace(definition,archive_anchor,archive_anchor||$source$
    PERFORM private.stock_history_record_grouped_refund(p_operation,p_branch,p_terminal,p_author,p_author_key_id,
      p_project_origin,p_epoch,v_seq,p_refund_key,v_result);$source$);

 definition:=pg_get_functiondef(claims);
 IF definition IS NULL OR length(definition)-length(replace(definition,source_anchor,''))<>length(source_anchor)
  OR length(definition)-length(replace(definition,generic_anchor,''))<>2*length(generic_anchor)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_GROUPED_REFUND_CLAIM_CONTRACT_UNVERIFIED'; END IF;
 installed:=replace(definition,generic_anchor,$a$proof->>'action' NOT IN ('SALE','REFUND')$a$);
 EXECUTE replace(installed,source_anchor,$source$ELSIF proof->>'action'='REFUND' THEN
    matched:=private.stock_history_match_effect_candidates(product,p_branch,(payload->>8)::numeric,
      private.stock_history_grouped_refund_source_refs(p_project,operation,author,registered.key_id,p_branch,p_terminal,product,payload->16));
   $source$||source_anchor);
END $wire$;

COMMIT;
