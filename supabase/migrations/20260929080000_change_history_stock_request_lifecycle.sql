-- Append-only history for mutable product/configuration records and automatic
-- stock request/transfer lifecycle history. Apply only after the production
-- backup and validation preflight documented in docs/audit/system-sync-architecture.md.

CREATE TABLE IF NOT EXISTS public.change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL DEFAULT 'default',
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  old_value jsonb,
  new_value jsonb,
  revision bigint NOT NULL,
  scope_type text NOT NULL DEFAULT 'GLOBAL',
  scope_id text,
  changed_by text,
  source_application text NOT NULL DEFAULT 'web',
  device_id text,
  terminal_id text,
  server_timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_history_entity_idx
  ON public.change_history(entity_type,entity_id,revision DESC);
CREATE INDEX IF NOT EXISTS change_history_scope_idx
  ON public.change_history(organization_id,scope_type,scope_id,server_timestamp DESC);
ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.change_history FROM anon,authenticated;
GRANT SELECT ON public.change_history TO authenticated;
GRANT ALL ON public.change_history TO service_role;
DROP POLICY IF EXISTS "Auditors read applicable change history" ON public.change_history;
CREATE POLICY "Auditors read applicable change history" ON public.change_history FOR SELECT TO authenticated
  USING (public.has_perm('can_view_audit_trail') AND (
    upper(scope_type)='GLOBAL'
    OR (upper(scope_type)='BRANCH' AND public.store_visible(scope_id))
    OR (upper(scope_type)='TERMINAL' AND EXISTS(
      SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=scope_id AND public.store_visible(t.location_id)
    ))
  ));

CREATE OR REPLACE FUNCTION public.change_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'change_history is append-only'; END $fn$;
DROP TRIGGER IF EXISTS change_history_no_change ON public.change_history;
CREATE TRIGGER change_history_no_change BEFORE UPDATE OR DELETE ON public.change_history
  FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();

CREATE OR REPLACE FUNCTION public.record_product_master_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_old jsonb; v_new jsonb; v_owner text; v_revision bigint;
BEGIN
  v_old:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD)-'stock_quantity'-'stock_by_store' END;
  v_new:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW)-'stock_quantity'-'stock_by_store' END;
  IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  v_owner:=COALESCE(NEW.owner_store_id,OLD.owner_store_id);
  v_revision:=COALESCE(NEW.row_version,OLD.row_version,1);
  INSERT INTO public.change_history(
    entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,
    changed_by,source_application,device_id,terminal_id)
  VALUES('products',COALESCE(NEW.id,OLD.id)::text,lower(TG_OP),v_old,v_new,v_revision,
    CASE WHEN NULLIF(v_owner,'') IS NULL THEN 'GLOBAL' ELSE 'BRANCH' END,NULLIF(v_owner,''),
    NULLIF(current_setting('pos.updated_by',true),''),
    COALESCE(NULLIF(current_setting('pos.source_application',true),''),'web'),
    NULLIF(current_setting('pos.device_id',true),''),NULLIF(current_setting('pos.sync_terminal',true),''));
  RETURN COALESCE(NEW,OLD);
END $fn$;
DROP TRIGGER IF EXISTS products_change_history ON public.products;
CREATE TRIGGER products_change_history AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.record_product_master_history();

CREATE OR REPLACE FUNCTION public.record_scoped_setting_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_old jsonb; v_new jsonb; v_row jsonb; v_scope text; v_scope_id text; v_revision bigint; v_entity_id text;
BEGIN
  v_old:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  v_row:=COALESCE(v_new,v_old);
  v_scope:=upper(COALESCE(v_row->>'scope','GLOBAL'));
  v_scope_id:=NULLIF(v_row->>'scope_id','');
  v_revision:=COALESCE((v_row->>'row_version')::bigint,1);
  v_entity_id:=concat_ws(':',v_scope,COALESCE(v_scope_id,''),COALESCE(v_row->>'section',v_row->>'key',''));
  INSERT INTO public.change_history(
    entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,
    changed_by,source_application,device_id,terminal_id)
  VALUES(TG_TABLE_NAME,v_entity_id,lower(TG_OP),v_old,v_new,v_revision,v_scope,v_scope_id,
    COALESCE(v_row->>'updated_by',NULLIF(current_setting('pos.updated_by',true),'')),
    COALESCE(NULLIF(current_setting('pos.source_application',true),''),'web'),
    NULLIF(current_setting('pos.device_id',true),''),NULLIF(current_setting('pos.sync_terminal',true),''));
  RETURN COALESCE(NEW,OLD);
END $fn$;
DROP TRIGGER IF EXISTS settings_overrides_change_history ON public.settings_overrides;
CREATE TRIGGER settings_overrides_change_history AFTER INSERT OR UPDATE OR DELETE ON public.settings_overrides
  FOR EACH ROW EXECUTE FUNCTION public.record_scoped_setting_history();
DROP TRIGGER IF EXISTS settings_scoped_change_history ON public.settings_scoped;
CREATE TRIGGER settings_scoped_change_history AFTER INSERT OR UPDATE OR DELETE ON public.settings_scoped
  FOR EACH ROW EXECUTE FUNCTION public.record_scoped_setting_history();

CREATE OR REPLACE FUNCTION public.record_stock_transfer_status_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor text; v_reason text; v_branch text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  v_actor:=CASE NEW.status
    WHEN 'approved' THEN NEW.approved_by WHEN 'rejected' THEN NEW.rejected_by
    WHEN 'dispatched' THEN NEW.dispatched_by WHEN 'received' THEN NEW.received_by
    WHEN 'verified' THEN NEW.verified_by WHEN 'completed' THEN NEW.verified_by
    WHEN 'completed_with_discrepancy' THEN NEW.verified_by ELSE NEW.created_by END;
  v_reason:=COALESCE(NEW.rejected_reason,NEW.cancelled_reason,NEW.discrepancy_reason);
  FOREACH v_branch IN ARRAY ARRAY[NEW.from_store_id,NEW.to_store_id] LOOP
    INSERT INTO public.entity_status_history(
      entity_type,entity_id,status_kind,previous_status,new_status,reason,actor_name,
      store_id,branch_id,related_entity_type,related_entity_id,metadata,client_event_id,row_version)
    VALUES('stock_transfer',NEW.id::text,
      CASE WHEN NEW.kind='request' THEN 'request_status' ELSE 'transfer_status' END,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,v_reason,v_actor,
      v_branch,v_branch,'branch',CASE WHEN v_branch=NEW.from_store_id THEN NEW.to_store_id ELSE NEW.from_store_id END,
      jsonb_build_object('ref',NEW.ref,'kind',NEW.kind,'from_store_id',NEW.from_store_id,'to_store_id',NEW.to_store_id),
      concat('stock_transfer:',NEW.id,':',NEW.status,':',v_branch,':',NEW.row_version),NEW.row_version)
    ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING;
  END LOOP;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS stock_transfers_status_history ON public.stock_transfers;
CREATE TRIGGER stock_transfers_status_history AFTER INSERT OR UPDATE OF status ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.record_stock_transfer_status_history();

REVOKE ALL ON FUNCTION public.record_product_master_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_scoped_setting_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_stock_transfer_status_history() FROM PUBLIC,anon,authenticated;
