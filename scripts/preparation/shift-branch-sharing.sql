-- SHIFT63 PREPARATION ONLY. Separate exact-project approval before application.
-- NULL preserves global inheritance. Existing data/rule values are unchanged.
BEGIN;
SET LOCAL search_path=pg_catalog;
ALTER TABLE public.pos_store_settings ADD COLUMN IF NOT EXISTS allow_branch_shift_sharing boolean;
DO $column$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.pos_store_settings'::regclass AND a.attname='allow_branch_shift_sharing' AND a.atttypid='boolean'::regtype AND NOT a.attnotnull AND NOT a.attisdropped AND a.attgenerated='' AND a.attidentity='' AND NOT EXISTS(SELECT 1 FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)) THEN RAISE EXCEPTION 'SHIFT_SHARING_COLUMN_UNEXPECTED'; END IF;
END $column$;
DO $upgrade$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.pos_rules_defaults()'::regprocedure) INTO definition;
 IF NOT (public.pos_rules_defaults() ? 'allow_branch_shift_sharing') THEN
  IF position('"allow_multiple_shifts_per_terminal": false,' IN definition)=0 THEN RAISE EXCEPTION 'SHIFT_SHARING_DEFAULT_SOURCE_UNEXPECTED'; END IF;
  EXECUTE replace(definition,'"allow_multiple_shifts_per_terminal": false,','"allow_multiple_shifts_per_terminal": false, "allow_branch_shift_sharing": true,');
 ELSIF public.pos_rules_defaults()->'allow_branch_shift_sharing' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'SHIFT_SHARING_DEFAULT_SOURCE_UNEXPECTED';
 END IF;
END $upgrade$;
DO $sync$
DECLARE definition text; prefix text; suffix text; conflict_at integer; old_columns text:='"allow_multiple_shifts_per_terminal","enable_cashier_x_report"'; new_columns text:='"allow_multiple_shifts_per_terminal","allow_branch_shift_sharing","enable_cashier_x_report"';
 old_update text:='"allow_multiple_shifts_per_terminal"=EXCLUDED."allow_multiple_shifts_per_terminal",'; new_update text:='"allow_multiple_shifts_per_terminal"=EXCLUDED."allow_multiple_shifts_per_terminal","allow_branch_shift_sharing"=EXCLUDED."allow_branch_shift_sharing",'; marker text:='-- SHIFT63_PRESERVE_ABSENT_RULE'; at integer;
 preserve text:=$preserve$
  -- SHIFT63_PRESERVE_MISSING_BEGIN
  -- SHIFT63_PRESERVE_ABSENT_RULE
  PERFORM 1 FROM public.pos_store_settings s WHERE s.store_id IN(SELECT r->>'store_id' FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r) ORDER BY s.store_id FOR UPDATE;
  SELECT coalesce(jsonb_agg(CASE WHEN r ? 'allow_branch_shift_sharing' THEN r ELSE r||jsonb_build_object('allow_branch_shift_sharing',(SELECT to_jsonb(s.allow_branch_shift_sharing) FROM public.pos_store_settings s WHERE s.store_id=r->>'store_id')) END),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
  -- SHIFT63_PRESERVE_MISSING_END
$preserve$;
BEGIN
 SELECT pg_get_functiondef('public.sync_apply_pos_store_settings(jsonb)'::regprocedure) INTO definition;
 conflict_at:=position('ON CONFLICT' IN definition);
 IF conflict_at=0 THEN RAISE EXCEPTION 'SHIFT_SHARING_SYNC_SOURCE_UNEXPECTED'; END IF;
 prefix:=left(definition,conflict_at-1); suffix:=substring(definition FROM conflict_at);
 IF position('"allow_branch_shift_sharing"' IN definition)=0 THEN
  IF (length(prefix)-length(replace(prefix,old_columns,'')))/length(old_columns)<>2 OR (length(suffix)-length(replace(suffix,old_update,'')))/length(old_update)<>1 THEN RAISE EXCEPTION 'SHIFT_SHARING_SYNC_SOURCE_UNEXPECTED'; END IF;
  prefix:=replace(prefix,old_columns,new_columns); suffix:=replace(suffix,old_update,new_update);
 END IF;
 IF (length(prefix)-length(replace(prefix,new_columns,'')))/length(new_columns)<>2 OR (length(suffix)-length(replace(suffix,new_update,'')))/length(new_update)<>1 THEN RAISE EXCEPTION 'SHIFT_SHARING_SYNC_SOURCE_UNEXPECTED'; END IF;
 definition:=prefix||suffix;
 IF position(marker IN definition)=0 THEN
  at:=position(E'BEGIN\n' IN definition);
  IF at=0 THEN at:=position(E'BEGIN\r\n' IN definition); END IF;
  IF at=0 THEN RAISE EXCEPTION 'SHIFT_SHARING_SYNC_SOURCE_UNEXPECTED'; END IF;
  definition:=left(definition,at+length('BEGIN')-1)||preserve||substring(definition FROM at+length('BEGIN'));
 END IF;
 IF position(preserve IN definition)=0 THEN RAISE EXCEPTION 'SHIFT_SHARING_SYNC_SOURCE_UNEXPECTED'; END IF;
 EXECUTE definition;
END $sync$;
CREATE SCHEMA shift_sharing_private;
REVOKE ALL ON SCHEMA shift_sharing_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE shift_sharing_private.contracts(
 identity text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('function','trigger')),definition_hash text NOT NULL,
 function_owner oid,security_definer boolean,settings text[],grants aclitem[],trigger_relation oid,trigger_name text
);
ALTER TABLE shift_sharing_private.contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shift_sharing_private.contracts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION shift_sharing_private.immutable_contracts() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'SHIFT_SHARING_CONTRACT_IMMUTABLE'; END$$;
REVOKE ALL ON FUNCTION shift_sharing_private.immutable_contracts() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON shift_sharing_private.contracts FOR EACH ROW EXECUTE FUNCTION shift_sharing_private.immutable_contracts();

CREATE FUNCTION shift_sharing_private.authorize(p_branch text,p_terminal text,p_actor text,p_action text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE person public.app_users%ROWTYPE; device public.terminal_tokens%ROWTYPE; admin boolean; supervisor boolean; flag text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SHIFT_SHARING_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO person FROM public.app_users WHERE user_id=p_actor AND is_active IS TRUE FOR SHARE;
 IF NOT FOUND OR nullif(p_branch,'') IS NULL OR p_action NOT IN('can_process_sale','can_open_shift') THEN RAISE EXCEPTION 'SHIFT_SHARING_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
 admin:=coalesce(person.role::text='admin' OR person.role_slug='admin',false);
 supervisor:=admin OR coalesce(person.role::text='manager' OR person.role_slug='supervisor',false);
 IF NOT admin AND person.permissions->p_action IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'SHIFT_SHARING_ACTION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_terminal IS NULL THEN
  IF NOT supervisor AND person.store_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'SHIFT_SHARING_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
  RETURN 'management'; -- verified browser relay, not a native Operations device
 END IF;
 SELECT * INTO device FROM public.terminal_tokens WHERE id::text=p_terminal AND status IN('active','used') AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND OR (nullif(person.store_id,'') IS NOT NULL AND lower(person.store_id)<>lower(p_branch)) THEN RAISE EXCEPTION 'SHIFT_SHARING_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
 IF device.location_id IS NOT NULL THEN
  IF device.location_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'SHIFT_SHARING_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
  RETURN 'live';
 END IF;
 flag:=CASE WHEN device.platform='mobile' THEN 'can_use_management_mobile' ELSE 'can_use_management_pc' END;
 IF NOT admin AND (CASE WHEN person.permissions ? flag THEN person.permissions->flag IS DISTINCT FROM 'true'::jsonb ELSE NOT supervisor END) THEN
  RAISE EXCEPTION 'SHIFT_SHARING_MANAGEMENT_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN 'management';
END $$;
REVOKE ALL ON FUNCTION shift_sharing_private.authorize(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION shift_sharing_private.check_checkout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sharing boolean; context jsonb; owner text;
BEGIN
 sharing:=coalesce((public.pos_rules_get(NEW.store_id)->>'allow_branch_shift_sharing')::boolean,true);
 IF sharing THEN RETURN NEW; END IF;
 -- A valid native scope proves the device, not when its work was created.
 -- Never accept a new cross-till sale merely because it used the sync RPC.
 IF auth.role()='service_role' AND nullif(current_setting('pos.sync_branch',true),'')=NEW.store_id AND nullif(current_setting('pos.sync_terminal',true),'') IS NOT NULL THEN
  PERFORM public.pos_sync_validate_scope('default',NEW.store_id,current_setting('pos.sync_terminal',true));
  context:=jsonb_build_object('branch',NEW.store_id,'terminal',current_setting('pos.sync_terminal',true),'mode','live');
 ELSE
  context:=nullif(current_setting('pos.shift_checkout_context',true),'')::jsonb;
 END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SHIFT_CHECKOUT_VERIFIED_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF context IS NULL OR context->>'branch' IS DISTINCT FROM NEW.store_id THEN RAISE EXCEPTION 'SHIFT_CHECKOUT_VERIFIED_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF context->>'mode'='management' OR (context->>'mode'='historical_admin' AND TG_TABLE_NAME='sales') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='shifts' THEN
  IF context->>'mode' IS DISTINCT FROM 'live' OR NEW.terminal_id IS NULL OR lower(NEW.terminal_id) IS DISTINCT FROM lower(context->>'terminal') THEN RAISE EXCEPTION 'SHIFT_CHECKOUT_OWN_SHIFT_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF context->>'mode' IS DISTINCT FROM 'live' OR NEW.shift_id IS NULL OR nullif(context->>'terminal','') IS NULL THEN RAISE EXCEPTION 'SHIFT_CHECKOUT_OWN_SHIFT_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT terminal_id INTO owner FROM public.shifts WHERE id::text=NEW.shift_id::text AND store_id=NEW.store_id FOR SHARE;
 IF owner IS NULL OR lower(owner)<>lower(context->>'terminal') THEN RAISE EXCEPTION 'SHIFT_CHECKOUT_OWN_SHIFT_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION shift_sharing_private.check_checkout() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER shift_branch_checkout_guard BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION shift_sharing_private.check_checkout();
CREATE TRIGGER shift_branch_open_guard BEFORE INSERT ON public.shifts FOR EACH ROW EXECUTE FUNCTION shift_sharing_private.check_checkout();

CREATE FUNCTION public.pos_checkout_sale_for_terminal(p_terminal text,p_actor text,_sale jsonb,_items jsonb,_payments jsonb,_movements jsonb,_member jsonb,_exchange_bill text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE branch text:=_sale->>'store_id'; mode text; previous text:=current_setting('pos.shift_checkout_context',true); result jsonb; actor uuid; readiness jsonb;
BEGIN
 mode:=shift_sharing_private.authorize(branch,p_terminal,p_actor,'can_process_sale');
 PERFORM set_config('pos.shift_checkout_context',jsonb_build_object('branch',branch,'terminal',p_terminal,'mode',mode)::text,true);
 IF to_regprocedure('public.pos_live_financial_sale(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL THEN
  EXECUTE 'SELECT public.pos_live_financial_ready()' INTO readiness;
  IF readiness->'ready' IS DISTINCT FROM 'true'::jsonb OR readiness->>'version'<>'2' THEN RAISE EXCEPTION 'FINANCIAL_VALIDATION_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  SELECT id INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active IS TRUE;
  EXECUTE 'SELECT public.pos_live_financial_sale($1,$2,$3,$4,$5,$6,$7,$8,$9)' INTO result USING actor,branch,p_terminal,_sale,_items,_payments,_movements,_member,_exchange_bill;
 ELSE
  result:=public.pos_sale_commit(_sale,_items,_payments,_movements,_member,_exchange_bill);
 END IF;
 PERFORM set_config('pos.shift_checkout_context',coalesce(previous,''),true); RETURN result;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('pos.shift_checkout_context',coalesce(previous,''),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION public.pos_checkout_sale_for_terminal(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_checkout_sale_for_terminal(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) TO service_role;

CREATE FUNCTION public.pos_shift_active_for_terminal(p_branch text,p_terminal text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE device public.terminal_tokens%ROWTYPE; own_only boolean:=false; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SHIFT_SHARING_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_terminal IS NOT NULL THEN
  SELECT * INTO device FROM public.terminal_tokens WHERE id::text=p_terminal AND status IN('active','used') AND revoked_at IS NULL;
  IF NOT FOUND OR (device.location_id IS NOT NULL AND device.location_id IS DISTINCT FROM p_branch) THEN RAISE EXCEPTION 'SHIFT_SHARING_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
  own_only:=device.location_id IS NOT NULL AND NOT coalesce((public.pos_rules_get(p_branch)->>'allow_branch_shift_sharing')::boolean,true);
 END IF;
 SELECT to_jsonb(s) INTO result FROM public.shifts s WHERE store_id=p_branch AND status='OPEN' AND closed_at IS NULL AND (NOT own_only OR terminal_id=p_terminal) ORDER BY opened_at DESC,id LIMIT 1;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pos_shift_active_for_terminal(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_shift_active_for_terminal(text,text) TO service_role;

CREATE FUNCTION public.pos_open_shift_for_terminal(p_terminal text,p_actor text,p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE branch text:=p_row->>'store_id'; mode text; sharing boolean; result public.shifts; actor public.app_users%ROWTYPE; previous text:=current_setting('pos.shift_checkout_context',true);
BEGIN
 mode:=shift_sharing_private.authorize(branch,p_terminal,p_actor,'can_open_shift');
 IF nullif(p_row->>'id','') IS NULL OR coalesce(p_row->>'status','OPEN')<>'OPEN' OR p_row->>'closed_at' IS NOT NULL OR coalesce(p_row->>'state','ACTIVE')<>'ACTIVE' THEN RAISE EXCEPTION 'SHIFT_OPEN_INVALID' USING ERRCODE='22023'; END IF;
 IF (p_row->>'opening_float') IS NULL OR (p_row->>'opening_float')::numeric<0 OR (p_row->>'opening_float') IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'SHIFT_OPEN_INVALID' USING ERRCODE='22023'; END IF;
 sharing:=mode='management' OR coalesce((public.pos_rules_get(branch)->>'allow_branch_shift_sharing')::boolean,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('shift_open:'||branch,0));
 IF sharing THEN
  -- Preserve the generic relay's existing create/retry behavior when this new
  -- rule is ON. The separate multiple-shifts rule is not reinterpreted here.
  SELECT * INTO result FROM public.shifts WHERE id::text=p_row->>'id' AND store_id=branch;
 ELSE
  SELECT * INTO result FROM public.shifts WHERE store_id=branch AND status='OPEN' AND closed_at IS NULL AND terminal_id=p_terminal ORDER BY opened_at DESC LIMIT 1;
 END IF;
 IF FOUND THEN
  IF result.id::text=p_row->>'id' THEN
   IF result.status<>'OPEN' OR result.closed_at IS NOT NULL OR result.opening_float IS DISTINCT FROM (p_row->>'opening_float')::numeric OR (nullif(p_row->>'opened_at','') IS NOT NULL AND result.opened_at IS DISTINCT FROM (p_row->>'opened_at')::timestamptz) THEN RAISE EXCEPTION 'SHIFT_OPEN_REPLAY_CONFLICT' USING ERRCODE='PT409'; END IF;
   RETURN to_jsonb(result);
  END IF;
  RAISE EXCEPTION 'SHIFT_ALREADY_OPEN' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active IS TRUE;
 PERFORM set_config('pos.shift_checkout_context',jsonb_build_object('branch',branch,'terminal',p_terminal,'mode',mode)::text,true);
 INSERT INTO public.shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,opening_float,status,user_id,opened_at)
 VALUES((p_row->>'id')::uuid,branch,p_terminal,p_row->>'terminal_name',coalesce(nullif(actor.full_name,''),actor.user_id),actor.user_id,actor.role,(p_row->>'opening_float')::numeric,'OPEN',actor.auth_user_id,coalesce(nullif(p_row->>'opened_at','')::timestamptz,now())) RETURNING * INTO result;
 PERFORM set_config('pos.shift_checkout_context',coalesce(previous,''),true); RETURN to_jsonb(result);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('pos.shift_checkout_context',coalesce(previous,''),true); RAISE;
END $$;
REVOKE ALL ON FUNCTION public.pos_open_shift_for_terminal(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_open_shift_for_terminal(text,text,jsonb) TO service_role;

CREATE FUNCTION shift_sharing_private.can_disable(p_branch text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE branch text; terminal text; approved boolean; approvals oid:=to_regclass('fin62_rollout_preparation.approvals');
BEGIN
 IF to_regprocedure('fin62_rollout_preparation.cohort_approved(text,text,text)') IS NULL OR approvals IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=approvals AND relowner='postgres'::regrole AND relrowsecurity)
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name WHERE has_table_privilege(role_name,approvals,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=approvals AND tgname='immutable' AND tgenabled='O' AND tgfoid=to_regprocedure('fin62_history_preparation.immutable()')) THEN RETURN false; END IF;
 IF coalesce(p_branch,'')='' THEN
  FOR branch IN SELECT DISTINCT t.location_id FROM public.terminal_tokens t WHERE t.location_id IS NOT NULL AND t.platform='pc' AND t.status IN('active','used') AND t.revoked_at IS NULL AND (coalesce((to_jsonb(t)->>'is_claimed')::boolean,false) OR nullif(to_jsonb(t)->>'claimed_at','') IS NOT NULL) AND public.pos_rules_row(t.location_id)->'allow_branch_shift_sharing' IS DISTINCT FROM 'true'::jsonb LOOP
   IF NOT shift_sharing_private.can_disable(branch) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 END IF;
 SELECT t.id::text INTO terminal FROM public.terminal_tokens t WHERE t.location_id=p_branch AND t.platform='pc' AND t.status IN('active','used') AND t.revoked_at IS NULL AND (coalesce((to_jsonb(t)->>'is_claimed')::boolean,false) OR nullif(to_jsonb(t)->>'claimed_at','') IS NOT NULL) ORDER BY t.id LIMIT 1;
 IF NOT FOUND THEN RETURN true; END IF; -- online-only/mobile branches have no inferred PC/offline capability
 EXECUTE 'SELECT fin62_rollout_preparation.cohort_approved($1,$2,$3)' INTO approved USING 'default',p_branch,terminal;
 RETURN coalesce(approved,false);
END $$;
REVOKE ALL ON FUNCTION shift_sharing_private.can_disable(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_shift_sharing_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM shift_sharing_private.contracts)=24
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.pos_store_settings'::regclass AND a.attname='allow_branch_shift_sharing' AND a.atttypid='boolean'::regtype AND NOT a.attnotnull AND NOT a.attisdropped AND a.attgenerated='' AND a.attidentity='' AND NOT EXISTS(SELECT 1 FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum))
 AND EXISTS(SELECT 1 FROM pg_class WHERE oid='shift_sharing_private.contracts'::regclass AND relrowsecurity AND relowner='postgres'::regrole)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name WHERE has_table_privilege(role_name,'shift_sharing_private.contracts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_schema_privilege(role_name,'shift_sharing_private','CREATE'))
 AND NOT EXISTS(SELECT 1 FROM shift_sharing_private.contracts c LEFT JOIN pg_proc p ON p.oid=CASE WHEN c.kind='function' THEN to_regprocedure(c.identity) END
  WHERE c.kind='function' AND (p.oid IS NULL OR p.proowner IS DISTINCT FROM c.function_owner OR p.proowner<>'postgres'::regrole OR p.prosecdef IS DISTINCT FROM c.security_definer OR p.proconfig IS DISTINCT FROM c.settings OR p.proacl IS DISTINCT FROM c.grants OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM c.definition_hash))
 AND NOT EXISTS(SELECT 1 FROM shift_sharing_private.contracts c LEFT JOIN pg_trigger t ON t.tgrelid=c.trigger_relation AND t.tgname=c.trigger_name
  WHERE c.kind='trigger' AND (t.oid IS NULL OR t.tgenabled<>'O' OR md5(pg_get_triggerdef(t.oid)) IS DISTINCT FROM c.definition_hash))
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text)') AND position('pos.shift_checkout_context' IN prosrc)>0);
$$;
REVOKE ALL ON FUNCTION public.pos_shift_sharing_ready() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_shift_sharing_ready() TO authenticated,service_role;
CREATE FUNCTION shift_sharing_private.check_setting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.allow_branch_shift_sharing IS FALSE AND (TG_OP='INSERT' OR NEW.allow_branch_shift_sharing IS DISTINCT FROM OLD.allow_branch_shift_sharing) AND (NOT public.pos_shift_sharing_ready() OR NOT shift_sharing_private.can_disable(NEW.store_id)) THEN
  RAISE EXCEPTION 'SHIFT_SHARING_UPGRADE_REQUIRED' USING ERRCODE='PT409';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION shift_sharing_private.check_setting() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER shift_branch_setting_guard BEFORE INSERT OR UPDATE ON public.pos_store_settings FOR EACH ROW EXECUTE FUNCTION shift_sharing_private.check_setting();
DO $snapshot$
DECLARE definition text; needle text:='''rules'', public.pos_rules_get(r.store_id),';
BEGIN
 SELECT pg_get_functiondef('public.pos_rules_snapshot(text)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'SHIFT_SHARING_SNAPSHOT_SOURCE_UNEXPECTED'; END IF;
 EXECUTE replace(definition,needle,needle||' ''branch_shift_sharing_available'', (CASE WHEN public.pos_shift_sharing_ready() THEN shift_sharing_private.can_disable(r.store_id) ELSE false END),');
END $snapshot$;
DO $contracts$
DECLARE identity text; fn_oid oid; entry record;
BEGIN
 FOREACH identity IN ARRAY ARRAY[
 'shift_sharing_private.immutable_contracts()','shift_sharing_private.authorize(text,text,text,text)','shift_sharing_private.check_checkout()','shift_sharing_private.check_setting()','shift_sharing_private.can_disable(text)',
 'public.pos_checkout_sale_for_terminal(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)','public.pos_open_shift_for_terminal(text,text,jsonb)','public.pos_shift_active_for_terminal(text,text)','public.pos_shift_sharing_ready()',
 'public.pos_rules_defaults()','public.pos_rules_row(text)','public.pos_rules_get(text)','public.pos_rules_snapshot(text)','public.pos_rules_save(text,jsonb,integer)','public.sync_apply_pos_store_settings(jsonb)',
 'public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)','public.pos_sync_validate_scope(text,text,text)','public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text)','fin62_rollout_preparation.cohort_approved(text,text,text)','fin62_history_preparation.immutable()'] LOOP
  fn_oid:=to_regprocedure(identity);
  IF fn_oid IS NULL THEN
   IF identity IN('public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text)','fin62_rollout_preparation.cohort_approved(text,text,text)','fin62_history_preparation.immutable()') THEN CONTINUE; END IF;
   RAISE EXCEPTION 'SHIFT_SHARING_CONTRACT_MISSING: %',identity;
  END IF;
  IF (SELECT proowner FROM pg_proc WHERE pg_proc.oid=fn_oid)<>'postgres'::regrole THEN RAISE EXCEPTION 'SHIFT_SHARING_CONTRACT_OWNER: %',identity; END IF;
  INSERT INTO shift_sharing_private.contracts(identity,kind,definition_hash,function_owner,security_definer,settings,grants)
   SELECT identity,'function',md5(pg_get_functiondef(p.oid)),p.proowner,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid=fn_oid;
 END LOOP;
 FOR entry IN SELECT t.* FROM pg_trigger t WHERE (t.tgrelid='public.sales'::regclass AND t.tgname='shift_branch_checkout_guard') OR (t.tgrelid='public.shifts'::regclass AND t.tgname='shift_branch_open_guard') OR (t.tgrelid='public.pos_store_settings'::regclass AND t.tgname='shift_branch_setting_guard') OR (t.tgrelid='shift_sharing_private.contracts'::regclass AND t.tgname='immutable') LOOP
  INSERT INTO shift_sharing_private.contracts(identity,kind,definition_hash,trigger_relation,trigger_name) VALUES('trigger:'||entry.oid,'trigger',md5(pg_get_triggerdef(entry.oid)),entry.tgrelid,entry.tgname);
 END LOOP;
END $contracts$;
COMMIT;
