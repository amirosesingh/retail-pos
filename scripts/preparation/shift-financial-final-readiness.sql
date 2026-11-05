-- PREPARATION ONLY. Install after all protected aliases; no live execution.
BEGIN;
-- pg_get_functiondef formats referenced types according to search_path. Capture
-- under the same fixed path used by the verifier, otherwise valid definitions
-- with composite return types are incorrectly classified as changed.
SET LOCAL search_path=pg_catalog;
CREATE TABLE fin62_live_preparation.contract_pins(signature text PRIMARY KEY,digest text NOT NULL,owner_oid oid NOT NULL,security_definer boolean NOT NULL,acl text,configuration text[]);
ALTER TABLE fin62_live_preparation.contract_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_live_preparation.contract_pins FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_live_preparation.contract_pins FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
-- Owner-only inspection also works during a migration without an HTTP JWT.
-- Public callers still pass the unchanged service-role check below.
CREATE FUNCTION fin62_live_preparation.installation_ready() RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ready boolean;
BEGIN
 SELECT count(*)=49 AND bool_and(r.oid IS NOT NULL AND p.digest=md5(pg_get_functiondef(r.oid)) AND p.owner_oid=r.proowner AND p.security_definer=r.prosecdef AND p.acl IS NOT DISTINCT FROM r.proacl::text AND p.configuration IS NOT DISTINCT FROM r.proconfig) INTO ready
 FROM fin62_live_preparation.contract_pins p LEFT JOIN pg_proc r ON r.oid=to_regprocedure(p.signature);
 ready:=coalesce(ready,false) AND NOT EXISTS(
  SELECT 1 FROM unnest(ARRAY['fin62_history_preparation.live_context','fin62_history_preparation.graph_context','fin62_history_preparation.protected_shifts','fin62_history_preparation.sale_birth_claims','fin62_web_preparation.actions','fin62_web_preparation.active_actions','fin62_live_preparation.receipts','fin62_live_preparation.contract_pins','fin62_admin_preparation.context','fin62_admin_preparation.receipts','fin62_rollout_preparation.approvals']) name
  LEFT JOIN pg_class c ON c.oid=to_regclass(name) WHERE c.oid IS NULL OR NOT c.relrowsecurity OR c.relowner<>'postgres'::regrole OR has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'));
 ready:=ready AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='fin62_rollout_preparation.approvals'::regclass AND tgname='immutable' AND tgenabled='O' AND tgfoid='fin62_history_preparation.immutable()'::regprocedure);
 RETURN coalesce(ready,false);
END $$;
REVOKE ALL ON FUNCTION fin62_live_preparation.installation_ready() FROM PUBLIC,anon,authenticated,service_role;
DO $ready_install$
DECLARE signature text;routine oid;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'fin62_live_preparation.installation_ready()','public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)','public.sale_refund(uuid,jsonb,text,text,text)',
 'public.shift_close_start(uuid,text,text)','public.shift_variance_approve(uuid,text)',
 'public.shift_cash_count_submit(uuid,numeric,numeric,numeric,text,text)','public.shift_recount_submit(uuid,numeric,text,numeric,numeric,text)',
 'public.shift_reconcile_now(uuid,uuid,numeric,numeric,numeric)','public.pos_admin_correct_closed_shift(uuid,numeric,numeric,numeric,text,text,text,text,text)',
 'fin62_web_preparation.capture_expected(uuid,uuid,text)','fin62_web_preparation.begin_graph(uuid,text)',
 'fin62_history_preparation.block_unintegrated_write()','fin62_history_preparation.guard_shift_graph()',
 'public.pos_live_financial_sale(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)','public.pos_live_financial_refund(uuid,text,text,uuid,jsonb,text,text)',
 'fin62_preparation.validate_financial_math_text(text)',
 'fin62_live_preparation.authorize(uuid,text,text,text)','fin62_live_preparation.organization(text,uuid)',
 'fin62_live_preparation.proves_later_publication(text,text,uuid,uuid,jsonb,jsonb)','fin62_live_preparation.publication_edges(text,text,uuid,uuid)',
 'fin62_history_preparation.live_row_allowed(text,jsonb,jsonb)',
 'fin62_web_preparation.end_action(uuid,uuid)','fin62_web_preparation.action_expected(uuid,uuid)',
 'fin62_web_preparation.end_graph(uuid,text,boolean)','fin62_web_preparation.validate_counted(numeric,numeric,numeric)',
 'public.pos_live_financial_admin_correct_sale(uuid,uuid,text,integer,jsonb,jsonb,text,text,uuid)','public.pos_live_financial_admin_correct_tender(uuid,uuid,text,text,text)','public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text)','fin62_admin_preparation.authorize(uuid,text,text)','fin62_admin_preparation.row_allowed(text,jsonb,jsonb)','fin62_admin_preparation.publication_edges(text,text,uuid,uuid)','fin62_admin_preparation.proves_publication(text,text,uuid,uuid,jsonb,jsonb)','fin62_history_preparation.published_later_fact(text,text,uuid,uuid,jsonb,jsonb)','fin62_history_preparation.ensure_stream(text,text,text,uuid,jsonb)','public.pos_sync_financial_capability(text,text,text,uuid)','fin62_rollout_preparation.assert_approved(text,text,text)','fin62_history_preparation.immutable()','public.pos_sync_register_financial_event(text,text,text,text,jsonb)','public.pos_sync_register_financial_boundary(text,text,text,text,jsonb,jsonb)','public.pos_sync_register_financial_open(uuid,text,text,text,uuid,text,text,jsonb,text,jsonb)','public.pos_sync_push_financial_business_aggregate(uuid,text,text,text,jsonb)','public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','public.pos_sync_read_financial_basis(text,text,text,uuid)','public.pos_sync_register_financial_observation(text,text,text,text)','fin62_history_preparation.current_author(text,text,jsonb,text,uuid,text)','fin62_rollout_preparation.cohort_approved(text,text,text)','fin62_cloud_preparation.fact_payment(jsonb)','fin62_cloud_preparation.financial_fact(jsonb)','fin62_cloud_preparation.snapshot_financial_fact(jsonb)'] LOOP
  routine:=to_regprocedure(signature);IF routine IS NULL THEN RAISE EXCEPTION 'FIN62_LIVE_DEPENDENCY_MISSING: %',signature;END IF;
  INSERT INTO fin62_live_preparation.contract_pins SELECT signature,md5(pg_get_functiondef(oid)),proowner,prosecdef,proacl::text,proconfig FROM pg_proc WHERE oid=routine;
 END LOOP;
 IF strpos(pg_get_functiondef('public.shift_close_start(uuid,text,text)'::regprocedure),'fin62_web_preparation.begin_graph')=0 OR strpos(pg_get_functiondef('public.shift_variance_approve(uuid,text)'::regprocedure),'fin62_web_preparation.begin_graph')=0 THEN RAISE EXCEPTION 'FIN62_LIVE_WEB_CONTEXT_MISSING';END IF;
END $ready_install$;
CREATE OR REPLACE FUNCTION public.pos_live_financial_ready() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_LIVE_SERVICE_REQUIRED';END IF;
 RETURN jsonb_build_object('ready',fin62_live_preparation.installation_ready(),'version',2);
END $$;
REVOKE ALL ON FUNCTION public.pos_live_financial_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_live_financial_ready() TO service_role;
COMMIT;
