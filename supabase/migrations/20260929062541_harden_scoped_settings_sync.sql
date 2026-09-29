ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.settings_scoped ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.preserve_or_bump_row_version() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  NEW.row_version := GREATEST(COALESCE(NEW.row_version,0),COALESCE(OLD.row_version,0)+1);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS settings_overrides_bump_row_version ON public.settings_overrides;
CREATE TRIGGER settings_overrides_bump_row_version BEFORE UPDATE ON public.settings_overrides FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();
DROP TRIGGER IF EXISTS settings_scoped_bump_row_version ON public.settings_scoped;
CREATE TRIGGER settings_scoped_bump_row_version BEFORE UPDATE ON public.settings_scoped FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();

-- Scoped synchronization and RLS hardening. Keep this immediately before the
-- generated sync contract so canonical regeneration cannot weaken it.
CREATE OR REPLACE FUNCTION public.settings_scope_visible(p_scope text, p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN auth.uid() IS NOT NULL
    WHEN 'branch' THEN public.store_visible(p_scope_id)
    WHEN 'cluster' THEN EXISTS (
      SELECT 1 FROM public.stores s
      WHERE COALESCE(NULLIF(s.group_id,''),'default')=p_scope_id AND public.store_visible(s.id)
    )
    WHEN 'terminal' THEN EXISTS (
      SELECT 1 FROM public.terminal_tokens t
      WHERE t.id::text=p_scope_id AND public.store_visible(t.location_id)
    )
    WHEN 'private' THEN p_scope_id=public.settings_private_key()
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.settings_scope_manageable(p_scope text, p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN EXISTS (
      SELECT 1 FROM public.app_users u WHERE u.auth_user_id=auth.uid() AND u.is_active=true AND u.role='admin'
    )
    WHEN 'private' THEN p_scope_id=public.settings_private_key()
    ELSE public.is_supervisor_now() AND public.settings_scope_visible(p_scope,p_scope_id)
  END
$$;

REVOKE ALL ON FUNCTION public.settings_scope_visible(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.settings_scope_manageable(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settings_scope_visible(text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settings_scope_manageable(text,text) TO authenticated,service_role;

REVOKE ALL ON TABLE public.settings_overrides FROM anon;
REVOKE ALL ON TABLE public.settings_scoped FROM anon;
GRANT SELECT ON TABLE public.settings_overrides,public.settings_scoped TO authenticated;

DROP POLICY IF EXISTS settings_overrides_private ON public.settings_overrides;
DROP POLICY IF EXISTS settings_overrides_read ON public.settings_overrides;
DROP POLICY IF EXISTS settings_overrides_write ON public.settings_overrides;
CREATE POLICY settings_overrides_read ON public.settings_overrides FOR SELECT TO authenticated
  USING (public.settings_scope_visible(scope,scope_id));
CREATE POLICY settings_overrides_write ON public.settings_overrides FOR ALL TO authenticated
  USING (public.settings_scope_manageable(scope,scope_id))
  WITH CHECK (public.settings_scope_manageable(scope,scope_id));

DROP POLICY IF EXISTS settings_scoped_read ON public.settings_scoped;
DROP POLICY IF EXISTS "Staff read scoped settings" ON public.settings_scoped;
CREATE POLICY settings_scoped_read ON public.settings_scoped FOR SELECT TO authenticated
  USING (public.settings_scope_visible(scope,scope_id));

DROP POLICY IF EXISTS "Staff read pos rules" ON public.pos_store_settings;
DROP POLICY IF EXISTS "Supervisors update rules" ON public.pos_store_settings;
DROP POLICY IF EXISTS "Supervisors write rules" ON public.pos_store_settings;
CREATE POLICY "Supervisors update visible rules" ON public.pos_store_settings FOR UPDATE TO authenticated
  USING (public.is_supervisor_now() AND public.store_visible(store_id))
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));
CREATE POLICY "Supervisors insert visible rules" ON public.pos_store_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Staff read authorisation rules" ON public.authorization_actions;
CREATE POLICY "Staff read authorisation rules" ON public.authorization_actions FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.settings_scope_visible(scope_type,scope_id));
DROP POLICY IF EXISTS "Staff read authorisation rule history" ON public.authorization_action_history;
CREATE POLICY "Staff read authorisation rule history" ON public.authorization_action_history FOR SELECT TO authenticated
  USING (public.is_staff_now() AND public.settings_scope_visible(scope_type,scope_id));

DROP POLICY IF EXISTS terminal_commands_staff_read ON public.terminal_commands;
DROP POLICY IF EXISTS terminal_commands_staff_update ON public.terminal_commands;
DROP POLICY IF EXISTS terminal_commands_staff_write ON public.terminal_commands;
DROP POLICY IF EXISTS "Staff read commands" ON public.terminal_commands;
DROP POLICY IF EXISTS "Staff complete commands" ON public.terminal_commands;
DROP POLICY IF EXISTS "Supervisors issue commands" ON public.terminal_commands;
CREATE POLICY terminal_commands_branch_read ON public.terminal_commands FOR SELECT TO authenticated
  USING (public.store_visible(store_id));
CREATE POLICY terminal_commands_branch_update ON public.terminal_commands FOR UPDATE TO authenticated
  USING (public.store_visible(store_id)) WITH CHECK (public.store_visible(store_id));
CREATE POLICY terminal_commands_branch_insert ON public.terminal_commands FOR INSERT TO authenticated
  WITH CHECK (public.is_supervisor_now() AND public.store_visible(store_id));

-- SQLSERVER_SYNC_CONTRACT_BEGIN

CREATE TABLE IF NOT EXISTS public.sync_idempotency_receipts (
 batch_id uuid PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL, table_name text NOT NULL,
 payload_hash text NOT NULL DEFAULT '', applied_count integer NOT NULL DEFAULT 0, applied_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE public.sync_idempotency_receipts ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.sync_change_feed (
 cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL,
 terminal_id text,
 table_name text NOT NULL, entity_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('insert','update','delete')),
 row_version bigint NOT NULL DEFAULT 1, tombstone boolean NOT NULL DEFAULT false, changed_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS sync_change_feed_branch_cursor_idx ON public.sync_change_feed(organization_id,branch_id,cursor);

ALTER TABLE public.sync_change_feed ADD COLUMN IF NOT EXISTS terminal_id text;

ALTER TABLE public.sync_idempotency_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sync_change_feed ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pos_sync_validate_scope(p_organization_id text,p_branch_id text,p_terminal_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF p_organization_id IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'SYNC_ORGANIZATION_FORBIDDEN'; END IF;
 IF NULLIF(btrim(p_branch_id),'') IS NULL OR NULLIF(btrim(p_terminal_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id AND t.status='active' AND t.revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_validate_scope(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_validate_scope(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_apply_coupon_campaigns(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."coupon_campaigns" ("id","name","slug","discount_type","discount_value","scope","scope_value","max_claims","max_per_member","claims_count","starts_at","expires_at","is_active","is_welcome","created_at","updated_at","row_version")
  SELECT "id","name","slug","discount_type","discount_value","scope","scope_value","max_claims","max_per_member","claims_count","starts_at","expires_at","is_active","is_welcome","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."coupon_campaigns", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","slug"=EXCLUDED."slug","discount_type"=EXCLUDED."discount_type","discount_value"=EXCLUDED."discount_value","scope"=EXCLUDED."scope","scope_value"=EXCLUDED."scope_value","max_claims"=EXCLUDED."max_claims","max_per_member"=EXCLUDED."max_per_member","claims_count"=EXCLUDED."claims_count","starts_at"=EXCLUDED."starts_at","expires_at"=EXCLUDED."expires_at","is_active"=EXCLUDED."is_active","is_welcome"=EXCLUDED."is_welcome","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."coupon_campaigns"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_coupon_campaigns(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."coupon_campaigns" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_coupon_campaigns(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_coupon_campaigns(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_coupon_campaigns() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'coupon_campaigns',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."coupon_campaigns";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."coupon_campaigns" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_coupon_campaigns();

REVOKE ALL ON FUNCTION public.sync_feed_coupon_campaigns() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shifts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shifts" ("id","store_id","terminal_id","terminal_name","opened_by_name","opened_by_staff_id","opened_by_role","closed_by_name","closed_by_staff_id","closed_by_role","opened_at","closed_at","opening_float","counted_cash","expected_cash","note","overdue","created_at","updated_at","status","closing_float","user_id","row_version","counted_card","counted_digital","expected_card","expected_digital","variance_cash","variance_card","variance_digital","variance_total","state","close_reason","closing_started_at","closing_started_by","final_counted_cash","variance_status")
  SELECT "id","store_id","terminal_id","terminal_name","opened_by_name","opened_by_staff_id","opened_by_role","closed_by_name","closed_by_staff_id","closed_by_role","opened_at","closed_at","opening_float","counted_cash","expected_cash","note","overdue","created_at","updated_at","status","closing_float","user_id","row_version","counted_card","counted_digital","expected_card","expected_digital","variance_cash","variance_card","variance_digital","variance_total","state","close_reason","closing_started_at","closing_started_by","final_counted_cash","variance_status" FROM jsonb_populate_recordset(NULL::public."shifts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","terminal_name"=EXCLUDED."terminal_name","opened_by_name"=EXCLUDED."opened_by_name","opened_by_staff_id"=EXCLUDED."opened_by_staff_id","opened_by_role"=EXCLUDED."opened_by_role","closed_by_name"=EXCLUDED."closed_by_name","closed_by_staff_id"=EXCLUDED."closed_by_staff_id","closed_by_role"=EXCLUDED."closed_by_role","opened_at"=EXCLUDED."opened_at","closed_at"=EXCLUDED."closed_at","opening_float"=EXCLUDED."opening_float","counted_cash"=EXCLUDED."counted_cash","expected_cash"=EXCLUDED."expected_cash","note"=EXCLUDED."note","overdue"=EXCLUDED."overdue","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","status"=EXCLUDED."status","closing_float"=EXCLUDED."closing_float","user_id"=EXCLUDED."user_id","row_version"=EXCLUDED."row_version","counted_card"=EXCLUDED."counted_card","counted_digital"=EXCLUDED."counted_digital","expected_card"=EXCLUDED."expected_card","expected_digital"=EXCLUDED."expected_digital","variance_cash"=EXCLUDED."variance_cash","variance_card"=EXCLUDED."variance_card","variance_digital"=EXCLUDED."variance_digital","variance_total"=EXCLUDED."variance_total","state"=EXCLUDED."state","close_reason"=EXCLUDED."close_reason","closing_started_at"=EXCLUDED."closing_started_at","closing_started_by"=EXCLUDED."closing_started_by","final_counted_cash"=EXCLUDED."final_counted_cash","variance_status"=EXCLUDED."variance_status" WHERE EXCLUDED."row_version">public."shifts"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shifts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shifts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shifts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shifts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shifts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shifts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shifts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shifts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shifts();

REVOKE ALL ON FUNCTION public.sync_feed_shifts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_issued_vouchers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."issued_vouchers" ("id","token_slug","campaign_id","member_id","status","issued_at","expires_at","issued_by","issued_source","redeemed_at","redeemed_by","redeemed_sale_id","disabled_at","disabled_by","disable_reason","store_id","row_version")
  SELECT "id","token_slug","campaign_id","member_id","status","issued_at","expires_at","issued_by","issued_source","redeemed_at","redeemed_by","redeemed_sale_id","disabled_at","disabled_by","disable_reason","store_id","row_version" FROM jsonb_populate_recordset(NULL::public."issued_vouchers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "token_slug"=EXCLUDED."token_slug","campaign_id"=EXCLUDED."campaign_id","member_id"=EXCLUDED."member_id","status"=EXCLUDED."status","issued_at"=EXCLUDED."issued_at","expires_at"=EXCLUDED."expires_at","issued_by"=EXCLUDED."issued_by","issued_source"=EXCLUDED."issued_source","redeemed_at"=EXCLUDED."redeemed_at","redeemed_by"=EXCLUDED."redeemed_by","redeemed_sale_id"=EXCLUDED."redeemed_sale_id","disabled_at"=EXCLUDED."disabled_at","disabled_by"=EXCLUDED."disabled_by","disable_reason"=EXCLUDED."disable_reason","store_id"=EXCLUDED."store_id","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."issued_vouchers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_issued_vouchers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."issued_vouchers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_issued_vouchers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_issued_vouchers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_issued_vouchers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'issued_vouchers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."issued_vouchers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."issued_vouchers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_issued_vouchers();

REVOKE ALL ON FUNCTION public.sync_feed_issued_vouchers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_activity_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."activity_events" ("id","event_type","severity","title","message","actor_id","actor_name","actor_role","terminal_id","terminal_name","store_id","entity_type","entity_id","amount","meta","whatsapp_status","whatsapp_error","client_event_id","created_at","previous_state","new_state","cleared_by","branch_id")
  SELECT "id","event_type","severity","title","message","actor_id","actor_name","actor_role","terminal_id","terminal_name","store_id","entity_type","entity_id","amount","meta","whatsapp_status","whatsapp_error","client_event_id","created_at","previous_state","new_state","cleared_by","branch_id" FROM jsonb_populate_recordset(NULL::public."activity_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "cleared_by"=EXCLUDED."cleared_by";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_activity_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."activity_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_activity_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_activity_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_activity_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'activity_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."activity_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."activity_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_activity_events();

REVOKE ALL ON FUNCTION public.sync_feed_activity_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_app_users(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."app_users" ("id","user_id","full_name","email","role","store_id","is_active","permissions","pin_hash","auth_user_id","last_login_at","created_at","updated_at","role_slug","pin_length","row_version","pin_set_at","pin_updated_by","auth_secret","idle_timeout_minutes")
  SELECT "id","user_id","full_name","email","role","store_id","is_active","permissions","pin_hash","auth_user_id","last_login_at","created_at","updated_at","role_slug","pin_length","row_version","pin_set_at","pin_updated_by","auth_secret","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."app_users", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_id"=EXCLUDED."user_id","full_name"=EXCLUDED."full_name","email"=EXCLUDED."email","role"=EXCLUDED."role","store_id"=EXCLUDED."store_id","is_active"=EXCLUDED."is_active","permissions"=EXCLUDED."permissions","pin_hash"=EXCLUDED."pin_hash","auth_user_id"=EXCLUDED."auth_user_id","last_login_at"=EXCLUDED."last_login_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","role_slug"=EXCLUDED."role_slug","pin_length"=EXCLUDED."pin_length","row_version"=EXCLUDED."row_version","pin_set_at"=EXCLUDED."pin_set_at","pin_updated_by"=EXCLUDED."pin_updated_by","auth_secret"=EXCLUDED."auth_secret","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes" WHERE EXCLUDED."row_version">public."app_users"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_app_users(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."app_users" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_app_users(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_app_users(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_app_users() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'app_users',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."app_users";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."app_users" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_app_users();

REVOKE ALL ON FUNCTION public.sync_feed_app_users() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_audit_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."audit_logs" ("id","user_name","action_category","action_name","target_module","details","created_at","user_id","action","entity","before_state","after_state","store_id")
  SELECT "id","user_name","action_category","action_name","target_module","details","created_at","user_id","action","entity","before_state","after_state","store_id" FROM jsonb_populate_recordset(NULL::public."audit_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_name"=EXCLUDED."user_name","action_category"=EXCLUDED."action_category","action_name"=EXCLUDED."action_name","target_module"=EXCLUDED."target_module","details"=EXCLUDED."details","created_at"=EXCLUDED."created_at","user_id"=EXCLUDED."user_id","action"=EXCLUDED."action","entity"=EXCLUDED."entity","before_state"=EXCLUDED."before_state","after_state"=EXCLUDED."after_state","store_id"=EXCLUDED."store_id";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_audit_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."audit_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_audit_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_audit_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_audit_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'audit_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."audit_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."audit_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_audit_logs();

REVOKE ALL ON FUNCTION public.sync_feed_audit_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_booking_payments(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."booking_payments" ("id","booking_id","amount","method","cashier","paid_at","created_at","row_version","status","client_payment_id","reference","reversed_at","reversed_by","kind","refund_reason","refunds_payment_id","change_given")
  SELECT "id","booking_id","amount","method","cashier","paid_at","created_at","row_version","status","client_payment_id","reference","reversed_at","reversed_by","kind","refund_reason","refunds_payment_id","change_given" FROM jsonb_populate_recordset(NULL::public."booking_payments", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "booking_id"=EXCLUDED."booking_id","amount"=EXCLUDED."amount","method"=EXCLUDED."method","cashier"=EXCLUDED."cashier","paid_at"=EXCLUDED."paid_at","created_at"=EXCLUDED."created_at","row_version"=EXCLUDED."row_version","status"=EXCLUDED."status","client_payment_id"=EXCLUDED."client_payment_id","reference"=EXCLUDED."reference","reversed_at"=EXCLUDED."reversed_at","reversed_by"=EXCLUDED."reversed_by","kind"=EXCLUDED."kind","refund_reason"=EXCLUDED."refund_reason","refunds_payment_id"=EXCLUDED."refunds_payment_id","change_given"=EXCLUDED."change_given" WHERE EXCLUDED."row_version">public."booking_payments"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_booking_payments(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."booking_payments" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_booking_payments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_booking_payments(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_booking_payments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'booking_payments',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT p.store_id::text branch_id,NULL::text terminal_id FROM public."bookings" p WHERE p."id"::text=COALESCE(NEW."booking_id",OLD."booking_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."booking_payments";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."booking_payments" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_booking_payments();

REVOKE ALL ON FUNCTION public.sync_feed_booking_payments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_bookings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."bookings" ("id","ref","store_id","shift_id","customer_name","customer_phone","member_id","service_type_id","service_name","service_fee","payment_timing","lines","subtotal","discount","tax","total","paid","due_date","note","cashier","status","sale_receipt_no","closed_at","racket_model","string_type","tension_main","tension_cross","tension_unit","grommet_notes","job_notes","dropped_off_at","promised_at","job_status","job_status_by","job_status_at","notify_whatsapp","created_at","updated_at","tag_id","intake_note","string_origin","string_source_product_id","grip_product_id","charges","technician","liability_accepted","incident_note","row_version","cancel_reason","cancelled_by","cancelled_at","cancelled_terminal","cancel_money_action","booking_ref")
  SELECT "id","ref","store_id","shift_id","customer_name","customer_phone","member_id","service_type_id","service_name","service_fee","payment_timing","lines","subtotal","discount","tax","total","paid","due_date","note","cashier","status","sale_receipt_no","closed_at","racket_model","string_type","tension_main","tension_cross","tension_unit","grommet_notes","job_notes","dropped_off_at","promised_at","job_status","job_status_by","job_status_at","notify_whatsapp","created_at","updated_at","tag_id","intake_note","string_origin","string_source_product_id","grip_product_id","charges","technician","liability_accepted","incident_note","row_version","cancel_reason","cancelled_by","cancelled_at","cancelled_terminal","cancel_money_action","booking_ref" FROM jsonb_populate_recordset(NULL::public."bookings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "ref"=EXCLUDED."ref","store_id"=EXCLUDED."store_id","shift_id"=EXCLUDED."shift_id","customer_name"=EXCLUDED."customer_name","customer_phone"=EXCLUDED."customer_phone","member_id"=EXCLUDED."member_id","service_type_id"=EXCLUDED."service_type_id","service_name"=EXCLUDED."service_name","service_fee"=EXCLUDED."service_fee","payment_timing"=EXCLUDED."payment_timing","lines"=EXCLUDED."lines","subtotal"=EXCLUDED."subtotal","discount"=EXCLUDED."discount","tax"=EXCLUDED."tax","total"=EXCLUDED."total","paid"=EXCLUDED."paid","due_date"=EXCLUDED."due_date","note"=EXCLUDED."note","cashier"=EXCLUDED."cashier","status"=EXCLUDED."status","sale_receipt_no"=EXCLUDED."sale_receipt_no","closed_at"=EXCLUDED."closed_at","racket_model"=EXCLUDED."racket_model","string_type"=EXCLUDED."string_type","tension_main"=EXCLUDED."tension_main","tension_cross"=EXCLUDED."tension_cross","tension_unit"=EXCLUDED."tension_unit","grommet_notes"=EXCLUDED."grommet_notes","job_notes"=EXCLUDED."job_notes","dropped_off_at"=EXCLUDED."dropped_off_at","promised_at"=EXCLUDED."promised_at","job_status"=EXCLUDED."job_status","job_status_by"=EXCLUDED."job_status_by","job_status_at"=EXCLUDED."job_status_at","notify_whatsapp"=EXCLUDED."notify_whatsapp","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","tag_id"=EXCLUDED."tag_id","intake_note"=EXCLUDED."intake_note","string_origin"=EXCLUDED."string_origin","string_source_product_id"=EXCLUDED."string_source_product_id","grip_product_id"=EXCLUDED."grip_product_id","charges"=EXCLUDED."charges","technician"=EXCLUDED."technician","liability_accepted"=EXCLUDED."liability_accepted","incident_note"=EXCLUDED."incident_note","row_version"=EXCLUDED."row_version","cancel_reason"=EXCLUDED."cancel_reason","cancelled_by"=EXCLUDED."cancelled_by","cancelled_at"=EXCLUDED."cancelled_at","cancelled_terminal"=EXCLUDED."cancelled_terminal","cancel_money_action"=EXCLUDED."cancel_money_action","booking_ref"=EXCLUDED."booking_ref" WHERE EXCLUDED."row_version">public."bookings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_bookings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."bookings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_bookings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_bookings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_bookings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'bookings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."bookings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."bookings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_bookings();

REVOKE ALL ON FUNCTION public.sync_feed_bookings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_branch_telemetry(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."branch_telemetry" ("terminal_id","store_id","terminal_name","staff_name","staff_role","db_mode","connection_status","storage_engine","pending_count","conflict_count","last_synced_at","app_version","platform","last_seen_at","created_at","updated_at","branch_id","pending_queue_count","last_ping","status","branch_code","session_status","sql_server_state","database_name","schema_version","failed_count","sync_phase","current_table","last_push_at","last_pull_at","device_name","device_type","location_name","last_heartbeat_at")
  SELECT "terminal_id","store_id","terminal_name","staff_name","staff_role","db_mode","connection_status","storage_engine","pending_count","conflict_count","last_synced_at","app_version","platform","last_seen_at","created_at","updated_at","branch_id","pending_queue_count","last_ping","status","branch_code","session_status","sql_server_state","database_name","schema_version","failed_count","sync_phase","current_table","last_push_at","last_pull_at","device_name","device_type","location_name","last_heartbeat_at" FROM jsonb_populate_recordset(NULL::public."branch_telemetry", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("terminal_id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_name"=EXCLUDED."terminal_name","staff_name"=EXCLUDED."staff_name","staff_role"=EXCLUDED."staff_role","db_mode"=EXCLUDED."db_mode","connection_status"=EXCLUDED."connection_status","storage_engine"=EXCLUDED."storage_engine","pending_count"=EXCLUDED."pending_count","conflict_count"=EXCLUDED."conflict_count","last_synced_at"=EXCLUDED."last_synced_at","app_version"=EXCLUDED."app_version","platform"=EXCLUDED."platform","last_seen_at"=EXCLUDED."last_seen_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","branch_id"=EXCLUDED."branch_id","pending_queue_count"=EXCLUDED."pending_queue_count","last_ping"=EXCLUDED."last_ping","status"=EXCLUDED."status","branch_code"=EXCLUDED."branch_code","session_status"=EXCLUDED."session_status","sql_server_state"=EXCLUDED."sql_server_state","database_name"=EXCLUDED."database_name","schema_version"=EXCLUDED."schema_version","failed_count"=EXCLUDED."failed_count","sync_phase"=EXCLUDED."sync_phase","current_table"=EXCLUDED."current_table","last_push_at"=EXCLUDED."last_push_at","last_pull_at"=EXCLUDED."last_pull_at","device_name"=EXCLUDED."device_name","device_type"=EXCLUDED."device_type","location_name"=EXCLUDED."location_name","last_heartbeat_at"=EXCLUDED."last_heartbeat_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_branch_telemetry(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."branch_telemetry" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."terminal_id"::text=COALESCE(c->'key'->>'terminal_id',(c->>'entityId')::jsonb->>'terminal_id',(c->>'entity_id')::jsonb->>'terminal_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_branch_telemetry(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_branch_telemetry(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_branch_telemetry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'branch_telemetry',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('terminal_id',OLD."terminal_id")::text ELSE jsonb_build_object('terminal_id',NEW."terminal_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."branch_telemetry";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."branch_telemetry" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_branch_telemetry();

REVOKE ALL ON FUNCTION public.sync_feed_branch_telemetry() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_cashiers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."cashiers" ("id","username","full_name","pin_hash","store_id","permissions","is_active","last_login_at","created_at","updated_at","role_slug","idle_timeout_minutes")
  SELECT "id","username","full_name","pin_hash","store_id","permissions","is_active","last_login_at","created_at","updated_at","role_slug","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."cashiers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "username"=EXCLUDED."username","full_name"=EXCLUDED."full_name","pin_hash"=EXCLUDED."pin_hash","store_id"=EXCLUDED."store_id","permissions"=EXCLUDED."permissions","is_active"=EXCLUDED."is_active","last_login_at"=EXCLUDED."last_login_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","role_slug"=EXCLUDED."role_slug","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_cashiers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."cashiers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_cashiers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_cashiers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_cashiers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'cashiers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."cashiers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."cashiers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_cashiers();

REVOKE ALL ON FUNCTION public.sync_feed_cashiers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_coupon_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."coupon_events" ("id","event_type","campaign_id","campaign_name","voucher_token","member_id","member_phone","store_id","terminal_id","staff_name","staff_role","sale_id","note","created_at")
  SELECT "id","event_type","campaign_id","campaign_name","voucher_token","member_id","member_phone","store_id","terminal_id","staff_name","staff_role","sale_id","note","created_at" FROM jsonb_populate_recordset(NULL::public."coupon_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "event_type"=EXCLUDED."event_type","campaign_id"=EXCLUDED."campaign_id","campaign_name"=EXCLUDED."campaign_name","voucher_token"=EXCLUDED."voucher_token","member_id"=EXCLUDED."member_id","member_phone"=EXCLUDED."member_phone","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","staff_name"=EXCLUDED."staff_name","staff_role"=EXCLUDED."staff_role","sale_id"=EXCLUDED."sale_id","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_coupon_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."coupon_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_coupon_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_coupon_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_coupon_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'coupon_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."coupon_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."coupon_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_coupon_events();

REVOKE ALL ON FUNCTION public.sync_feed_coupon_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_drawer_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."drawer_events" ("id","store_id","terminal_id","shift_id","staff_id","staff_name","role","reason","note","approved_by","created_at")
  SELECT "id","store_id","terminal_id","shift_id","staff_id","staff_name","role","reason","note","approved_by","created_at" FROM jsonb_populate_recordset(NULL::public."drawer_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","shift_id"=EXCLUDED."shift_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","reason"=EXCLUDED."reason","note"=EXCLUDED."note","approved_by"=EXCLUDED."approved_by","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_drawer_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."drawer_events" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_drawer_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_drawer_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_drawer_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'drawer_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."drawer_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."drawer_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_drawer_events();

REVOKE ALL ON FUNCTION public.sync_feed_drawer_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_held_orders(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."held_orders" ("id","label","store_id","shift_id","held_by","total","lines","cart_discount","cart_discount_type","exchange_ref","member_id","member_name","coupon","note","cancelled_from","held_at","created_at","updated_at","row_version","status","pending_request_id","bill_no")
  SELECT "id","label","store_id","shift_id","held_by","total","lines","cart_discount","cart_discount_type","exchange_ref","member_id","member_name","coupon","note","cancelled_from","held_at","created_at","updated_at","row_version","status","pending_request_id","bill_no" FROM jsonb_populate_recordset(NULL::public."held_orders", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "label"=EXCLUDED."label","store_id"=EXCLUDED."store_id","shift_id"=EXCLUDED."shift_id","held_by"=EXCLUDED."held_by","total"=EXCLUDED."total","lines"=EXCLUDED."lines","cart_discount"=EXCLUDED."cart_discount","cart_discount_type"=EXCLUDED."cart_discount_type","exchange_ref"=EXCLUDED."exchange_ref","member_id"=EXCLUDED."member_id","member_name"=EXCLUDED."member_name","coupon"=EXCLUDED."coupon","note"=EXCLUDED."note","cancelled_from"=EXCLUDED."cancelled_from","held_at"=EXCLUDED."held_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","status"=EXCLUDED."status","pending_request_id"=EXCLUDED."pending_request_id","bill_no"=EXCLUDED."bill_no" WHERE EXCLUDED."row_version">public."held_orders"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_held_orders(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."held_orders" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_held_orders(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_held_orders(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_held_orders() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'held_orders',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."held_orders";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."held_orders" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_held_orders();

REVOKE ALL ON FUNCTION public.sync_feed_held_orders() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_integration_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."integration_settings" ("id","provider_name","api_keys_encrypted","verification_channel","strict_verification","is_active","updated_by","created_at","updated_at")
  SELECT "id","provider_name","api_keys_encrypted","verification_channel","strict_verification","is_active","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."integration_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "provider_name"=EXCLUDED."provider_name","api_keys_encrypted"=EXCLUDED."api_keys_encrypted","verification_channel"=EXCLUDED."verification_channel","strict_verification"=EXCLUDED."strict_verification","is_active"=EXCLUDED."is_active","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_integration_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."integration_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_integration_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_integration_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_integration_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'integration_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."integration_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."integration_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_integration_settings();

REVOKE ALL ON FUNCTION public.sync_feed_integration_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_item_activity_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."item_activity_logs" ("id","product_id","product_name","sku","barcode","store_id","terminal_id","activity_type","reference","quantity_delta","stock_before","stock_after","unit_cost","staff_id","staff_name","role","note","created_at","row_version","item_id","sale_id","transfer_id","quantity","created_by","notes")
  SELECT "id","product_id","product_name","sku","barcode","store_id","terminal_id","activity_type","reference","quantity_delta","stock_before","stock_after","unit_cost","staff_id","staff_name","role","note","created_at","row_version","item_id","sale_id","transfer_id","quantity","created_by","notes" FROM jsonb_populate_recordset(NULL::public."item_activity_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    IF NULLIF(v_row->>'id','') IS NOT NULL AND NULLIF(v_row->>'product_id','') IS NOT NULL AND NULLIF(v_row->>'store_id','') IS NOT NULL AND COALESCE((v_row->>'quantity_delta')::integer,0)<>0 THEN
      PERFORM public.stock_apply_delta((v_row->>'id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'quantity_delta')::integer,0));
    END IF;
  END LOOP;


  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_item_activity_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."item_activity_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_item_activity_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_item_activity_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_item_activity_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'item_activity_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."item_activity_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."item_activity_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_item_activity_logs();

REVOKE ALL ON FUNCTION public.sync_feed_item_activity_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_member_verifications(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."member_verifications" ("id","member_id","phone","email","channel","otp_code","attempts","status","sent_by","store_id","expires_at","verified_at","created_at")
  SELECT "id","member_id","phone","email","channel","otp_code","attempts","status","sent_by","store_id","expires_at","verified_at","created_at" FROM jsonb_populate_recordset(NULL::public."member_verifications", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "member_id"=EXCLUDED."member_id","phone"=EXCLUDED."phone","email"=EXCLUDED."email","channel"=EXCLUDED."channel","otp_code"=EXCLUDED."otp_code","attempts"=EXCLUDED."attempts","status"=EXCLUDED."status","sent_by"=EXCLUDED."sent_by","store_id"=EXCLUDED."store_id","expires_at"=EXCLUDED."expires_at","verified_at"=EXCLUDED."verified_at","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_member_verifications(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."member_verifications" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_member_verifications(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_member_verifications(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_member_verifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'member_verifications',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."member_verifications";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."member_verifications" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_member_verifications();

REVOKE ALL ON FUNCTION public.sync_feed_member_verifications() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_members(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."members" ("id","member_code","full_name","phone","email","address","date_of_birth","tier_id","loyalty_points","total_spent","created_at","updated_at","row_version","is_verified","verified_at","verified_channel","deleted_at")
  SELECT "id","member_code","full_name","phone","email","address","date_of_birth","tier_id","loyalty_points","total_spent","created_at","updated_at","row_version","is_verified","verified_at","verified_channel","deleted_at" FROM jsonb_populate_recordset(NULL::public."members", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "member_code"=EXCLUDED."member_code","full_name"=EXCLUDED."full_name","phone"=EXCLUDED."phone","email"=EXCLUDED."email","address"=EXCLUDED."address","date_of_birth"=EXCLUDED."date_of_birth","tier_id"=EXCLUDED."tier_id","loyalty_points"=EXCLUDED."loyalty_points","total_spent"=EXCLUDED."total_spent","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","is_verified"=EXCLUDED."is_verified","verified_at"=EXCLUDED."verified_at","verified_channel"=EXCLUDED."verified_channel","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."members"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_members(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."members" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_members(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_members(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_members() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'members',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."members";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."members" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_members();

REVOKE ALL ON FUNCTION public.sync_feed_members() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_membership_tiers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."membership_tiers" ("id","name","discount_percentage","points_multiplier","created_at","updated_at","row_version","deleted_at")
  SELECT "id","name","discount_percentage","points_multiplier","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."membership_tiers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","discount_percentage"=EXCLUDED."discount_percentage","points_multiplier"=EXCLUDED."points_multiplier","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."membership_tiers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_membership_tiers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."membership_tiers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_membership_tiers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_membership_tiers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_membership_tiers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'membership_tiers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."membership_tiers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."membership_tiers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_membership_tiers();

REVOKE ALL ON FUNCTION public.sync_feed_membership_tiers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_offline_sync_audit_log(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."offline_sync_audit_log" ("id","terminal_id","store_id","direction","table_name","record_id","records","status","error_message","started_at","finished_at","created_at")
  SELECT "id","terminal_id","store_id","direction","table_name","record_id","records","status","error_message","started_at","finished_at","created_at" FROM jsonb_populate_recordset(NULL::public."offline_sync_audit_log", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "terminal_id"=EXCLUDED."terminal_id","store_id"=EXCLUDED."store_id","direction"=EXCLUDED."direction","table_name"=EXCLUDED."table_name","record_id"=EXCLUDED."record_id","records"=EXCLUDED."records","status"=EXCLUDED."status","error_message"=EXCLUDED."error_message","started_at"=EXCLUDED."started_at","finished_at"=EXCLUDED."finished_at","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_offline_sync_audit_log(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."offline_sync_audit_log" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_offline_sync_audit_log(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_offline_sync_audit_log(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_offline_sync_audit_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'offline_sync_audit_log',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."offline_sync_audit_log";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."offline_sync_audit_log" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_offline_sync_audit_log();

REVOKE ALL ON FUNCTION public.sync_feed_offline_sync_audit_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_payment_transactions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."payment_transactions" ("id","source_type","sale_id","booking_id","member_id","store_id","shift_id","terminal_id","amount","method","kind","reference","cashier_id","cashier_name","note","paid_at","created_at","updated_at","row_version","status","metadata","client_transaction_id","order_id","payment_method","transaction_reference")
  SELECT "id","source_type","sale_id","booking_id","member_id","store_id","shift_id","terminal_id","amount","method","kind","reference","cashier_id","cashier_name","note","paid_at","created_at","updated_at","row_version","status","metadata","client_transaction_id","order_id","payment_method","transaction_reference" FROM jsonb_populate_recordset(NULL::public."payment_transactions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_payment_transactions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."payment_transactions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_payment_transactions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_payment_transactions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_payment_transactions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'payment_transactions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."payment_transactions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."payment_transactions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_payment_transactions();

REVOKE ALL ON FUNCTION public.sync_feed_payment_transactions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_payment_types(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."payment_types" ("id","name","type_code","requires_reference","is_active","icon","sort_order","is_system","created_at","updated_at","row_version")
  SELECT "id","name","type_code","requires_reference","is_active","icon","sort_order","is_system","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."payment_types", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","type_code"=EXCLUDED."type_code","requires_reference"=EXCLUDED."requires_reference","is_active"=EXCLUDED."is_active","icon"=EXCLUDED."icon","sort_order"=EXCLUDED."sort_order","is_system"=EXCLUDED."is_system","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."payment_types"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_payment_types(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."payment_types" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_payment_types(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_payment_types(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_payment_types() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'payment_types',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."payment_types";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."payment_types" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_payment_types();

REVOKE ALL ON FUNCTION public.sync_feed_payment_types() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pin_attempts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pin_attempts" ("key","attempts","window_started_at","locked_until","created_at","updated_at")
  SELECT "key","attempts","window_started_at","locked_until","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."pin_attempts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "attempts"=EXCLUDED."attempts","window_started_at"=EXCLUDED."window_started_at","locked_until"=EXCLUDED."locked_until","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pin_attempts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pin_attempts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pin_attempts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pin_attempts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pin_attempts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pin_attempts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pin_attempts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pin_attempts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pin_attempts();

REVOKE ALL ON FUNCTION public.sync_feed_pin_attempts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pos_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pos_settings" ("id","tax_percentage","enable_tax","tax_mode","paper_size","header_text","footer_text","show_logo","show_points","show_barcode","show_tax_details","updated_at","company_name","tax_number","reg_number","phone","website","fonts","custom_lines","qr","review_max_voids","review_max_refunds","review_max_refund_value","review_max_nosale","review_max_discount_pct","day_start_time","day_end_time","max_shift_hours","shift_reminder_minutes","ui_visibility","integration_settings","region_country","time_zone","date_format","time_format","booking_slip","notification_settings","row_version","logo_data_url","receipt_design","payment_details","whatsapp_settings","receipt_css")
  SELECT "id","tax_percentage","enable_tax","tax_mode","paper_size","header_text","footer_text","show_logo","show_points","show_barcode","show_tax_details","updated_at","company_name","tax_number","reg_number","phone","website","fonts","custom_lines","qr","review_max_voids","review_max_refunds","review_max_refund_value","review_max_nosale","review_max_discount_pct","day_start_time","day_end_time","max_shift_hours","shift_reminder_minutes","ui_visibility","integration_settings","region_country","time_zone","date_format","time_format","booking_slip","notification_settings","row_version","logo_data_url","receipt_design","payment_details","whatsapp_settings","receipt_css" FROM jsonb_populate_recordset(NULL::public."pos_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "tax_percentage"=EXCLUDED."tax_percentage","enable_tax"=EXCLUDED."enable_tax","tax_mode"=EXCLUDED."tax_mode","paper_size"=EXCLUDED."paper_size","header_text"=EXCLUDED."header_text","footer_text"=EXCLUDED."footer_text","show_logo"=EXCLUDED."show_logo","show_points"=EXCLUDED."show_points","show_barcode"=EXCLUDED."show_barcode","show_tax_details"=EXCLUDED."show_tax_details","updated_at"=EXCLUDED."updated_at","company_name"=EXCLUDED."company_name","tax_number"=EXCLUDED."tax_number","reg_number"=EXCLUDED."reg_number","phone"=EXCLUDED."phone","website"=EXCLUDED."website","fonts"=EXCLUDED."fonts","custom_lines"=EXCLUDED."custom_lines","qr"=EXCLUDED."qr","review_max_voids"=EXCLUDED."review_max_voids","review_max_refunds"=EXCLUDED."review_max_refunds","review_max_refund_value"=EXCLUDED."review_max_refund_value","review_max_nosale"=EXCLUDED."review_max_nosale","review_max_discount_pct"=EXCLUDED."review_max_discount_pct","day_start_time"=EXCLUDED."day_start_time","day_end_time"=EXCLUDED."day_end_time","max_shift_hours"=EXCLUDED."max_shift_hours","shift_reminder_minutes"=EXCLUDED."shift_reminder_minutes","ui_visibility"=EXCLUDED."ui_visibility","integration_settings"=EXCLUDED."integration_settings","region_country"=EXCLUDED."region_country","time_zone"=EXCLUDED."time_zone","date_format"=EXCLUDED."date_format","time_format"=EXCLUDED."time_format","booking_slip"=EXCLUDED."booking_slip","notification_settings"=EXCLUDED."notification_settings","row_version"=EXCLUDED."row_version","logo_data_url"=EXCLUDED."logo_data_url","receipt_design"=EXCLUDED."receipt_design","payment_details"=EXCLUDED."payment_details","whatsapp_settings"=EXCLUDED."whatsapp_settings","receipt_css"=EXCLUDED."receipt_css" WHERE EXCLUDED."row_version">public."pos_settings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pos_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pos_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pos_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pos_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pos_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pos_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pos_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pos_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pos_settings();

REVOKE ALL ON FUNCTION public.sync_feed_pos_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_product_barcodes(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."product_barcodes" ("id","product_id","barcode","label","pack_size","is_primary","created_at","updated_at","row_version","unit_label","deleted_at")
  SELECT "id","product_id","barcode","label","pack_size","is_primary","created_at","updated_at","row_version","unit_label","deleted_at" FROM jsonb_populate_recordset(NULL::public."product_barcodes", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","label"=EXCLUDED."label","pack_size"=EXCLUDED."pack_size","is_primary"=EXCLUDED."is_primary","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","unit_label"=EXCLUDED."unit_label","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."product_barcodes"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_product_barcodes(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."product_barcodes" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_product_barcodes(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_product_barcodes(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_product_barcodes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'product_barcodes',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') branch_id,NULL::text terminal_id FROM public."products" p WHERE p."id"::text=COALESCE(NEW."product_id",OLD."product_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."product_barcodes";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."product_barcodes" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_product_barcodes();

REVOKE ALL ON FUNCTION public.sync_feed_product_barcodes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_product_categories(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."product_categories" ("id","name","parent_id","sort","created_at","updated_at","kind","row_version","is_active","deleted_at")
  SELECT "id","name","parent_id","sort","created_at","updated_at","kind","row_version","is_active","deleted_at" FROM jsonb_populate_recordset(NULL::public."product_categories", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","parent_id"=EXCLUDED."parent_id","sort"=EXCLUDED."sort","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","kind"=EXCLUDED."kind","row_version"=EXCLUDED."row_version","is_active"=EXCLUDED."is_active","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."product_categories"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_product_categories(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."product_categories" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_product_categories(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_product_categories(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_product_categories() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'product_categories',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."product_categories";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."product_categories" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_product_categories();

REVOKE ALL ON FUNCTION public.sync_feed_product_categories() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_products(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."products" ("id","barcode","name","category","cost_price","selling_price","ecom_price","stock_quantity","custom_points","point_multiplier","created_at","sku","reorder_level","tax_rate","ecom_visible","stock_by_store","updated_at","landing_pct","sub_category","unit","packs","barcode_aliases","is_archived","archived_at","brand","product_group","barcode_variants","row_version","owner_store_id","deleted_at")
  SELECT "id","barcode","name","category","cost_price","selling_price","ecom_price","stock_quantity","custom_points","point_multiplier","created_at","sku","reorder_level","tax_rate","ecom_visible","stock_by_store","updated_at","landing_pct","sub_category","unit","packs","barcode_aliases","is_archived","archived_at","brand","product_group","barcode_variants","row_version","owner_store_id","deleted_at" FROM jsonb_populate_recordset(NULL::public."products", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "barcode"=EXCLUDED."barcode","name"=EXCLUDED."name","category"=EXCLUDED."category","cost_price"=EXCLUDED."cost_price","selling_price"=EXCLUDED."selling_price","ecom_price"=EXCLUDED."ecom_price","custom_points"=EXCLUDED."custom_points","point_multiplier"=EXCLUDED."point_multiplier","created_at"=EXCLUDED."created_at","sku"=EXCLUDED."sku","reorder_level"=EXCLUDED."reorder_level","tax_rate"=EXCLUDED."tax_rate","ecom_visible"=EXCLUDED."ecom_visible","updated_at"=EXCLUDED."updated_at","landing_pct"=EXCLUDED."landing_pct","sub_category"=EXCLUDED."sub_category","unit"=EXCLUDED."unit","packs"=EXCLUDED."packs","barcode_aliases"=EXCLUDED."barcode_aliases","is_archived"=EXCLUDED."is_archived","archived_at"=EXCLUDED."archived_at","brand"=EXCLUDED."brand","product_group"=EXCLUDED."product_group","barcode_variants"=EXCLUDED."barcode_variants","row_version"=EXCLUDED."row_version","owner_store_id"=EXCLUDED."owner_store_id","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."products"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_products(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."products" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_products(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_products(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_products() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'products',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(COALESCE(NEW.owner_store_id,OLD.owner_store_id)::text,''),'global') branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."products";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."products" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_products();

REVOKE ALL ON FUNCTION public.sync_feed_products() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_promotions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."promotions" ("id","title","promo_type","min_spend","discount_percent","discount_amount","foc_product_id","points_per_dollar","tier_rates","is_active","start_date","end_date","created_at","updated_at","row_version","deleted_at")
  SELECT "id","title","promo_type","min_spend","discount_percent","discount_amount","foc_product_id","points_per_dollar","tier_rates","is_active","start_date","end_date","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."promotions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "title"=EXCLUDED."title","promo_type"=EXCLUDED."promo_type","min_spend"=EXCLUDED."min_spend","discount_percent"=EXCLUDED."discount_percent","discount_amount"=EXCLUDED."discount_amount","foc_product_id"=EXCLUDED."foc_product_id","points_per_dollar"=EXCLUDED."points_per_dollar","tier_rates"=EXCLUDED."tier_rates","is_active"=EXCLUDED."is_active","start_date"=EXCLUDED."start_date","end_date"=EXCLUDED."end_date","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."promotions"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_promotions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."promotions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_promotions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_promotions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_promotions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'promotions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') branch_id,NULL::text terminal_id FROM public."products" p WHERE p."id"::text=COALESCE(NEW."foc_product_id",OLD."foc_product_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."promotions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."promotions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_promotions();

REVOKE ALL ON FUNCTION public.sync_feed_promotions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_public_flags(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."public_flags" ("key","enabled","updated_at")
  SELECT "key","enabled","updated_at" FROM jsonb_populate_recordset(NULL::public."public_flags", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "enabled"=EXCLUDED."enabled","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_public_flags(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."public_flags" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_public_flags(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_public_flags(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_public_flags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'public_flags',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."public_flags";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."public_flags" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_public_flags();

REVOKE ALL ON FUNCTION public.sync_feed_public_flags() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_purchase_order_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."purchase_order_items" ("id","po_id","product_id","barcode","product_name","cost_price","selling_price","quantity_received","subtotal_cost","created_at","sku","updated_at","row_version")
  SELECT "id","po_id","product_id","barcode","product_name","cost_price","selling_price","quantity_received","subtotal_cost","created_at","sku","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."purchase_order_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "po_id"=EXCLUDED."po_id","product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","product_name"=EXCLUDED."product_name","cost_price"=EXCLUDED."cost_price","selling_price"=EXCLUDED."selling_price","quantity_received"=EXCLUDED."quantity_received","subtotal_cost"=EXCLUDED."subtotal_cost","created_at"=EXCLUDED."created_at","sku"=EXCLUDED."sku","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."purchase_order_items"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_purchase_order_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."purchase_order_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_purchase_order_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_purchase_order_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_purchase_order_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'purchase_order_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT p.store_id::text branch_id,NULL::text terminal_id FROM public."purchase_orders" p WHERE p."id"::text=COALESCE(NEW."po_id",OLD."po_id")::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."purchase_order_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."purchase_order_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_purchase_order_items();

REVOKE ALL ON FUNCTION public.sync_feed_purchase_order_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_purchase_orders(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."purchase_orders" ("id","po_number","supplier_name","operator_name","total_cost","total_items_count","created_at","supplier_id","store_id","store_code","invoice_date","invoice_entry_date","updated_at","row_version","pending_edit_request_id","pending_edit_by","pending_edit_at","status","reference")
  SELECT "id","po_number","supplier_name","operator_name","total_cost","total_items_count","created_at","supplier_id","store_id","store_code","invoice_date","invoice_entry_date","updated_at","row_version","pending_edit_request_id","pending_edit_by","pending_edit_at","status","reference" FROM jsonb_populate_recordset(NULL::public."purchase_orders", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "po_number"=EXCLUDED."po_number","supplier_name"=EXCLUDED."supplier_name","operator_name"=EXCLUDED."operator_name","total_cost"=EXCLUDED."total_cost","total_items_count"=EXCLUDED."total_items_count","created_at"=EXCLUDED."created_at","supplier_id"=EXCLUDED."supplier_id","store_id"=EXCLUDED."store_id","store_code"=EXCLUDED."store_code","invoice_date"=EXCLUDED."invoice_date","invoice_entry_date"=EXCLUDED."invoice_entry_date","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","pending_edit_request_id"=EXCLUDED."pending_edit_request_id","pending_edit_by"=EXCLUDED."pending_edit_by","pending_edit_at"=EXCLUDED."pending_edit_at","status"=EXCLUDED."status","reference"=EXCLUDED."reference" WHERE EXCLUDED."row_version">public."purchase_orders"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_purchase_orders(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."purchase_orders" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_purchase_orders(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_purchase_orders(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_purchase_orders() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'purchase_orders',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."purchase_orders";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."purchase_orders" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_purchase_orders();

REVOKE ALL ON FUNCTION public.sync_feed_purchase_orders() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sale_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN
  PERFORM set_config('pos.refunding','on',true);

  INSERT INTO public."sale_items" ("id","sale_id","product_id","product_name","unit_price","quantity","discount_percent","discount_amount","is_return","created_at","tax_rate","is_foc","promo_id","coupon_code","coupon_discount","unit_cost","row_version","refunded_qty","branch_id")
  SELECT "id","sale_id","product_id","product_name","unit_price","quantity","discount_percent","discount_amount","is_return","created_at","tax_rate","is_foc","promo_id","coupon_code","coupon_discount","unit_cost","row_version","refunded_qty","branch_id" FROM jsonb_populate_recordset(NULL::public."sale_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "refunded_qty"=GREATEST(public."sale_items"."refunded_qty",EXCLUDED."refunded_qty"),"row_version"=GREATEST(public."sale_items"."row_version",EXCLUDED."row_version");
  GET DIAGNOSTICS v_count=ROW_COUNT;


  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sale_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sale_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.branch_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sale_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sale_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sale_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sale_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.branch_id,OLD.branch_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sale_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sale_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sale_items();

REVOKE ALL ON FUNCTION public.sync_feed_sale_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sales(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN
  PERFORM set_config('pos.refunding','on',true);

  INSERT INTO public."sales" ("id","bill_number","member_id","store_id","cashier_name","subtotal_amount","total_amount","discount_amount","tax_amount","payment_type","points_earned","points_redeemed","is_exchange","original_bill_number","is_refunded","created_at","shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number","coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments","client_transaction_id","cashier_id","created_by","updated_by","row_version","store_name_snapshot","store_address_snapshot","authorization_request_id","authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id")
  SELECT "id","bill_number","member_id","store_id","cashier_name","subtotal_amount","total_amount","discount_amount","tax_amount","payment_type","points_earned","points_redeemed","is_exchange","original_bill_number","is_refunded","created_at","shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number","coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments","client_transaction_id","cashier_id","created_by","updated_by","row_version","store_name_snapshot","store_address_snapshot","authorization_request_id","authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id" FROM jsonb_populate_recordset(NULL::public."sales", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "is_refunded"=(public."sales"."is_refunded" OR EXCLUDED."is_refunded"),"row_version"=GREATEST(public."sales"."row_version",EXCLUDED."row_version");
  GET DIAGNOSTICS v_count=ROW_COUNT;


  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sales(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sales" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sales(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sales(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sales() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sales',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sales";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sales" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sales();

REVOKE ALL ON FUNCTION public.sync_feed_sales() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_secure_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."secure_settings" ("key","ciphertext","hint","updated_by","created_at","updated_at")
  SELECT "key","ciphertext","hint","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."secure_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("key") DO UPDATE SET "ciphertext"=EXCLUDED."ciphertext","hint"=EXCLUDED."hint","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_secure_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."secure_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_secure_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_secure_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_secure_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'secure_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('key',OLD."key")::text ELSE jsonb_build_object('key',NEW."key")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."secure_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."secure_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_secure_settings();

REVOKE ALL ON FUNCTION public.sync_feed_secure_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_security_findings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."security_findings" ("id","fingerprint","source","severity","title","detail","deployment_ref","status","first_seen_at","last_seen_at","acknowledged_by","acknowledged_at","resolved_at","created_at","updated_at")
  SELECT "id","fingerprint","source","severity","title","detail","deployment_ref","status","first_seen_at","last_seen_at","acknowledged_by","acknowledged_at","resolved_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."security_findings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "fingerprint"=EXCLUDED."fingerprint","source"=EXCLUDED."source","severity"=EXCLUDED."severity","title"=EXCLUDED."title","detail"=EXCLUDED."detail","deployment_ref"=EXCLUDED."deployment_ref","status"=EXCLUDED."status","first_seen_at"=EXCLUDED."first_seen_at","last_seen_at"=EXCLUDED."last_seen_at","acknowledged_by"=EXCLUDED."acknowledged_by","acknowledged_at"=EXCLUDED."acknowledged_at","resolved_at"=EXCLUDED."resolved_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_security_findings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."security_findings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_security_findings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_security_findings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_security_findings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'security_findings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."security_findings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."security_findings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_security_findings();

REVOKE ALL ON FUNCTION public.sync_feed_security_findings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_locks(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_locks" ("section","locked","updated_by","created_at","updated_at")
  SELECT "section","locked","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."settings_locks", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("section") DO UPDATE SET "locked"=EXCLUDED."locked","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_locks(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_locks" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."section"::text=COALESCE(c->'key'->>'section',(c->>'entityId')::jsonb->>'section',(c->>'entity_id')::jsonb->>'section');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_locks(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_locks(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_locks() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_locks',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('section',OLD."section")::text ELSE jsonb_build_object('section',NEW."section")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_locks";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_locks" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_locks();

REVOKE ALL ON FUNCTION public.sync_feed_settings_locks() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_overrides(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_overrides" ("scope","scope_id","section","patch","updated_by","created_at","updated_at","row_version")
  SELECT "scope","scope_id","section","patch","updated_by","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."settings_overrides", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("scope","scope_id","section") DO UPDATE SET "patch"=EXCLUDED."patch","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."settings_overrides"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_overrides(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_overrides" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))) AND x."scope"::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope') AND x."scope_id"::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id') AND x."section"::text=COALESCE(c->'key'->>'section',(c->>'entityId')::jsonb->>'section',(c->>'entity_id')::jsonb->>'section');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_overrides(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_overrides(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_overrides() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_overrides',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('scope',OLD."scope",'scope_id',OLD."scope_id",'section',OLD."section")::text ELSE jsonb_build_object('scope',NEW."scope",'scope_id',NEW."scope_id",'section',NEW."section")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope,OLD.scope))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope,OLD.scope))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope,OLD.scope))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text UNION ALL SELECT token.location_id::text,COALESCE(NEW.scope_id,OLD.scope_id)::text FROM public.terminal_tokens token WHERE lower(COALESCE(NEW.scope,OLD.scope))='terminal' AND token.id::text=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_overrides";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_overrides" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_overrides();

REVOKE ALL ON FUNCTION public.sync_feed_settings_overrides() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_sessions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_sessions" ("id","shift_id","store_id","terminal_id","terminal_name","staff_id","staff_name","role","signed_in_at","signed_out_at","created_at","updated_at","row_version")
  SELECT "id","shift_id","store_id","terminal_id","terminal_name","staff_id","staff_name","role","signed_in_at","signed_out_at","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."shift_sessions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "shift_id"=EXCLUDED."shift_id","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","terminal_name"=EXCLUDED."terminal_name","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","signed_in_at"=EXCLUDED."signed_in_at","signed_out_at"=EXCLUDED."signed_out_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."shift_sessions"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_sessions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shift_sessions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_sessions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_sessions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_sessions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_sessions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_sessions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_sessions();

REVOKE ALL ON FUNCTION public.sync_feed_shift_sessions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sku_audit(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."sku_audit" ("id","sku","product_id","product_name","source","previous_sku","store_id","store_name","terminal_id","staff_id","staff_name","role","created_at")
  SELECT "id","sku","product_id","product_name","source","previous_sku","store_id","store_name","terminal_id","staff_id","staff_name","role","created_at" FROM jsonb_populate_recordset(NULL::public."sku_audit", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "sku"=EXCLUDED."sku","product_id"=EXCLUDED."product_id","product_name"=EXCLUDED."product_name","source"=EXCLUDED."source","previous_sku"=EXCLUDED."previous_sku","store_id"=EXCLUDED."store_id","store_name"=EXCLUDED."store_name","terminal_id"=EXCLUDED."terminal_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","role"=EXCLUDED."role","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sku_audit(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sku_audit" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sku_audit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sku_audit(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sku_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sku_audit',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sku_audit";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sku_audit" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sku_audit();

REVOKE ALL ON FUNCTION public.sync_feed_sku_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_staff_roles(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."staff_roles" ("slug","name","base_level","permissions","is_core","created_at","updated_at")
  SELECT "slug","name","base_level","permissions","is_core","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."staff_roles", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name","base_level"=EXCLUDED."base_level","permissions"=EXCLUDED."permissions","is_core"=EXCLUDED."is_core","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_staff_roles(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."staff_roles" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."slug"::text=COALESCE(c->'key'->>'slug',(c->>'entityId')::jsonb->>'slug',(c->>'entity_id')::jsonb->>'slug');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_staff_roles(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_staff_roles(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_staff_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'staff_roles',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('slug',OLD."slug")::text ELSE jsonb_build_object('slug',NEW."slug")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."staff_roles";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."staff_roles" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_staff_roles();

REVOKE ALL ON FUNCTION public.sync_feed_staff_roles() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_adjustments(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_adjustments" ("id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id")
  SELECT "id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id" FROM jsonb_populate_recordset(NULL::public."stock_adjustments", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_adjustments(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_adjustments" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_adjustments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_adjustments(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_adjustments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_adjustments',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_adjustments";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_adjustments" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_adjustments();

REVOKE ALL ON FUNCTION public.sync_feed_stock_adjustments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_delta_applied(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer:=0; v_row jsonb;
BEGIN FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
  PERFORM public.stock_apply_delta((v_row->>'movement_id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'delta')::integer,0)); v_count:=v_count+1;
 END LOOP; RETURN v_count; END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_delta_applied(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_delta_applied" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."movement_id"::text=COALESCE(c->'key'->>'movement_id',(c->>'entityId')::jsonb->>'movement_id',(c->>'entity_id')::jsonb->>'movement_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_delta_applied(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_delta_applied(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_delta_applied() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_delta_applied',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('movement_id',OLD."movement_id")::text ELSE jsonb_build_object('movement_id',NEW."movement_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_delta_applied";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_delta_applied" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_delta_applied();

REVOKE ALL ON FUNCTION public.sync_feed_stock_delta_applied() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_transfer_items(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_transfer_items" ("id","transfer_id","product_id","barcode","sku","product_name","quantity","quantity_received","unit_cost","created_at","row_version","quantity_approved","quantity_dispatched","quantity_verified")
  SELECT "id","transfer_id","product_id","barcode","sku","product_name","quantity","quantity_received","unit_cost","created_at","row_version","quantity_approved","quantity_dispatched","quantity_verified" FROM jsonb_populate_recordset(NULL::public."stock_transfer_items", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "transfer_id"=EXCLUDED."transfer_id","product_id"=EXCLUDED."product_id","barcode"=EXCLUDED."barcode","sku"=EXCLUDED."sku","product_name"=EXCLUDED."product_name","quantity"=EXCLUDED."quantity","quantity_received"=EXCLUDED."quantity_received","unit_cost"=EXCLUDED."unit_cost","created_at"=EXCLUDED."created_at","row_version"=EXCLUDED."row_version","quantity_approved"=EXCLUDED."quantity_approved","quantity_dispatched"=EXCLUDED."quantity_dispatched","quantity_verified"=EXCLUDED."quantity_verified" WHERE EXCLUDED."row_version">public."stock_transfer_items"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_transfer_items(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_transfer_items" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_transfer_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_transfer_items(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_transfer_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_transfer_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT DISTINCT branch_id,NULL::text terminal_id FROM public."stock_transfers" p CROSS JOIN LATERAL (VALUES(p.from_store_id::text),(p.to_store_id::text)) b(branch_id) WHERE p."id"::text=COALESCE(NEW."transfer_id",OLD."transfer_id")::text AND branch_id IS NOT NULL) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_transfer_items";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_transfer_items" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_transfer_items();

REVOKE ALL ON FUNCTION public.sync_feed_stock_transfer_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_transfers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_transfers" ("id","ref","kind","transfer_scope","from_store_id","from_store_name","from_group_id","to_store_id","to_store_name","to_group_id","status","note","created_by","approved_by","approved_at","received_by","received_at","rejected_reason","created_at","updated_at","row_version","verified_by","verified_at","posted_at","discrepancy_reason","rejected_by","cancelled_reason","dispatched_by","dispatched_at","closed_at","fulfilment","source_request_id")
  SELECT "id","ref","kind","transfer_scope","from_store_id","from_store_name","from_group_id","to_store_id","to_store_name","to_group_id","status","note","created_by","approved_by","approved_at","received_by","received_at","rejected_reason","created_at","updated_at","row_version","verified_by","verified_at","posted_at","discrepancy_reason","rejected_by","cancelled_reason","dispatched_by","dispatched_at","closed_at","fulfilment","source_request_id" FROM jsonb_populate_recordset(NULL::public."stock_transfers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "ref"=EXCLUDED."ref","kind"=EXCLUDED."kind","transfer_scope"=EXCLUDED."transfer_scope","from_store_id"=EXCLUDED."from_store_id","from_store_name"=EXCLUDED."from_store_name","from_group_id"=EXCLUDED."from_group_id","to_store_id"=EXCLUDED."to_store_id","to_store_name"=EXCLUDED."to_store_name","to_group_id"=EXCLUDED."to_group_id","status"=EXCLUDED."status","note"=EXCLUDED."note","created_by"=EXCLUDED."created_by","approved_by"=EXCLUDED."approved_by","approved_at"=EXCLUDED."approved_at","received_by"=EXCLUDED."received_by","received_at"=EXCLUDED."received_at","rejected_reason"=EXCLUDED."rejected_reason","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","verified_by"=EXCLUDED."verified_by","verified_at"=EXCLUDED."verified_at","posted_at"=EXCLUDED."posted_at","discrepancy_reason"=EXCLUDED."discrepancy_reason","rejected_by"=EXCLUDED."rejected_by","cancelled_reason"=EXCLUDED."cancelled_reason","dispatched_by"=EXCLUDED."dispatched_by","dispatched_at"=EXCLUDED."dispatched_at","closed_at"=EXCLUDED."closed_at","fulfilment"=EXCLUDED."fulfilment","source_request_id"=EXCLUDED."source_request_id" WHERE EXCLUDED."row_version">public."stock_transfers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_transfers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_transfers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (p_branch_id IN (x.from_store_id::text,x.to_store_id::text)) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_transfers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_transfers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_transfers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_transfers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT DISTINCT branch_id,NULL::text terminal_id FROM (VALUES(COALESCE(NEW.from_store_id,OLD.from_store_id)::text),(COALESCE(NEW.to_store_id,OLD.to_store_id)::text)) b(branch_id) WHERE branch_id IS NOT NULL) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_transfers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_transfers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_transfers();

REVOKE ALL ON FUNCTION public.sync_feed_stock_transfers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stores(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stores" ("id","code","name","address","phone","created_at","updated_at","group_id","row_version","location_type","parent_id","is_central","building_name","floor_label","is_active","archived_at","is_primary_sub","private_catalogue","receipt_prefix","deleted_at")
  SELECT "id","code","name","address","phone","created_at","updated_at","group_id","row_version","location_type","parent_id","is_central","building_name","floor_label","is_active","archived_at","is_primary_sub","private_catalogue","receipt_prefix","deleted_at" FROM jsonb_populate_recordset(NULL::public."stores", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","address"=EXCLUDED."address","phone"=EXCLUDED."phone","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","group_id"=EXCLUDED."group_id","row_version"=EXCLUDED."row_version","location_type"=EXCLUDED."location_type","parent_id"=EXCLUDED."parent_id","is_central"=EXCLUDED."is_central","building_name"=EXCLUDED."building_name","floor_label"=EXCLUDED."floor_label","is_active"=EXCLUDED."is_active","archived_at"=EXCLUDED."archived_at","is_primary_sub"=EXCLUDED."is_primary_sub","private_catalogue"=EXCLUDED."private_catalogue","receipt_prefix"=EXCLUDED."receipt_prefix","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."stores"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stores(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stores" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stores(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stores(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stores() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stores',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stores";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stores" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stores();

REVOKE ALL ON FUNCTION public.sync_feed_stores() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_suppliers(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."suppliers" ("id","name","contact_name","phone","email","address","tax_number","notes","is_active","created_at","updated_at","row_version","deleted_at")
  SELECT "id","name","contact_name","phone","email","address","tax_number","notes","is_active","created_at","updated_at","row_version","deleted_at" FROM jsonb_populate_recordset(NULL::public."suppliers", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","contact_name"=EXCLUDED."contact_name","phone"=EXCLUDED."phone","email"=EXCLUDED."email","address"=EXCLUDED."address","tax_number"=EXCLUDED."tax_number","notes"=EXCLUDED."notes","is_active"=EXCLUDED."is_active","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."suppliers"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_suppliers(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."suppliers" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_suppliers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_suppliers(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_suppliers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'suppliers',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."suppliers";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."suppliers" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_suppliers();

REVOKE ALL ON FUNCTION public.sync_feed_suppliers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_sync_metadata(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."sync_metadata" ("id","store_id","terminal_id","table_name","last_synced_at","last_pushed_at","rows_pushed","last_error","created_at","updated_at")
  SELECT "id","store_id","terminal_id","table_name","last_synced_at","last_pushed_at","rows_pushed","last_error","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."sync_metadata", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","table_name"=EXCLUDED."table_name","last_synced_at"=EXCLUDED."last_synced_at","last_pushed_at"=EXCLUDED."last_pushed_at","rows_pushed"=EXCLUDED."rows_pushed","last_error"=EXCLUDED."last_error","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_sync_metadata(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."sync_metadata" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_sync_metadata(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_sync_metadata(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_sync_metadata() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'sync_metadata',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."sync_metadata";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."sync_metadata" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_sync_metadata();

REVOKE ALL ON FUNCTION public.sync_feed_sync_metadata() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_system_audit_logs(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."system_audit_logs" ("id","actor_id","actor_name","actor_role","action_type","entity_affected","entity_id","old_value","new_value","terminal_id","ip_address","store_id","note","created_at")
  SELECT "id","actor_id","actor_name","actor_role","action_type","entity_affected","entity_id","old_value","new_value","terminal_id","ip_address","store_id","note","created_at" FROM jsonb_populate_recordset(NULL::public."system_audit_logs", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "actor_id"=EXCLUDED."actor_id","actor_name"=EXCLUDED."actor_name","actor_role"=EXCLUDED."actor_role","action_type"=EXCLUDED."action_type","entity_affected"=EXCLUDED."entity_affected","entity_id"=EXCLUDED."entity_id","old_value"=EXCLUDED."old_value","new_value"=EXCLUDED."new_value","terminal_id"=EXCLUDED."terminal_id","ip_address"=EXCLUDED."ip_address","store_id"=EXCLUDED."store_id","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_system_audit_logs(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."system_audit_logs" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_system_audit_logs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_system_audit_logs(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_system_audit_logs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'system_audit_logs',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."system_audit_logs";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."system_audit_logs" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_system_audit_logs();

REVOKE ALL ON FUNCTION public.sync_feed_system_audit_logs() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_commands(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_commands" ("id","terminal_id","store_id","command","status","note","result","issued_by","issued_role","picked_up_at","finished_at","created_at","updated_at")
  SELECT "id","terminal_id","store_id","command","status","note","result","issued_by","issued_role","picked_up_at","finished_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."terminal_commands", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "terminal_id"=EXCLUDED."terminal_id","store_id"=EXCLUDED."store_id","command"=EXCLUDED."command","status"=EXCLUDED."status","note"=EXCLUDED."note","result"=EXCLUDED."result","issued_by"=EXCLUDED."issued_by","issued_role"=EXCLUDED."issued_role","picked_up_at"=EXCLUDED."picked_up_at","finished_at"=EXCLUDED."finished_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_commands(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_commands" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_commands(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_commands(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_commands() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_commands',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_commands";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_commands" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_commands();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_commands() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_tokens(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_tokens" ("id","location_id","location_name","device_name","status","created_at","activated_at","revoked_at","last_seen_at","app_version","last_sync_at","reissued_at","replaced_by","claimed_by_device","claimed_at","platform","row_version","claim_secret_hash","claim_expires_at","credentials_issued_at","device_platform","device_os","claimed_proof_hash","claimed_platform","claimed_os","is_claimed","expires_at","claim_proof")
  SELECT "id","location_id","location_name","device_name","status","created_at","activated_at","revoked_at","last_seen_at","app_version","last_sync_at","reissued_at","replaced_by","claimed_by_device","claimed_at","platform","row_version","claim_secret_hash","claim_expires_at","credentials_issued_at","device_platform","device_os","claimed_proof_hash","claimed_platform","claimed_os","is_claimed","expires_at","claim_proof" FROM jsonb_populate_recordset(NULL::public."terminal_tokens", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "location_id"=EXCLUDED."location_id","location_name"=EXCLUDED."location_name","device_name"=EXCLUDED."device_name","status"=EXCLUDED."status","created_at"=EXCLUDED."created_at","activated_at"=EXCLUDED."activated_at","revoked_at"=EXCLUDED."revoked_at","last_seen_at"=EXCLUDED."last_seen_at","app_version"=EXCLUDED."app_version","last_sync_at"=EXCLUDED."last_sync_at","reissued_at"=EXCLUDED."reissued_at","replaced_by"=EXCLUDED."replaced_by","claimed_by_device"=EXCLUDED."claimed_by_device","claimed_at"=EXCLUDED."claimed_at","platform"=EXCLUDED."platform","row_version"=EXCLUDED."row_version","claim_secret_hash"=EXCLUDED."claim_secret_hash","claim_expires_at"=EXCLUDED."claim_expires_at","credentials_issued_at"=EXCLUDED."credentials_issued_at","device_platform"=EXCLUDED."device_platform","device_os"=EXCLUDED."device_os","claimed_proof_hash"=EXCLUDED."claimed_proof_hash","claimed_platform"=EXCLUDED."claimed_platform","claimed_os"=EXCLUDED."claimed_os","is_claimed"=EXCLUDED."is_claimed","expires_at"=EXCLUDED."expires_at","claim_proof"=EXCLUDED."claim_proof" WHERE EXCLUDED."row_version">public."terminal_tokens"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_tokens(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_tokens" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_tokens(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_tokens(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_tokens() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_tokens',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_tokens";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_tokens" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_tokens();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_tokens() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_uom_units(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."uom_units" ("id","code","name","allow_decimal","sort","created_at","updated_at","row_version","is_active","deleted_at")
  SELECT "id","code","name","allow_decimal","sort","created_at","updated_at","row_version","is_active","deleted_at" FROM jsonb_populate_recordset(NULL::public."uom_units", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","allow_decimal"=EXCLUDED."allow_decimal","sort"=EXCLUDED."sort","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version","is_active"=EXCLUDED."is_active","deleted_at"=EXCLUDED."deleted_at" WHERE EXCLUDED."row_version">public."uom_units"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_uom_units(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."uom_units" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_uom_units(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_uom_units(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_uom_units() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'uom_units',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."uom_units";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."uom_units" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_uom_units();

REVOKE ALL ON FUNCTION public.sync_feed_uom_units() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_user_roles(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."user_roles" ("id","user_id","role","created_at")
  SELECT "id","user_id","role","created_at" FROM jsonb_populate_recordset(NULL::public."user_roles", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "user_id"=EXCLUDED."user_id","role"=EXCLUDED."role","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_user_roles(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."user_roles" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_user_roles(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_user_roles(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_user_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'user_roles',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."user_roles";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."user_roles" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_user_roles();

REVOKE ALL ON FUNCTION public.sync_feed_user_roles() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_whatsapp_queue(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."whatsapp_queue" ("id","phone_number_id","recipient","body","reference","store_id","status","error","queued_at","sent_at","created_at","updated_at")
  SELECT "id","phone_number_id","recipient","body","reference","store_id","status","error","queued_at","sent_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."whatsapp_queue", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "phone_number_id"=EXCLUDED."phone_number_id","recipient"=EXCLUDED."recipient","body"=EXCLUDED."body","reference"=EXCLUDED."reference","store_id"=EXCLUDED."store_id","status"=EXCLUDED."status","error"=EXCLUDED."error","queued_at"=EXCLUDED."queued_at","sent_at"=EXCLUDED."sent_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_whatsapp_queue(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."whatsapp_queue" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_whatsapp_queue(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_whatsapp_queue(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_whatsapp_queue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'whatsapp_queue',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."whatsapp_queue";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."whatsapp_queue" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_whatsapp_queue();

REVOKE ALL ON FUNCTION public.sync_feed_whatsapp_queue() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_terminal_recovery_secrets(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."terminal_recovery_secrets" ("terminal_token_id","sealed_secret","fingerprint","platform","device_name","utc_offset_minutes","created_at","updated_at")
  SELECT "terminal_token_id","sealed_secret","fingerprint","platform","device_name","utc_offset_minutes","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."terminal_recovery_secrets", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("terminal_token_id") DO UPDATE SET "sealed_secret"=EXCLUDED."sealed_secret","fingerprint"=EXCLUDED."fingerprint","platform"=EXCLUDED."platform","device_name"=EXCLUDED."device_name","utc_offset_minutes"=EXCLUDED."utc_offset_minutes","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_terminal_recovery_secrets(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."terminal_recovery_secrets" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."terminal_token_id"::text=COALESCE(c->'key'->>'terminal_token_id',(c->>'entityId')::jsonb->>'terminal_token_id',(c->>'entity_id')::jsonb->>'terminal_token_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_terminal_recovery_secrets(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_terminal_recovery_secrets(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_terminal_recovery_secrets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'terminal_recovery_secrets',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('terminal_token_id',OLD."terminal_token_id")::text ELSE jsonb_build_object('terminal_token_id',NEW."terminal_token_id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."terminal_recovery_secrets";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."terminal_recovery_secrets" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_terminal_recovery_secrets();

REVOKE ALL ON FUNCTION public.sync_feed_terminal_recovery_secrets() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_pos_store_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."pos_store_settings" ("store_id","block_shift_close_on_hold","require_daily_sales_for_shift_close","require_counted_cash_on_close","require_opening_float_count","enable_blind_cash_count","max_drawer_cash_limit","require_reason_for_payout","allow_multiple_shifts_per_terminal","enable_cashier_x_report","show_opening_float_at_close","show_expected_totals_at_close","show_live_variance_at_close","show_itemized_tender_breakdown","require_manager_pin_on_variance","variance_pin_threshold","max_cashier_discount_percent","max_cart_discount_amount","allow_discount_stacking","require_reason_for_price_override","prevent_below_cost_sale","allow_tax_exemption","prevent_negative_stock_sale","require_receipt_for_refund","require_manager_pin_for_refund","max_refund_days_limit","track_item_voids","auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log","require_pin_void_cart","require_pin_void_line","require_pin_reduce_qty","require_pin_manual_discount","require_pin_price_override","require_pin_stock_adjustment","require_pin_shift_close","require_pin_edit_tenders","require_pin_terminal_reset","row_version","updated_by","updated_at","allow_offline_approvals","offline_approval_requires_pin","online_only_void_cart","online_only_void_line","online_only_reduce_qty","online_only_manual_discount","online_only_price_override","online_only_stock_adjustment","online_only_shift_close","online_only_edit_tenders","online_only_terminal_reset","online_only_refund","created_at","idle_timeout_minutes")
  SELECT "store_id","block_shift_close_on_hold","require_daily_sales_for_shift_close","require_counted_cash_on_close","require_opening_float_count","enable_blind_cash_count","max_drawer_cash_limit","require_reason_for_payout","allow_multiple_shifts_per_terminal","enable_cashier_x_report","show_opening_float_at_close","show_expected_totals_at_close","show_live_variance_at_close","show_itemized_tender_breakdown","require_manager_pin_on_variance","variance_pin_threshold","max_cashier_discount_percent","max_cart_discount_amount","allow_discount_stacking","require_reason_for_price_override","prevent_below_cost_sale","allow_tax_exemption","prevent_negative_stock_sale","require_receipt_for_refund","require_manager_pin_for_refund","max_refund_days_limit","track_item_voids","auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log","require_pin_void_cart","require_pin_void_line","require_pin_reduce_qty","require_pin_manual_discount","require_pin_price_override","require_pin_stock_adjustment","require_pin_shift_close","require_pin_edit_tenders","require_pin_terminal_reset","row_version","updated_by","updated_at","allow_offline_approvals","offline_approval_requires_pin","online_only_void_cart","online_only_void_line","online_only_reduce_qty","online_only_manual_discount","online_only_price_override","online_only_stock_adjustment","online_only_shift_close","online_only_edit_tenders","online_only_terminal_reset","online_only_refund","created_at","idle_timeout_minutes" FROM jsonb_populate_recordset(NULL::public."pos_store_settings", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("store_id") DO UPDATE SET "block_shift_close_on_hold"=EXCLUDED."block_shift_close_on_hold","require_daily_sales_for_shift_close"=EXCLUDED."require_daily_sales_for_shift_close","require_counted_cash_on_close"=EXCLUDED."require_counted_cash_on_close","require_opening_float_count"=EXCLUDED."require_opening_float_count","enable_blind_cash_count"=EXCLUDED."enable_blind_cash_count","max_drawer_cash_limit"=EXCLUDED."max_drawer_cash_limit","require_reason_for_payout"=EXCLUDED."require_reason_for_payout","allow_multiple_shifts_per_terminal"=EXCLUDED."allow_multiple_shifts_per_terminal","enable_cashier_x_report"=EXCLUDED."enable_cashier_x_report","show_opening_float_at_close"=EXCLUDED."show_opening_float_at_close","show_expected_totals_at_close"=EXCLUDED."show_expected_totals_at_close","show_live_variance_at_close"=EXCLUDED."show_live_variance_at_close","show_itemized_tender_breakdown"=EXCLUDED."show_itemized_tender_breakdown","require_manager_pin_on_variance"=EXCLUDED."require_manager_pin_on_variance","variance_pin_threshold"=EXCLUDED."variance_pin_threshold","max_cashier_discount_percent"=EXCLUDED."max_cashier_discount_percent","max_cart_discount_amount"=EXCLUDED."max_cart_discount_amount","allow_discount_stacking"=EXCLUDED."allow_discount_stacking","require_reason_for_price_override"=EXCLUDED."require_reason_for_price_override","prevent_below_cost_sale"=EXCLUDED."prevent_below_cost_sale","allow_tax_exemption"=EXCLUDED."allow_tax_exemption","prevent_negative_stock_sale"=EXCLUDED."prevent_negative_stock_sale","require_receipt_for_refund"=EXCLUDED."require_receipt_for_refund","require_manager_pin_for_refund"=EXCLUDED."require_manager_pin_for_refund","max_refund_days_limit"=EXCLUDED."max_refund_days_limit","track_item_voids"=EXCLUDED."track_item_voids","auto_lock_timeout_seconds"=EXCLUDED."auto_lock_timeout_seconds","require_manager_pin_for_cash_drawer_open"=EXCLUDED."require_manager_pin_for_cash_drawer_open","enable_manager_pin_audit_log"=EXCLUDED."enable_manager_pin_audit_log","require_pin_void_cart"=EXCLUDED."require_pin_void_cart","require_pin_void_line"=EXCLUDED."require_pin_void_line","require_pin_reduce_qty"=EXCLUDED."require_pin_reduce_qty","require_pin_manual_discount"=EXCLUDED."require_pin_manual_discount","require_pin_price_override"=EXCLUDED."require_pin_price_override","require_pin_stock_adjustment"=EXCLUDED."require_pin_stock_adjustment","require_pin_shift_close"=EXCLUDED."require_pin_shift_close","require_pin_edit_tenders"=EXCLUDED."require_pin_edit_tenders","require_pin_terminal_reset"=EXCLUDED."require_pin_terminal_reset","row_version"=EXCLUDED."row_version","updated_by"=EXCLUDED."updated_by","updated_at"=EXCLUDED."updated_at","allow_offline_approvals"=EXCLUDED."allow_offline_approvals","offline_approval_requires_pin"=EXCLUDED."offline_approval_requires_pin","online_only_void_cart"=EXCLUDED."online_only_void_cart","online_only_void_line"=EXCLUDED."online_only_void_line","online_only_reduce_qty"=EXCLUDED."online_only_reduce_qty","online_only_manual_discount"=EXCLUDED."online_only_manual_discount","online_only_price_override"=EXCLUDED."online_only_price_override","online_only_stock_adjustment"=EXCLUDED."online_only_stock_adjustment","online_only_shift_close"=EXCLUDED."online_only_shift_close","online_only_edit_tenders"=EXCLUDED."online_only_edit_tenders","online_only_terminal_reset"=EXCLUDED."online_only_terminal_reset","online_only_refund"=EXCLUDED."online_only_refund","created_at"=EXCLUDED."created_at","idle_timeout_minutes"=EXCLUDED."idle_timeout_minutes" WHERE EXCLUDED."row_version">public."pos_store_settings"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_pos_store_settings(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."pos_store_settings" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."store_id"::text=COALESCE(c->'key'->>'store_id',(c->>'entityId')::jsonb->>'store_id',(c->>'entity_id')::jsonb->>'store_id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_pos_store_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_pos_store_settings(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_pos_store_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'pos_store_settings',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('store_id',OLD."store_id")::text ELSE jsonb_build_object('store_id',NEW."store_id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."pos_store_settings";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."pos_store_settings" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_pos_store_settings();

REVOKE ALL ON FUNCTION public.sync_feed_pos_store_settings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_settings_scoped(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."settings_scoped" ("scope","scope_id","key","value","is_overridden","updated_by","created_at","updated_at","row_version")
  SELECT "scope","scope_id","key","value","is_overridden","updated_by","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."settings_scoped", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("scope","scope_id","key") DO UPDATE SET "value"=EXCLUDED."value","is_overridden"=EXCLUDED."is_overridden","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."settings_scoped"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_scoped(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."settings_scoped" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))) AND x."scope"::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope') AND x."scope_id"::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id') AND x."key"::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_settings_scoped(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_settings_scoped(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_settings_scoped() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'settings_scoped',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('scope',OLD."scope",'scope_id',OLD."scope_id",'key',OLD."key")::text ELSE jsonb_build_object('scope',NEW."scope",'scope_id',NEW."scope_id",'key',NEW."key")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope,OLD.scope))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope,OLD.scope))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope,OLD.scope))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text UNION ALL SELECT token.location_id::text,COALESCE(NEW.scope_id,OLD.scope_id)::text FROM public.terminal_tokens token WHERE lower(COALESCE(NEW.scope,OLD.scope))='terminal' AND token.id::text=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."settings_scoped";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."settings_scoped" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_settings_scoped();

REVOKE ALL ON FUNCTION public.sync_feed_settings_scoped() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_count_drafts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_count_drafts" ("id","store_id","terminal_id","staff_id","staff_name","status","reason","note","lines","line_count","total_impact","posted_at","posted_by","created_at","updated_at","reference","store_code","pending_edit_request_id","pending_edit_by","pending_edit_at")
  SELECT "id","store_id","terminal_id","staff_id","staff_name","status","reason","note","lines","line_count","total_impact","posted_at","posted_by","created_at","updated_at","reference","store_code","pending_edit_request_id","pending_edit_by","pending_edit_at" FROM jsonb_populate_recordset(NULL::public."stock_count_drafts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","staff_id"=EXCLUDED."staff_id","staff_name"=EXCLUDED."staff_name","status"=EXCLUDED."status","reason"=EXCLUDED."reason","note"=EXCLUDED."note","lines"=EXCLUDED."lines","line_count"=EXCLUDED."line_count","total_impact"=EXCLUDED."total_impact","posted_at"=EXCLUDED."posted_at","posted_by"=EXCLUDED."posted_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","reference"=EXCLUDED."reference","store_code"=EXCLUDED."store_code","pending_edit_request_id"=EXCLUDED."pending_edit_request_id","pending_edit_by"=EXCLUDED."pending_edit_by","pending_edit_at"=EXCLUDED."pending_edit_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_stock_count_drafts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."stock_count_drafts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_stock_count_drafts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_stock_count_drafts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_stock_count_drafts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'stock_count_drafts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."stock_count_drafts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."stock_count_drafts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_stock_count_drafts();

REVOKE ALL ON FUNCTION public.sync_feed_stock_count_drafts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_actions(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_actions" ("id","action_key","scope_type","scope_id","mode","allowed_roles","allowed_user_ids","requester_roles","requester_user_ids","authority_limits","extra_authority","absolute_ceilings","approval_timeout_minutes","escalation_after_minutes","escalation_roles","require_reason","threshold","is_enabled","row_version","updated_by","created_at","updated_at")
  SELECT "id","action_key","scope_type","scope_id","mode","allowed_roles","allowed_user_ids","requester_roles","requester_user_ids","authority_limits","extra_authority","absolute_ceilings","approval_timeout_minutes","escalation_after_minutes","escalation_roles","require_reason","threshold","is_enabled","row_version","updated_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."authorization_actions", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "action_key"=EXCLUDED."action_key","scope_type"=EXCLUDED."scope_type","scope_id"=EXCLUDED."scope_id","mode"=EXCLUDED."mode","allowed_roles"=EXCLUDED."allowed_roles","allowed_user_ids"=EXCLUDED."allowed_user_ids","requester_roles"=EXCLUDED."requester_roles","requester_user_ids"=EXCLUDED."requester_user_ids","authority_limits"=EXCLUDED."authority_limits","extra_authority"=EXCLUDED."extra_authority","absolute_ceilings"=EXCLUDED."absolute_ceilings","approval_timeout_minutes"=EXCLUDED."approval_timeout_minutes","escalation_after_minutes"=EXCLUDED."escalation_after_minutes","escalation_roles"=EXCLUDED."escalation_roles","require_reason"=EXCLUDED."require_reason","threshold"=EXCLUDED."threshold","is_enabled"=EXCLUDED."is_enabled","row_version"=EXCLUDED."row_version","updated_by"=EXCLUDED."updated_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at" WHERE (EXCLUDED."row_version",EXCLUDED."updated_at",COALESCE(EXCLUDED."updated_by",''))>(public."authorization_actions"."row_version",public."authorization_actions"."updated_at",COALESCE(public."authorization_actions"."updated_by",''));
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_actions(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_actions" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)))) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_actions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_actions(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_actions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_actions',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_actions";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_actions" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_actions();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_actions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_action_history(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_action_history" ("id","action_id","action_key","scope_type","scope_id","row_version","changed_by","change_source","change_kind","snapshot","created_at")
  SELECT "id","action_id","action_key","scope_type","scope_id","row_version","changed_by","change_source","change_kind","snapshot","created_at" FROM jsonb_populate_recordset(NULL::public."authorization_action_history", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_action_history(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_action_history(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_action_history(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_action_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_action_history',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='global' UNION ALL SELECT COALESCE(NEW.scope_id,OLD.scope_id)::text,NULL::text WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(COALESCE(NEW.scope_type,OLD.scope_type))='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=COALESCE(NEW.scope_id,OLD.scope_id)::text) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_action_history";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_action_history" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_action_history();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_action_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_requests(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_requests" ("id","action_key","requested_by","requested_by_name","store_id","terminal_id","reason","payload","status","decided_by","decided_by_name","decided_at","decision_note","expires_at","consumed_at","requester_direct_limit","value_unit","created_at","updated_at","approval_route","requested_amount","approved_amount","approved_payload","bill_snapshot","snapshot_hash","held_order_id","notified_at")
  SELECT "id","action_key","requested_by","requested_by_name","store_id","terminal_id","reason","payload","status","decided_by","decided_by_name","decided_at","decision_note","expires_at","consumed_at","requester_direct_limit","value_unit","created_at","updated_at","approval_route","requested_amount","approved_amount","approved_payload","bill_snapshot","snapshot_hash","held_order_id","notified_at" FROM jsonb_populate_recordset(NULL::public."authorization_requests", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_requests(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_requests" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_requests(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_requests(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_requests',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_requests";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_requests" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_requests();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_requests() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_log(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."authorization_log" ("id","action_key","mode_used","request_id","requested_by","authorized_by","authorizer_role","store_id","terminal_id","outcome","detail","created_at")
  SELECT "id","action_key","mode_used","request_id","requested_by","authorized_by","authorizer_role","store_id","terminal_id","outcome","detail","created_at" FROM jsonb_populate_recordset(NULL::public."authorization_log", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_authorization_log(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."authorization_log" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_log(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_authorization_log(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'authorization_log',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."authorization_log";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."authorization_log" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_log();

REVOKE ALL ON FUNCTION public.sync_feed_authorization_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_record_edits(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."record_edits" ("id","record_type","record_id","reference","store_id","terminal_id","action_key","request_id","edited_by","edited_by_name","authorized_by","authorized_by_name","mode_used","before_value","after_value","stock_deltas","note","created_at")
  SELECT "id","record_type","record_id","reference","store_id","terminal_id","action_key","request_id","edited_by","edited_by_name","authorized_by","authorized_by_name","mode_used","before_value","after_value","stock_deltas","note","created_at" FROM jsonb_populate_recordset(NULL::public."record_edits", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "record_type"=EXCLUDED."record_type","record_id"=EXCLUDED."record_id","reference"=EXCLUDED."reference","store_id"=EXCLUDED."store_id","terminal_id"=EXCLUDED."terminal_id","action_key"=EXCLUDED."action_key","request_id"=EXCLUDED."request_id","edited_by"=EXCLUDED."edited_by","edited_by_name"=EXCLUDED."edited_by_name","authorized_by"=EXCLUDED."authorized_by","authorized_by_name"=EXCLUDED."authorized_by_name","mode_used"=EXCLUDED."mode_used","before_value"=EXCLUDED."before_value","after_value"=EXCLUDED."after_value","stock_deltas"=EXCLUDED."stock_deltas","note"=EXCLUDED."note","created_at"=EXCLUDED."created_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_record_edits(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."record_edits" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_record_edits(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_record_edits(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_record_edits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'record_edits',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."record_edits";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."record_edits" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_record_edits();

REVOKE ALL ON FUNCTION public.sync_feed_record_edits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_cash_counts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_cash_counts" ("id","shift_id","store_id","terminal_id","kind","counted_cash","counted_card","counted_digital","reason","counted_by_name","counted_by_staff_id","counted_by_user_id","client_key","created_at")
  SELECT "id","shift_id","store_id","terminal_id","kind","counted_cash","counted_card","counted_digital","reason","counted_by_name","counted_by_staff_id","counted_by_user_id","client_key","created_at" FROM jsonb_populate_recordset(NULL::public."shift_cash_counts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_cash_counts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_cash_counts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_cash_counts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_cash_counts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_cash_counts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_cash_counts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_cash_counts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_cash_counts();

REVOKE ALL ON FUNCTION public.sync_feed_shift_cash_counts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_close_events(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_close_events" ("id","shift_id","store_id","terminal_id","event","from_state","to_state","detail","actor_name","actor_staff_id","actor_user_id","created_at")
  SELECT "id","shift_id","store_id","terminal_id","event","from_state","to_state","detail","actor_name","actor_staff_id","actor_user_id","created_at" FROM jsonb_populate_recordset(NULL::public."shift_close_events", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_close_events(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_close_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_close_events(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_close_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_close_events',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_close_events";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_close_events" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_close_events();

REVOKE ALL ON FUNCTION public.sync_feed_shift_close_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_reconciliations(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN

  PERFORM set_config('pos.shift_fn','on',true);
  INSERT INTO public."shift_reconciliations" ("id","shift_id","store_id","count_id","expected_cash","expected_card","expected_digital","counted_cash","counted_card","counted_digital","variance_cash","variance_card","variance_digital","variance_total","variance_status","created_at")
  SELECT "id","shift_id","store_id","count_id","expected_cash","expected_card","expected_digital","counted_cash","counted_card","counted_digital","variance_cash","variance_card","variance_digital","variance_total","variance_status","created_at" FROM jsonb_populate_recordset(NULL::public."shift_reconciliations", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;

  PERFORM set_config('pos.shift_fn','',true);

  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_reconciliations(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_reconciliations(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_reconciliations(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_reconciliations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_reconciliations',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_reconciliations";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_reconciliations" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_reconciliations();

REVOKE ALL ON FUNCTION public.sync_feed_shift_reconciliations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_variance_alerts(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_variance_alerts" ("id","shift_id","store_id","reconciliation_id","variance_total","variance_status","severity","message","delivery_status","attempts","last_error","last_attempt_at","acknowledged_at","acknowledged_by","created_at","updated_at")
  SELECT "id","shift_id","store_id","reconciliation_id","variance_total","variance_status","severity","message","delivery_status","attempts","last_error","last_attempt_at","acknowledged_at","acknowledged_by","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."shift_variance_alerts", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "shift_id"=EXCLUDED."shift_id","store_id"=EXCLUDED."store_id","reconciliation_id"=EXCLUDED."reconciliation_id","variance_total"=EXCLUDED."variance_total","variance_status"=EXCLUDED."variance_status","severity"=EXCLUDED."severity","message"=EXCLUDED."message","delivery_status"=EXCLUDED."delivery_status","attempts"=EXCLUDED."attempts","last_error"=EXCLUDED."last_error","last_attempt_at"=EXCLUDED."last_attempt_at","acknowledged_at"=EXCLUDED."acknowledged_at","acknowledged_by"=EXCLUDED."acknowledged_by","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_variance_alerts(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."shift_variance_alerts" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_variance_alerts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_variance_alerts(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_variance_alerts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_variance_alerts',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_variance_alerts";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_variance_alerts" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_variance_alerts();

REVOKE ALL ON FUNCTION public.sync_feed_shift_variance_alerts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_shift_notifications(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."shift_notifications" ("id","shift_id","store_id","store_name","terminal_name","closed_by","opened_at","closed_at","total_sales","transactions","discounts","refunds","expected_cash","counted_cash","payment_breakdown","summary","channels","created_at")
  SELECT "id","shift_id","store_id","store_name","terminal_name","closed_by","opened_at","closed_at","total_sales","transactions","discounts","refunds","expected_cash","counted_cash","payment_breakdown","summary","channels","created_at" FROM jsonb_populate_recordset(NULL::public."shift_notifications", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_shift_notifications(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN RETURN 0; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_shift_notifications(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_shift_notifications(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_shift_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'shift_notifications',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."shift_notifications";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_notifications" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_shift_notifications();

REVOKE ALL ON FUNCTION public.sync_feed_shift_notifications() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_entity_status_history(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."entity_status_history" ("id","entity_type","entity_id","status_kind","previous_status","new_status","reason","actor_id","actor_name","actor_role","store_id","branch_id","terminal_id","related_entity_type","related_entity_id","metadata","client_event_id","occurred_at","created_at","updated_at","row_version")
  SELECT "id","entity_type","entity_id","status_kind","previous_status","new_status","reason","actor_id","actor_name","actor_role","store_id","branch_id","terminal_id","related_entity_type","related_entity_id","metadata","client_event_id","occurred_at","created_at","updated_at","row_version" FROM jsonb_populate_recordset(NULL::public."entity_status_history", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "entity_type"=EXCLUDED."entity_type","entity_id"=EXCLUDED."entity_id","status_kind"=EXCLUDED."status_kind","previous_status"=EXCLUDED."previous_status","new_status"=EXCLUDED."new_status","reason"=EXCLUDED."reason","actor_id"=EXCLUDED."actor_id","actor_name"=EXCLUDED."actor_name","actor_role"=EXCLUDED."actor_role","store_id"=EXCLUDED."store_id","branch_id"=EXCLUDED."branch_id","terminal_id"=EXCLUDED."terminal_id","related_entity_type"=EXCLUDED."related_entity_type","related_entity_id"=EXCLUDED."related_entity_id","metadata"=EXCLUDED."metadata","client_event_id"=EXCLUDED."client_event_id","occurred_at"=EXCLUDED."occurred_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."entity_status_history"."row_version";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_entity_status_history(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."entity_status_history" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (x.store_id::text=p_branch_id) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_entity_status_history(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_entity_status_history(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_entity_status_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'entity_status_history',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE' FROM (SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."entity_status_history";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."entity_status_history" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_entity_status_history();

REVOKE ALL ON FUNCTION public.sync_feed_entity_status_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_nav_pins(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."nav_pins" ("id","owner_id","item_kind","item_key","sort_order","created_at","updated_at")
  SELECT "id","owner_id","item_kind","item_key","sort_order","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."nav_pins", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "owner_id"=EXCLUDED."owner_id","item_kind"=EXCLUDED."item_kind","item_key"=EXCLUDED."item_key","sort_order"=EXCLUDED."sort_order","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_nav_pins(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."nav_pins" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_nav_pins(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_nav_pins(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_nav_pins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'nav_pins',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."nav_pins";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."nav_pins" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_nav_pins();

REVOKE ALL ON FUNCTION public.sync_feed_nav_pins() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_apply_store_groups(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."store_groups" ("id","code","name","is_active","archived_at","created_at","updated_at")
  SELECT "id","code","name","is_active","archived_at","created_at","updated_at" FROM jsonb_populate_recordset(NULL::public."store_groups", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET "code"=EXCLUDED."code","name"=EXCLUDED."name","is_active"=EXCLUDED."is_active","archived_at"=EXCLUDED."archived_at","created_at"=EXCLUDED."created_at","updated_at"=EXCLUDED."updated_at";
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_store_groups(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN DELETE FROM public."store_groups" x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (true) AND x."id"::text=COALESCE(c->'key'->>'id',(c->>'entityId')::jsonb->>'id',(c->>'entity_id')::jsonb->>'id');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_store_groups(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_store_groups(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_store_groups() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT 'default',branches.branch_id,branches.terminal_id,'store_groups',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD."id")::text ELSE jsonb_build_object('id',NEW."id")::text END,lower(TG_OP),1,TG_OP='DELETE' FROM (SELECT 'global'::text branch_id,NULL::text terminal_id) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public."store_groups";
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."store_groups" FOR EACH ROW EXECUTE FUNCTION public.sync_feed_store_groups();

REVOKE ALL ON FUNCTION public.sync_feed_store_groups() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_sync_push_batch(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_rows jsonb,p_changes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_count integer:=0; v_hash text:=md5(p_table||COALESCE(p_rows,'[]'::jsonb)::text||COALESCE(p_changes,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF auth.role()<>'service_role' THEN
  SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
 END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 CASE p_table WHEN 'coupon_campaigns' THEN  v_count:=public.sync_apply_coupon_campaigns(p_rows)+public.sync_delete_coupon_campaigns(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shifts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shifts(p_rows)+public.sync_delete_shifts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'issued_vouchers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_issued_vouchers(p_rows)+public.sync_delete_issued_vouchers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'activity_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_activity_events(p_rows)+public.sync_delete_activity_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(p_rows)+public.sync_delete_audit_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'booking_payments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=r->>'booking_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_booking_payments(p_rows)+public.sync_delete_booking_payments(p_changes,p_branch_id,p_terminal_id);
    WHEN 'bookings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_bookings(p_rows)+public.sync_delete_bookings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'branch_telemetry' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_branch_telemetry(p_rows)+public.sync_delete_branch_telemetry(p_changes,p_branch_id,p_terminal_id);
    WHEN 'coupon_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_coupon_events(p_rows)+public.sync_delete_coupon_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'drawer_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_drawer_events(p_rows)+public.sync_delete_drawer_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'held_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_held_orders(p_rows)+public.sync_delete_held_orders(p_changes,p_branch_id,p_terminal_id);
    WHEN 'integration_settings' THEN  v_count:=public.sync_apply_integration_settings(p_rows)+public.sync_delete_integration_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'item_activity_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_item_activity_logs(p_rows)+public.sync_delete_item_activity_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'member_verifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_member_verifications(p_rows)+public.sync_delete_member_verifications(p_changes,p_branch_id,p_terminal_id);
    WHEN 'members' THEN  v_count:=public.sync_apply_members(p_rows)+public.sync_delete_members(p_changes,p_branch_id,p_terminal_id);
    WHEN 'membership_tiers' THEN  v_count:=public.sync_apply_membership_tiers(p_rows)+public.sync_delete_membership_tiers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'offline_sync_audit_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_offline_sync_audit_log(p_rows)+public.sync_delete_offline_sync_audit_log(p_changes,p_branch_id,p_terminal_id);
    WHEN 'payment_transactions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_payment_transactions(p_rows)+public.sync_delete_payment_transactions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'payment_types' THEN  v_count:=public.sync_apply_payment_types(p_rows)+public.sync_delete_payment_types(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pin_attempts' THEN  v_count:=public.sync_apply_pin_attempts(p_rows)+public.sync_delete_pin_attempts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pos_settings' THEN  v_count:=public.sync_apply_pos_settings(p_rows)+public.sync_delete_pos_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'product_barcodes' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'product_id' AND p.owner_store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_product_barcodes(p_rows)+public.sync_delete_product_barcodes(p_changes,p_branch_id,p_terminal_id);
    WHEN 'product_categories' THEN  v_count:=public.sync_apply_product_categories(p_rows)+public.sync_delete_product_categories(p_changes,p_branch_id,p_terminal_id);
    WHEN 'products' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_products(p_rows)+public.sync_delete_products(p_changes,p_branch_id,p_terminal_id);
    WHEN 'promotions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'foc_product_id' AND p.owner_store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_promotions(p_rows)+public.sync_delete_promotions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'purchase_order_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=r->>'po_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_order_items(p_rows)+public.sync_delete_purchase_order_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'purchase_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_orders(p_rows)+public.sync_delete_purchase_orders(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(p_rows)+public.sync_delete_sale_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sales' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sales(p_rows)+public.sync_delete_sales(p_changes,p_branch_id,p_terminal_id);
    WHEN 'settings_overrides' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT ((lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id))) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_settings_overrides(p_rows)+public.sync_delete_settings_overrides(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_sessions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_sessions(p_rows)+public.sync_delete_shift_sessions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sku_audit' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sku_audit(p_rows)+public.sync_delete_sku_audit(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_adjustments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_adjustments(p_rows)+public.sync_delete_stock_adjustments(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_delta_applied' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_delta_applied(p_rows)+public.sync_delete_stock_delta_applied(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_transfer_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=r->>'transfer_id' AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfer_items(p_rows)+public.sync_delete_stock_transfer_items(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_transfers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE p_branch_id<>COALESCE(r->>'from_store_id','') AND p_branch_id<>COALESCE(r->>'to_store_id','')) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfers(p_rows)+public.sync_delete_stock_transfers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stores' THEN  v_count:=public.sync_apply_stores(p_rows)+public.sync_delete_stores(p_changes,p_branch_id,p_terminal_id);
    WHEN 'suppliers' THEN  v_count:=public.sync_apply_suppliers(p_rows)+public.sync_delete_suppliers(p_changes,p_branch_id,p_terminal_id);
    WHEN 'sync_metadata' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sync_metadata(p_rows)+public.sync_delete_sync_metadata(p_changes,p_branch_id,p_terminal_id);
    WHEN 'system_audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_system_audit_logs(p_rows)+public.sync_delete_system_audit_logs(p_changes,p_branch_id,p_terminal_id);
    WHEN 'terminal_commands' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_terminal_commands(p_rows)+public.sync_delete_terminal_commands(p_changes,p_branch_id,p_terminal_id);
    WHEN 'uom_units' THEN  v_count:=public.sync_apply_uom_units(p_rows)+public.sync_delete_uom_units(p_changes,p_branch_id,p_terminal_id);
    WHEN 'whatsapp_queue' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_whatsapp_queue(p_rows)+public.sync_delete_whatsapp_queue(p_changes,p_branch_id,p_terminal_id);
    WHEN 'pos_store_settings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_pos_store_settings(p_rows)+public.sync_delete_pos_store_settings(p_changes,p_branch_id,p_terminal_id);
    WHEN 'settings_scoped' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT ((lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id))) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_settings_scoped(p_rows)+public.sync_delete_settings_scoped(p_changes,p_branch_id,p_terminal_id);
    WHEN 'stock_count_drafts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_count_drafts(p_rows)+public.sync_delete_stock_count_drafts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_actions' THEN  v_count:=public.sync_apply_authorization_actions(p_rows)+public.sync_delete_authorization_actions(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_action_history' THEN  v_count:=public.sync_apply_authorization_action_history(p_rows)+public.sync_delete_authorization_action_history(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_requests' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_requests(p_rows)+public.sync_delete_authorization_requests(p_changes,p_branch_id,p_terminal_id);
    WHEN 'authorization_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_log(p_rows)+public.sync_delete_authorization_log(p_changes,p_branch_id,p_terminal_id);
    WHEN 'record_edits' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_record_edits(p_rows)+public.sync_delete_record_edits(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_cash_counts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_cash_counts(p_rows)+public.sync_delete_shift_cash_counts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_close_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_close_events(p_rows)+public.sync_delete_shift_close_events(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_reconciliations' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_reconciliations(p_rows)+public.sync_delete_shift_reconciliations(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_variance_alerts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_variance_alerts(p_rows)+public.sync_delete_shift_variance_alerts(p_changes,p_branch_id,p_terminal_id);
    WHEN 'shift_notifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_notifications(p_rows)+public.sync_delete_shift_notifications(p_changes,p_branch_id,p_terminal_id);
    WHEN 'entity_status_history' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_entity_status_history(p_rows)+public.sync_delete_entity_status_history(p_changes,p_branch_id,p_terminal_id);
    WHEN 'nav_pins' THEN  v_count:=public.sync_apply_nav_pins(p_rows)+public.sync_delete_nav_pins(p_changes,p_branch_id,p_terminal_id);
    WHEN 'store_groups' THEN  v_count:=public.sync_apply_store_groups(p_rows)+public.sync_delete_store_groups(p_changes,p_branch_id,p_terminal_id); ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,p_table,v_hash,v_count);
 RETURN jsonb_build_object('ok',true,'applied',v_count,'batch_id',p_batch_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_push_aggregate(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_op jsonb; v_table text; v_rows jsonb; v_count integer:=0; v_total integer:=0; v_hash text:=md5(COALESCE(p_operations,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF jsonb_typeof(p_operations)<>'array' OR jsonb_array_length(p_operations)>200 THEN RAISE EXCEPTION 'SYNC_AGGREGATE_INVALID'; END IF;
 IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP v_table:=v_op->>'table'; v_rows:=COALESCE(v_op->'rows','[]'::jsonb);
  IF v_table='products' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) related WHERE related->>'table' IN ('item_activity_logs','stock_delta_applied')) THEN
   SELECT COALESCE(jsonb_agg((row_value-'stock_quantity'-'stock_by_store')||jsonb_build_object('stock_quantity',0,'stock_by_store','{}'::jsonb)),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) AS product_rows(row_value);
  END IF;
  CASE v_table WHEN 'coupon_campaigns' THEN  v_count:=public.sync_apply_coupon_campaigns(v_rows)+public.sync_delete_coupon_campaigns(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shifts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shifts(v_rows)+public.sync_delete_shifts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'issued_vouchers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_issued_vouchers(v_rows)+public.sync_delete_issued_vouchers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'activity_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_activity_events(v_rows)+public.sync_delete_activity_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(v_rows)+public.sync_delete_audit_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'booking_payments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=r->>'booking_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_booking_payments(v_rows)+public.sync_delete_booking_payments(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'bookings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_bookings(v_rows)+public.sync_delete_bookings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'branch_telemetry' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_branch_telemetry(v_rows)+public.sync_delete_branch_telemetry(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'coupon_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_coupon_events(v_rows)+public.sync_delete_coupon_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'drawer_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_drawer_events(v_rows)+public.sync_delete_drawer_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'held_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_held_orders(v_rows)+public.sync_delete_held_orders(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'integration_settings' THEN  v_count:=public.sync_apply_integration_settings(v_rows)+public.sync_delete_integration_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'item_activity_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_item_activity_logs(v_rows)+public.sync_delete_item_activity_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'member_verifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_member_verifications(v_rows)+public.sync_delete_member_verifications(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'members' THEN  v_count:=public.sync_apply_members(v_rows)+public.sync_delete_members(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'membership_tiers' THEN  v_count:=public.sync_apply_membership_tiers(v_rows)+public.sync_delete_membership_tiers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'offline_sync_audit_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_offline_sync_audit_log(v_rows)+public.sync_delete_offline_sync_audit_log(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'payment_transactions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_payment_transactions(v_rows)+public.sync_delete_payment_transactions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'payment_types' THEN  v_count:=public.sync_apply_payment_types(v_rows)+public.sync_delete_payment_types(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pin_attempts' THEN  v_count:=public.sync_apply_pin_attempts(v_rows)+public.sync_delete_pin_attempts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pos_settings' THEN  v_count:=public.sync_apply_pos_settings(v_rows)+public.sync_delete_pos_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'product_barcodes' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'product_id' AND p.owner_store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_product_barcodes(v_rows)+public.sync_delete_product_barcodes(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'product_categories' THEN  v_count:=public.sync_apply_product_categories(v_rows)+public.sync_delete_product_categories(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'products' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_products(v_rows)+public.sync_delete_products(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'promotions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=r->>'foc_product_id' AND p.owner_store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_promotions(v_rows)+public.sync_delete_promotions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'purchase_order_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=r->>'po_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_order_items(v_rows)+public.sync_delete_purchase_order_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'purchase_orders' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_purchase_orders(v_rows)+public.sync_delete_purchase_orders(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(v_rows)+public.sync_delete_sale_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sales' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sales(v_rows)+public.sync_delete_sales(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'settings_overrides' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT ((lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id))) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_settings_overrides(v_rows)+public.sync_delete_settings_overrides(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_sessions' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_sessions(v_rows)+public.sync_delete_shift_sessions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sku_audit' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sku_audit(v_rows)+public.sync_delete_sku_audit(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_adjustments' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_adjustments(v_rows)+public.sync_delete_stock_adjustments(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_delta_applied' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_delta_applied(v_rows)+public.sync_delete_stock_delta_applied(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_transfer_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=r->>'transfer_id' AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfer_items(v_rows)+public.sync_delete_stock_transfer_items(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_transfers' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE p_branch_id<>COALESCE(r->>'from_store_id','') AND p_branch_id<>COALESCE(r->>'to_store_id','')) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_transfers(v_rows)+public.sync_delete_stock_transfers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stores' THEN  v_count:=public.sync_apply_stores(v_rows)+public.sync_delete_stores(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'suppliers' THEN  v_count:=public.sync_apply_suppliers(v_rows)+public.sync_delete_suppliers(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'sync_metadata' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sync_metadata(v_rows)+public.sync_delete_sync_metadata(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'system_audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_system_audit_logs(v_rows)+public.sync_delete_system_audit_logs(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'terminal_commands' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_terminal_commands(v_rows)+public.sync_delete_terminal_commands(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'uom_units' THEN  v_count:=public.sync_apply_uom_units(v_rows)+public.sync_delete_uom_units(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'whatsapp_queue' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_whatsapp_queue(v_rows)+public.sync_delete_whatsapp_queue(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'pos_store_settings' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_pos_store_settings(v_rows)+public.sync_delete_pos_store_settings(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'settings_scoped' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT ((lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id))) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; v_count:=public.sync_apply_settings_scoped(v_rows)+public.sync_delete_settings_scoped(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'stock_count_drafts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_stock_count_drafts(v_rows)+public.sync_delete_stock_count_drafts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_actions' THEN  v_count:=public.sync_apply_authorization_actions(v_rows)+public.sync_delete_authorization_actions(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_action_history' THEN  v_count:=public.sync_apply_authorization_action_history(v_rows)+public.sync_delete_authorization_action_history(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_requests' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_requests(v_rows)+public.sync_delete_authorization_requests(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'authorization_log' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_authorization_log(v_rows)+public.sync_delete_authorization_log(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'record_edits' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_record_edits(v_rows)+public.sync_delete_record_edits(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_cash_counts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_cash_counts(v_rows)+public.sync_delete_shift_cash_counts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_close_events' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_close_events(v_rows)+public.sync_delete_shift_close_events(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_reconciliations' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_reconciliations(v_rows)+public.sync_delete_shift_reconciliations(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_variance_alerts' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_variance_alerts(v_rows)+public.sync_delete_shift_variance_alerts(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'shift_notifications' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_shift_notifications(v_rows)+public.sync_delete_shift_notifications(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'entity_status_history' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_entity_status_history(v_rows)+public.sync_delete_entity_status_history(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'nav_pins' THEN  v_count:=public.sync_apply_nav_pins(v_rows)+public.sync_delete_nav_pins(v_op->'changes',p_branch_id,p_terminal_id);
    WHEN 'store_groups' THEN  v_count:=public.sync_apply_store_groups(v_rows)+public.sync_delete_store_groups(v_op->'changes',p_branch_id,p_terminal_id); ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE; v_total:=v_total+v_count;
 END LOOP;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,'__aggregate__',v_hash,v_total);
 RETURN jsonb_build_object('ok',true,'applied',v_total,'batch_id',p_batch_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_pull(p_organization_id text,p_branch_id text,p_terminal_id text,p_after_cursor bigint DEFAULT 0,p_limit integer DEFAULT 500)
RETURNS TABLE(cursor bigint,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,row_data jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY SELECT f.cursor,f.table_name,f.entity_id,f.operation,f.row_version,f.tombstone,CASE f.table_name WHEN 'coupon_campaigns' THEN (SELECT to_jsonb(x) FROM public."coupon_campaigns" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shifts' THEN (SELECT to_jsonb(x) FROM public."shifts" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'issued_vouchers' THEN (SELECT to_jsonb(x) FROM public."issued_vouchers" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'activity_events' THEN (SELECT to_jsonb(x) FROM public."activity_events" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'app_users' THEN (SELECT to_jsonb(x) FROM public."app_users" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'audit_logs' THEN (SELECT to_jsonb(x) FROM public."audit_logs" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'booking_payments' THEN (SELECT to_jsonb(x) FROM public."booking_payments" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'bookings' THEN (SELECT to_jsonb(x) FROM public."bookings" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'branch_telemetry' THEN (SELECT to_jsonb(x) FROM public."branch_telemetry" x WHERE x."terminal_id"::text=(f.entity_id::jsonb)->>'terminal_id' LIMIT 1)
    WHEN 'cashiers' THEN (SELECT to_jsonb(x) FROM public."cashiers" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'coupon_events' THEN (SELECT to_jsonb(x) FROM public."coupon_events" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'drawer_events' THEN (SELECT to_jsonb(x) FROM public."drawer_events" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'held_orders' THEN (SELECT to_jsonb(x) FROM public."held_orders" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'integration_settings' THEN (SELECT to_jsonb(x) FROM public."integration_settings" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'item_activity_logs' THEN (SELECT to_jsonb(x) FROM public."item_activity_logs" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'member_verifications' THEN (SELECT to_jsonb(x) FROM public."member_verifications" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'members' THEN (SELECT to_jsonb(x) FROM public."members" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'membership_tiers' THEN (SELECT to_jsonb(x) FROM public."membership_tiers" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'offline_sync_audit_log' THEN (SELECT to_jsonb(x) FROM public."offline_sync_audit_log" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'payment_transactions' THEN (SELECT to_jsonb(x) FROM public."payment_transactions" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'payment_types' THEN (SELECT to_jsonb(x) FROM public."payment_types" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'pin_attempts' THEN (SELECT to_jsonb(x) FROM public."pin_attempts" x WHERE x."key"::text=(f.entity_id::jsonb)->>'key' LIMIT 1)
    WHEN 'pos_settings' THEN (SELECT to_jsonb(x) FROM public."pos_settings" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'product_barcodes' THEN (SELECT to_jsonb(x) FROM public."product_barcodes" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'product_categories' THEN (SELECT to_jsonb(x) FROM public."product_categories" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'products' THEN (SELECT to_jsonb(x) FROM public."products" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'promotions' THEN (SELECT to_jsonb(x) FROM public."promotions" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'public_flags' THEN (SELECT to_jsonb(x) FROM public."public_flags" x WHERE x."key"::text=(f.entity_id::jsonb)->>'key' LIMIT 1)
    WHEN 'purchase_order_items' THEN (SELECT to_jsonb(x) FROM public."purchase_order_items" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'purchase_orders' THEN (SELECT to_jsonb(x) FROM public."purchase_orders" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public."sale_items" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'sales' THEN (SELECT to_jsonb(x) FROM public."sales" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'secure_settings' THEN (SELECT to_jsonb(x) FROM public."secure_settings" x WHERE x."key"::text=(f.entity_id::jsonb)->>'key' LIMIT 1)
    WHEN 'security_findings' THEN (SELECT to_jsonb(x) FROM public."security_findings" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'settings_locks' THEN (SELECT to_jsonb(x) FROM public."settings_locks" x WHERE x."section"::text=(f.entity_id::jsonb)->>'section' LIMIT 1)
    WHEN 'settings_overrides' THEN (SELECT to_jsonb(x) FROM public."settings_overrides" x WHERE x."scope"::text=(f.entity_id::jsonb)->>'scope' AND x."scope_id"::text=(f.entity_id::jsonb)->>'scope_id' AND x."section"::text=(f.entity_id::jsonb)->>'section' LIMIT 1)
    WHEN 'shift_sessions' THEN (SELECT to_jsonb(x) FROM public."shift_sessions" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'sku_audit' THEN (SELECT to_jsonb(x) FROM public."sku_audit" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'staff_roles' THEN (SELECT to_jsonb(x) FROM public."staff_roles" x WHERE x."slug"::text=(f.entity_id::jsonb)->>'slug' LIMIT 1)
    WHEN 'stock_adjustments' THEN (SELECT to_jsonb(x) FROM public."stock_adjustments" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'stock_delta_applied' THEN (SELECT to_jsonb(x) FROM public."stock_delta_applied" x WHERE x."movement_id"::text=(f.entity_id::jsonb)->>'movement_id' LIMIT 1)
    WHEN 'stock_transfer_items' THEN (SELECT to_jsonb(x) FROM public."stock_transfer_items" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'stock_transfers' THEN (SELECT to_jsonb(x) FROM public."stock_transfers" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'stores' THEN (SELECT to_jsonb(x) FROM public."stores" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'suppliers' THEN (SELECT to_jsonb(x) FROM public."suppliers" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'sync_metadata' THEN (SELECT to_jsonb(x) FROM public."sync_metadata" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'system_audit_logs' THEN (SELECT to_jsonb(x) FROM public."system_audit_logs" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'terminal_commands' THEN (SELECT to_jsonb(x) FROM public."terminal_commands" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'terminal_tokens' THEN (SELECT to_jsonb(x) FROM public."terminal_tokens" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'uom_units' THEN (SELECT to_jsonb(x) FROM public."uom_units" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'user_roles' THEN (SELECT to_jsonb(x) FROM public."user_roles" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'whatsapp_queue' THEN (SELECT to_jsonb(x) FROM public."whatsapp_queue" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'terminal_recovery_secrets' THEN (SELECT to_jsonb(x) FROM public."terminal_recovery_secrets" x WHERE x."terminal_token_id"::text=(f.entity_id::jsonb)->>'terminal_token_id' LIMIT 1)
    WHEN 'pos_store_settings' THEN (SELECT to_jsonb(x) FROM public."pos_store_settings" x WHERE x."store_id"::text=(f.entity_id::jsonb)->>'store_id' LIMIT 1)
    WHEN 'settings_scoped' THEN (SELECT to_jsonb(x) FROM public."settings_scoped" x WHERE x."scope"::text=(f.entity_id::jsonb)->>'scope' AND x."scope_id"::text=(f.entity_id::jsonb)->>'scope_id' AND x."key"::text=(f.entity_id::jsonb)->>'key' LIMIT 1)
    WHEN 'stock_count_drafts' THEN (SELECT to_jsonb(x) FROM public."stock_count_drafts" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'authorization_actions' THEN (SELECT to_jsonb(x) FROM public."authorization_actions" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'authorization_action_history' THEN (SELECT to_jsonb(x) FROM public."authorization_action_history" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'authorization_requests' THEN (SELECT to_jsonb(x) FROM public."authorization_requests" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'authorization_log' THEN (SELECT to_jsonb(x) FROM public."authorization_log" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'record_edits' THEN (SELECT to_jsonb(x) FROM public."record_edits" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shift_cash_counts' THEN (SELECT to_jsonb(x) FROM public."shift_cash_counts" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shift_close_events' THEN (SELECT to_jsonb(x) FROM public."shift_close_events" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shift_reconciliations' THEN (SELECT to_jsonb(x) FROM public."shift_reconciliations" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shift_variance_alerts' THEN (SELECT to_jsonb(x) FROM public."shift_variance_alerts" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'shift_notifications' THEN (SELECT to_jsonb(x) FROM public."shift_notifications" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'entity_status_history' THEN (SELECT to_jsonb(x) FROM public."entity_status_history" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'nav_pins' THEN (SELECT to_jsonb(x) FROM public."nav_pins" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1)
    WHEN 'store_groups' THEN (SELECT to_jsonb(x) FROM public."store_groups" x WHERE x."id"::text=(f.entity_id::jsonb)->>'id' LIMIT 1) ELSE NULL END
 FROM public.sync_change_feed f WHERE f.organization_id=p_organization_id AND f.branch_id IN (p_branch_id,'global') AND (f.terminal_id IS NULL OR f.terminal_id=p_terminal_id) AND f.cursor>p_after_cursor ORDER BY f.cursor LIMIT LEAST(GREATEST(p_limit,100),2000);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text DEFAULT NULL,p_history_days integer DEFAULT 90,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 CASE p_table WHEN 'coupon_campaigns' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."coupon_campaigns" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shifts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shifts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'issued_vouchers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."issued_vouchers" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'activity_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."activity_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'app_users' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."app_users" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."audit_logs" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'booking_payments' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."booking_payments" x WHERE (EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'bookings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."bookings" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'branch_telemetry' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('terminal_id',x."terminal_id")::text cursor,x row_data FROM public."branch_telemetry" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('terminal_id',x."terminal_id")::text>p_after_cursor) ORDER BY jsonb_build_object('terminal_id',x."terminal_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'cashiers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."cashiers" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'coupon_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."coupon_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'drawer_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."drawer_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'held_orders' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."held_orders" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'integration_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."integration_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'item_activity_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."item_activity_logs" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'member_verifications' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."member_verifications" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'members' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."members" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'membership_tiers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."membership_tiers" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'offline_sync_audit_log' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."offline_sync_audit_log" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'payment_transactions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."payment_transactions" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'payment_types' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."payment_types" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pin_attempts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."pin_attempts" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pos_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."pos_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'product_barcodes' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."product_barcodes" x WHERE (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'product_categories' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."product_categories" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'products' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."products" x WHERE ((NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'promotions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."promotions" x WHERE (EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'public_flags' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."public_flags" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'purchase_order_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."purchase_order_items" x WHERE (EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'purchase_orders' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."purchase_orders" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sale_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sale_items" x WHERE (x.branch_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sales' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sales" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'secure_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('key',x."key")::text cursor,x row_data FROM public."secure_settings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'security_findings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."security_findings" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_locks' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('section',x."section")::text cursor,x row_data FROM public."settings_locks" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('section',x."section")::text>p_after_cursor) ORDER BY jsonb_build_object('section',x."section")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_overrides' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text cursor,x row_data FROM public."settings_overrides" x WHERE ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text>p_after_cursor) ORDER BY jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'section',x."section")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_sessions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_sessions" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sku_audit' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sku_audit" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'staff_roles' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('slug',x."slug")::text cursor,x row_data FROM public."staff_roles" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('slug',x."slug")::text>p_after_cursor) ORDER BY jsonb_build_object('slug',x."slug")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_adjustments' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_adjustments" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_delta_applied' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('movement_id',x."movement_id")::text cursor,x row_data FROM public."stock_delta_applied" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('movement_id',x."movement_id")::text>p_after_cursor) ORDER BY jsonb_build_object('movement_id',x."movement_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_transfer_items' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_transfer_items" x WHERE (EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text)))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_transfers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_transfers" x WHERE (p_branch_id IN (x.from_store_id::text,x.to_store_id::text))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stores' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stores" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'suppliers' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."suppliers" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'sync_metadata' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."sync_metadata" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'system_audit_logs' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."system_audit_logs" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_commands' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."terminal_commands" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_tokens' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."terminal_tokens" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'uom_units' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."uom_units" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'user_roles' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."user_roles" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'whatsapp_queue' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."whatsapp_queue" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'terminal_recovery_secrets' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('terminal_token_id',x."terminal_token_id")::text cursor,x row_data FROM public."terminal_recovery_secrets" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('terminal_token_id',x."terminal_token_id")::text>p_after_cursor) ORDER BY jsonb_build_object('terminal_token_id',x."terminal_token_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'pos_store_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('store_id',x."store_id")::text cursor,x row_data FROM public."pos_store_settings" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('store_id',x."store_id")::text>p_after_cursor) ORDER BY jsonb_build_object('store_id',x."store_id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'settings_scoped' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text cursor,x row_data FROM public."settings_scoped" x WHERE ((lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)))  AND (p_after_cursor IS NULL OR jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text>p_after_cursor) ORDER BY jsonb_build_object('scope',x."scope",'scope_id',x."scope_id",'key',x."key")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'stock_count_drafts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."stock_count_drafts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_actions' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_actions" x WHERE ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_action_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_action_history" x WHERE ((lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))))  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_requests' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_requests" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'authorization_log' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."authorization_log" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'record_edits' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."record_edits" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_cash_counts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_cash_counts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_close_events' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_close_events" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_reconciliations' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_reconciliations" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_variance_alerts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_variance_alerts" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'shift_notifications' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."shift_notifications" x WHERE (x.store_id::text=p_branch_id) AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'entity_status_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."entity_status_history" x WHERE (x.store_id::text=p_branch_id)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'nav_pins' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."nav_pins" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page;
    WHEN 'store_groups' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."store_groups" x WHERE (true)  AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT LEAST(GREATEST(p_limit,100),2000)) page; ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 RETURN jsonb_build_object('rows',v_rows,'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,100),2000) THEN v_cursor ELSE NULL END);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_counts(p_organization_id text,p_branch_id text,p_terminal_id text,p_history_days integer DEFAULT 90)
RETURNS TABLE(table_name text,row_count bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY SELECT 'coupon_campaigns'::text table_name,count(*)::bigint row_count FROM public."coupon_campaigns" x WHERE true UNION ALL SELECT 'shifts'::text table_name,count(*)::bigint row_count FROM public."shifts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'issued_vouchers'::text table_name,count(*)::bigint row_count FROM public."issued_vouchers" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'activity_events'::text table_name,count(*)::bigint row_count FROM public."activity_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'app_users'::text table_name,count(*)::bigint row_count FROM public."app_users" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'audit_logs'::text table_name,count(*)::bigint row_count FROM public."audit_logs" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'booking_payments'::text table_name,count(*)::bigint row_count FROM public."booking_payments" x WHERE EXISTS(SELECT 1 FROM public."bookings" p WHERE p."id"::text=x."booking_id"::text AND p.store_id::text=p_branch_id) UNION ALL SELECT 'bookings'::text table_name,count(*)::bigint row_count FROM public."bookings" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'branch_telemetry'::text table_name,count(*)::bigint row_count FROM public."branch_telemetry" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'cashiers'::text table_name,count(*)::bigint row_count FROM public."cashiers" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'coupon_events'::text table_name,count(*)::bigint row_count FROM public."coupon_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'drawer_events'::text table_name,count(*)::bigint row_count FROM public."drawer_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'held_orders'::text table_name,count(*)::bigint row_count FROM public."held_orders" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'integration_settings'::text table_name,count(*)::bigint row_count FROM public."integration_settings" x WHERE true UNION ALL SELECT 'item_activity_logs'::text table_name,count(*)::bigint row_count FROM public."item_activity_logs" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'member_verifications'::text table_name,count(*)::bigint row_count FROM public."member_verifications" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'members'::text table_name,count(*)::bigint row_count FROM public."members" x WHERE true UNION ALL SELECT 'membership_tiers'::text table_name,count(*)::bigint row_count FROM public."membership_tiers" x WHERE true UNION ALL SELECT 'offline_sync_audit_log'::text table_name,count(*)::bigint row_count FROM public."offline_sync_audit_log" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'payment_transactions'::text table_name,count(*)::bigint row_count FROM public."payment_transactions" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'payment_types'::text table_name,count(*)::bigint row_count FROM public."payment_types" x WHERE true UNION ALL SELECT 'pin_attempts'::text table_name,count(*)::bigint row_count FROM public."pin_attempts" x WHERE true UNION ALL SELECT 'pos_settings'::text table_name,count(*)::bigint row_count FROM public."pos_settings" x WHERE true UNION ALL SELECT 'product_barcodes'::text table_name,count(*)::bigint row_count FROM public."product_barcodes" x WHERE EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) UNION ALL SELECT 'product_categories'::text table_name,count(*)::bigint row_count FROM public."product_categories" x WHERE true UNION ALL SELECT 'products'::text table_name,count(*)::bigint row_count FROM public."products" x WHERE (NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id) UNION ALL SELECT 'promotions'::text table_name,count(*)::bigint row_count FROM public."promotions" x WHERE EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) UNION ALL SELECT 'public_flags'::text table_name,count(*)::bigint row_count FROM public."public_flags" x WHERE true UNION ALL SELECT 'purchase_order_items'::text table_name,count(*)::bigint row_count FROM public."purchase_order_items" x WHERE EXISTS(SELECT 1 FROM public."purchase_orders" p WHERE p."id"::text=x."po_id"::text AND p.store_id::text=p_branch_id) UNION ALL SELECT 'purchase_orders'::text table_name,count(*)::bigint row_count FROM public."purchase_orders" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'sale_items'::text table_name,count(*)::bigint row_count FROM public."sale_items" x WHERE x.branch_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'sales'::text table_name,count(*)::bigint row_count FROM public."sales" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'secure_settings'::text table_name,count(*)::bigint row_count FROM public."secure_settings" x WHERE true UNION ALL SELECT 'security_findings'::text table_name,count(*)::bigint row_count FROM public."security_findings" x WHERE true UNION ALL SELECT 'settings_locks'::text table_name,count(*)::bigint row_count FROM public."settings_locks" x WHERE true UNION ALL SELECT 'settings_overrides'::text table_name,count(*)::bigint row_count FROM public."settings_overrides" x WHERE (lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)) UNION ALL SELECT 'shift_sessions'::text table_name,count(*)::bigint row_count FROM public."shift_sessions" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'sku_audit'::text table_name,count(*)::bigint row_count FROM public."sku_audit" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'staff_roles'::text table_name,count(*)::bigint row_count FROM public."staff_roles" x WHERE true UNION ALL SELECT 'stock_adjustments'::text table_name,count(*)::bigint row_count FROM public."stock_adjustments" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'stock_delta_applied'::text table_name,count(*)::bigint row_count FROM public."stock_delta_applied" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'stock_transfer_items'::text table_name,count(*)::bigint row_count FROM public."stock_transfer_items" x WHERE EXISTS(SELECT 1 FROM public."stock_transfers" p WHERE p."id"::text=x."transfer_id"::text AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text)) UNION ALL SELECT 'stock_transfers'::text table_name,count(*)::bigint row_count FROM public."stock_transfers" x WHERE p_branch_id IN (x.from_store_id::text,x.to_store_id::text) UNION ALL SELECT 'stores'::text table_name,count(*)::bigint row_count FROM public."stores" x WHERE true UNION ALL SELECT 'suppliers'::text table_name,count(*)::bigint row_count FROM public."suppliers" x WHERE true UNION ALL SELECT 'sync_metadata'::text table_name,count(*)::bigint row_count FROM public."sync_metadata" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'system_audit_logs'::text table_name,count(*)::bigint row_count FROM public."system_audit_logs" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_commands'::text table_name,count(*)::bigint row_count FROM public."terminal_commands" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_tokens'::text table_name,count(*)::bigint row_count FROM public."terminal_tokens" x WHERE true UNION ALL SELECT 'uom_units'::text table_name,count(*)::bigint row_count FROM public."uom_units" x WHERE true UNION ALL SELECT 'user_roles'::text table_name,count(*)::bigint row_count FROM public."user_roles" x WHERE true UNION ALL SELECT 'whatsapp_queue'::text table_name,count(*)::bigint row_count FROM public."whatsapp_queue" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'terminal_recovery_secrets'::text table_name,count(*)::bigint row_count FROM public."terminal_recovery_secrets" x WHERE true UNION ALL SELECT 'pos_store_settings'::text table_name,count(*)::bigint row_count FROM public."pos_store_settings" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'settings_scoped'::text table_name,count(*)::bigint row_count FROM public."settings_scoped" x WHERE (lower(x.scope)='global' OR (lower(x.scope)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text)) OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id)) UNION ALL SELECT 'stock_count_drafts'::text table_name,count(*)::bigint row_count FROM public."stock_count_drafts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'authorization_actions'::text table_name,count(*)::bigint row_count FROM public."authorization_actions" x WHERE (lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))) UNION ALL SELECT 'authorization_action_history'::text table_name,count(*)::bigint row_count FROM public."authorization_action_history" x WHERE (lower(x.scope_type)='global' OR (lower(x.scope_type)='branch' AND x.scope_id::text=p_branch_id) OR (lower(x.scope_type)='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=p_branch_id AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=x.scope_id::text))) UNION ALL SELECT 'authorization_requests'::text table_name,count(*)::bigint row_count FROM public."authorization_requests" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'authorization_log'::text table_name,count(*)::bigint row_count FROM public."authorization_log" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'record_edits'::text table_name,count(*)::bigint row_count FROM public."record_edits" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_cash_counts'::text table_name,count(*)::bigint row_count FROM public."shift_cash_counts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_close_events'::text table_name,count(*)::bigint row_count FROM public."shift_close_events" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_reconciliations'::text table_name,count(*)::bigint row_count FROM public."shift_reconciliations" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_variance_alerts'::text table_name,count(*)::bigint row_count FROM public."shift_variance_alerts" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'shift_notifications'::text table_name,count(*)::bigint row_count FROM public."shift_notifications" x WHERE x.store_id::text=p_branch_id AND (p_history_days>=7300 OR x."created_at">=now()-make_interval(days=>GREATEST(p_history_days,30))) UNION ALL SELECT 'entity_status_history'::text table_name,count(*)::bigint row_count FROM public."entity_status_history" x WHERE x.store_id::text=p_branch_id UNION ALL SELECT 'nav_pins'::text table_name,count(*)::bigint row_count FROM public."nav_pins" x WHERE true UNION ALL SELECT 'store_groups'::text table_name,count(*)::bigint row_count FROM public."store_groups" x WHERE true;
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_old_receipt_lookup(p_lookup text,p_branch_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_sale public.sales%ROWTYPE;
BEGIN IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_process_refund')::boolean,false)) THEN RAISE EXCEPTION 'REFUND_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT * INTO v_sale FROM public.sales WHERE store_id=p_branch_id AND (id::text=p_lookup OR bill_number=p_lookup OR client_transaction_id::text=p_lookup) LIMIT 1;
 IF v_sale.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sale',to_jsonb(v_sale),'items',(SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.sale_items i WHERE i.sale_id=v_sale.id),'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.payment_transactions p WHERE p.sale_id=v_sale.id));
END $fn$;

REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_counts(text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_old_receipt_lookup(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_old_receipt_lookup(text,text) TO service_role;

-- SQLSERVER_SYNC_CONTRACT_END