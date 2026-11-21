-- #401 preparation. Observe accepted hosted stock deductions. Keep unapplied
-- until an evidence admission/reader contract and the exact target are reviewed.
BEGIN;

DO $guard$
DECLARE expected record; routine oid;
BEGIN
 IF to_regclass('private.stock_history_online_deductions') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('stock_history_sponsorship_deduction','stock_history_missed_bill_deduction'))
 THEN RAISE EXCEPTION 'STOCK_ONLINE_DEDUCTION_EXISTING_SCHEMA_REVIEW_REQUIRED'; END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public.issue_sponsorship(uuid,text,text)','7c6eafb68aaad812703bebe837c07211'),
  ('public.pos_admin_add_missed_bill(jsonb,text,text)','3c388a266c07d9b0517b83a75c0a8682'),
  ('public.stock_apply_delta(uuid,uuid,text,integer)','09aa9eea1317191e72abd7a75b7ed67d'),
  ('private.stock_history_capture_accepted_products()','095bc1c87665046222185af64538b6a1'),
  ('private.stock_history_capture_source_receipt()','d5ad038b43ac9040c3916d067f336e72')
 ) checks(signature,digest) LOOP
  routine:=to_regprocedure(expected.signature);
  IF routine IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=routine
    AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=expected.digest)
  THEN RAISE EXCEPTION 'STOCK_ONLINE_DEDUCTION_UNREVIEWED_SOURCE: %',expected.signature; END IF;
 END LOOP;
 -- Retail POS Beta's writer verifies exact replay evidence before treating a
 -- reused movement ID as accepted. The older idempotency body is insufficient.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.stock_apply_delta(uuid,uuid,text,integer)'::regprocedure
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public']
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND has_function_privilege('service_role',p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'STOCK_ONLINE_DEDUCTION_DELTA_AUTHORITY_UNREVIEWED'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) g
  WHERE p.oid IN ('public.issue_sponsorship(uuid,text,text)'::regprocedure,'public.pos_admin_add_missed_bill(jsonb,text,text)'::regprocedure)
   AND g.privilege_type='EXECUTE' AND g.grantee NOT IN (p.proowner,'service_role'::regrole::oid)
 ) THEN RAISE EXCEPTION 'STOCK_ONLINE_DEDUCTION_WRITER_ACL_UNREVIEWED'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) g
  WHERE c.oid IN ('public.sponsorship_issues'::regclass,'public.missed_bill_entries'::regclass)
   AND g.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
   AND g.grantee NOT IN (c.relowner,'service_role'::regrole::oid)
 ) THEN RAISE EXCEPTION 'STOCK_ONLINE_DEDUCTION_DOCUMENT_ACL_UNREVIEWED'; END IF;
END $guard$;

CREATE TABLE private.stock_history_online_deductions (
 effect_id uuid PRIMARY KEY REFERENCES private.stock_history_accepted_effects(id),
 receipt_id uuid NOT NULL UNIQUE REFERENCES private.stock_history_source_receipts(movement_id),
 action text NOT NULL CHECK (action IN ('SPONSORSHIP_ISSUE','MISSED_BILL')),
 document_id uuid NOT NULL,
 product_id uuid NOT NULL,
 store_id text COLLATE "C" NOT NULL CHECK (length(store_id) BETWEEN 1 AND 128 AND btrim(store_id)=store_id),
 actor_id uuid NOT NULL,
 terminal_id text CHECK (length(terminal_id) BETWEEN 1 AND 128 AND btrim(terminal_id)=terminal_id),
 quantity_delta numeric(38,0) NOT NULL CHECK (quantity_delta<0),
 transaction_id bigint NOT NULL,
 document_recorded_at timestamptz NOT NULL,
 stock_observed_at timestamptz NOT NULL,
 CHECK (action<>'SPONSORSHIP_ISSUE' OR terminal_id IS NULL),
 UNIQUE (action,document_id,product_id)
);
ALTER TABLE private.stock_history_online_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_online_deductions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_online_deductions_immutable BEFORE UPDATE OR DELETE ON private.stock_history_online_deductions
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();
CREATE TRIGGER stock_online_deductions_no_truncate BEFORE TRUNCATE ON private.stock_history_online_deductions
 FOR EACH STATEMENT EXECUTE FUNCTION private.stock_history_immutable();

-- The actual write path supplies a closed document, actor and bounded line
-- scope. Match each exact receipt and one real product change in this write
-- transaction. No historical bill timestamp can enter a stock time field.
CREATE FUNCTION private.stock_history_observe_online_deductions(p_action text,p_document uuid,p_branch text,p_actor uuid,
 p_terminal text,p_reference text,p_document_recorded timestamptz,p_lines jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE line jsonb; product uuid; expected numeric; receipt uuid; effect uuid; matches bigint;
 tx bigint:=txid_current(); bound_effects uuid[]:=ARRAY[]::uuid[]; bound_receipts uuid[]:=ARRAY[]::uuid[];
BEGIN
 IF p_action NOT IN ('SPONSORSHIP_ISSUE','MISSED_BILL') OR p_document IS NULL OR p_actor IS NULL OR p_document_recorded IS NULL
  OR p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128 OR btrim(p_branch)<>p_branch
  OR p_reference IS NULL OR length(p_reference) NOT BETWEEN 1 AND 450
  OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
  OR octet_length(p_lines::text)>84000
  OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND (CASE WHEN p_action='SPONSORSHIP_ISSUE' THEN 100 ELSE 500 END)
 THEN RETURN; END IF;
 IF (SELECT count(DISTINCT value->>'productId') FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RETURN; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF (line->>'quantity') IS NULL OR (line->>'quantity')!~'^[1-9][0-9]{0,9}$' THEN RETURN; END IF;
  product:=(line->>'productId')::uuid;
  expected:=-(line->>'quantity')::numeric;
  receipt:=md5(CASE WHEN p_action='SPONSORSHIP_ISSUE' THEN 'sponsorship:'||p_document::text||':'||product::text
    ELSE p_document::text||':stock:'||product::text END)::uuid;
  IF NOT EXISTS (SELECT 1 FROM private.stock_history_source_receipts r WHERE r.movement_id=receipt AND r.transaction_id=tx
     AND r.product_id=product AND r.store_id COLLATE "C"=p_branch COLLATE "C" AND r.quantity_delta=expected)
   OR (SELECT count(*) FROM (SELECT 1 FROM private.stock_history_source_receipts r WHERE r.transaction_id=tx
     AND r.product_id=product AND r.store_id=p_branch AND r.store_id COLLATE "C"=p_branch COLLATE "C" AND r.quantity_delta=expected LIMIT 2) exact_receipts)<>1
   OR NOT EXISTS (SELECT 1 FROM public.item_activity_logs l WHERE l.id=receipt AND l.product_id=product
     AND l.store_id COLLATE "C"=p_branch COLLATE "C" AND l.activity_type='adjustment' AND l.reference COLLATE "C"=p_reference COLLATE "C"
     AND l.quantity_delta=expected) THEN RETURN; END IF;
  SELECT count(*),(array_agg(e.id))[1] INTO matches,effect FROM (
   SELECT v.id FROM private.stock_history_accepted_effects v WHERE v.transaction_id=tx AND v.product_id=product
    AND v.store_id=p_branch AND v.store_id COLLATE "C"=p_branch COLLATE "C" AND v.operation='UPDATE' AND v.quantity_delta=expected LIMIT 2
  ) e;
  IF matches<>1 THEN RETURN; END IF;
  IF p_action='SPONSORSHIP_ISSUE' AND NOT EXISTS (
   SELECT 1 FROM public.stock_adjustments a JOIN private.stock_history_accepted_effects v ON v.id=effect
   WHERE a.id=receipt AND a.product_id=product AND a.store_id COLLATE "C"=p_branch COLLATE "C" AND a.reason='sponsorship'
    AND a.delta=v.quantity_delta AND a.previous_stock=v.previous_quantity AND a.updated_stock=v.next_quantity
  ) THEN RETURN; END IF;
  bound_effects:=array_append(bound_effects,effect);
  bound_receipts:=array_append(bound_receipts,receipt);
 END LOOP;
 -- Persist the whole document or none. This neither consumes ledger coverage
 -- nor touches any POS journal, financial receipt, or stock row.
 INSERT INTO private.stock_history_online_deductions(effect_id,receipt_id,action,document_id,product_id,store_id,actor_id,
  terminal_id,quantity_delta,transaction_id,document_recorded_at,stock_observed_at)
 SELECT e.id,matched.receipt,p_action,p_document,e.product_id,p_branch,p_actor,p_terminal,e.quantity_delta,tx,p_document_recorded,e.accepted_at
 FROM unnest(bound_effects,bound_receipts) matched(effect,receipt) JOIN private.stock_history_accepted_effects e ON e.id=matched.effect;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_observe_online_deductions(text,uuid,text,uuid,text,text,timestamptz,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_observe_sponsorship_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid; lines jsonb;
BEGIN
 IF OLD.status<>'requested' OR NEW.status<>'issued' OR NEW.given_at IS DISTINCT FROM transaction_timestamp()
  OR ROW(OLD.id,OLD.store_id,OLD.document_hash,OLD.lines,OLD.reference) IS DISTINCT FROM ROW(NEW.id,NEW.store_id,NEW.document_hash,NEW.lines,NEW.reference)
  OR NEW.authorization_mode NOT IN ('direct','approval') OR NEW.authorization_mode IS NULL
  OR jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.lines) NOT BETWEEN 1 AND 100
 THEN RETURN NULL; END IF;
 SELECT person.id INTO STRICT actor FROM public.app_users person WHERE person.user_id COLLATE "C"=NEW.given_by COLLATE "C"
  AND person.is_active AND (person.store_id IS NULL OR person.store_id COLLATE "C"=NEW.store_id COLLATE "C")
  AND (person.role::text='admin' OR (person.permissions->>'can_issue_sponsorship'='true' AND COALESCE(person.permissions->>'page:sponsorship','true')<>'false'));
 SELECT jsonb_agg(jsonb_build_object('productId',item->>'product_id','quantity',item->>'quantity')) INTO lines FROM jsonb_array_elements(NEW.lines) item;
 PERFORM private.stock_history_observe_online_deductions('SPONSORSHIP_ISSUE',NEW.id,NEW.store_id,actor,NULL,NEW.reference,NEW.given_at,lines);
 RETURN NULL;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
 -- Optional metadata cannot veto a handover. Unproved accepted effects
 -- remain unresolved in the existing stock-history coverage guard.
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_observe_sponsorship_issue() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_sponsorship_deduction AFTER UPDATE ON public.sponsorship_issues FOR EACH ROW
 WHEN (OLD.status='requested' AND NEW.status='issued') EXECUTE FUNCTION private.stock_history_observe_sponsorship_issue();

CREATE FUNCTION private.stock_history_observe_missed_bill_deduction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid; lines jsonb; requested jsonb; receipt text:='MB-'||NEW.id::text;
BEGIN
 IF NEW.stock_handling IS DISTINCT FROM 'deduct' OR NEW.sale_id IS DISTINCT FROM NEW.id OR NEW.entered_at IS DISTINCT FROM transaction_timestamp()
  OR NEW.request_value->>'actor' IS DISTINCT FROM NEW.actor_id OR (NEW.request_value->'entry'->>'clientKey')::uuid IS DISTINCT FROM NEW.id
  OR btrim(NEW.request_value->'entry'->>'storeId') COLLATE "C" IS DISTINCT FROM NEW.store_id COLLATE "C"
  OR NEW.request_value->'entry'->>'stockHandling' IS DISTINCT FROM 'deduct'
  OR jsonb_typeof(NEW.request_value->'entry'->'items') IS DISTINCT FROM 'array'
  OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=NEW.sale_id AND s.store_id COLLATE "C"=NEW.store_id COLLATE "C"
   AND s.shift_id IS NULL AND s.bill_number=receipt AND s.client_transaction_id='missed:'||NEW.id::text
   AND s.created_by COLLATE "C"=NEW.actor_id COLLATE "C" AND s.created_at=NEW.occurred_at)
 THEN RETURN NULL; END IF;
 IF jsonb_array_length(NEW.request_value->'entry'->'items') NOT BETWEEN 1 AND 500 THEN RETURN NULL; END IF;
 SELECT person.id INTO STRICT actor FROM public.app_users person WHERE person.user_id COLLATE "C"=NEW.actor_id COLLATE "C"
  AND person.is_active AND (NULLIF(person.store_id,'') IS NULL OR lower(person.store_id)=lower(NEW.store_id))
  AND (person.role::text='admin' OR person.role_slug='admin');
 SELECT jsonb_agg(jsonb_build_object('productId',item.product_id,'quantity',item.quantity) ORDER BY item.product_id) INTO lines FROM (
  SELECT si.product_id,si.quantity FROM public.sale_items si WHERE si.sale_id=NEW.sale_id AND si.branch_id COLLATE "C"=NEW.store_id COLLATE "C" LIMIT 501
 ) item;
 SELECT jsonb_agg(jsonb_build_object('productId',(line->>'productId')::uuid,'quantity',line->'quantity') ORDER BY (line->>'productId')::uuid)
 INTO requested FROM jsonb_array_elements(NEW.request_value->'entry'->'items') line;
 IF lines IS DISTINCT FROM requested THEN RETURN NULL; END IF;
 PERFORM private.stock_history_observe_online_deductions('MISSED_BILL',NEW.id,NEW.store_id,actor,NEW.terminal_id,receipt,NEW.entered_at,lines);
 RETURN NULL;
EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_observe_missed_bill_deduction() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_missed_bill_deduction AFTER INSERT ON public.missed_bill_entries FOR EACH ROW
 WHEN (NEW.stock_handling='deduct') EXECUTE FUNCTION private.stock_history_observe_missed_bill_deduction();

COMMIT;
