ALTER TABLE public.authorization_actions
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by text;

CREATE TABLE IF NOT EXISTS public.authorization_action_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_id uuid NOT NULL,
  action_key text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL DEFAULT '',
  row_version integer NOT NULL,
  changed_by text NOT NULL,
  change_source text NOT NULL,
  change_kind text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authorization_action_history_action_idx
  ON public.authorization_action_history(action_id, row_version DESC);
REVOKE ALL ON public.authorization_action_history FROM anon, authenticated;
GRANT SELECT ON public.authorization_action_history TO authenticated;
GRANT ALL ON public.authorization_action_history TO service_role;
ALTER TABLE public.authorization_action_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read authorisation rule history" ON public.authorization_action_history;
CREATE POLICY "Staff read authorisation rule history"
  ON public.authorization_action_history FOR SELECT TO authenticated
  USING (scope_id = '' OR public.store_visible(scope_id));

CREATE OR REPLACE FUNCTION public.authorization_action_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RAISE EXCEPTION 'authorization_action_history is insert-only';
END $$;
DROP TRIGGER IF EXISTS authorization_action_history_no_change ON public.authorization_action_history;
CREATE TRIGGER authorization_action_history_no_change
  BEFORE UPDATE OR DELETE ON public.authorization_action_history
  FOR EACH ROW EXECUTE FUNCTION public.authorization_action_history_immutable();

CREATE OR REPLACE FUNCTION public.authorization_rule_save(
  p_rule jsonb,
  p_expected_version integer,
  p_changed_by text,
  p_change_source text DEFAULT 'web'
) RETURNS SETOF public.authorization_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  current_row public.authorization_actions%rowtype;
  saved_row public.authorization_actions%rowtype;
  next_version integer;
BEGIN
  SELECT * INTO current_row FROM public.authorization_actions
  WHERE action_key=p_rule->>'action_key' AND scope_type=p_rule->>'scope_type'
    AND scope_id=COALESCE(p_rule->>'scope_id','') FOR UPDATE;
  IF FOUND AND current_row.row_version <> COALESCE(p_expected_version,0) THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
  ELSIF NOT FOUND AND COALESCE(p_expected_version,0) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
  END IF;
  next_version := COALESCE(current_row.row_version,0)+1;
  INSERT INTO public.authorization_actions AS target
    (action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,updated_at)
  VALUES
    (p_rule->>'action_key',p_rule->>'scope_type',COALESCE(p_rule->>'scope_id',''),p_rule->>'mode',
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'allowed_roles','[]'::jsonb))),ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'allowed_user_ids','[]'::jsonb))),
     ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'requester_roles','[]'::jsonb))),ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'requester_user_ids','[]'::jsonb))),
     COALESCE(p_rule->'authority_limits','{}'::jsonb),COALESCE(p_rule->'extra_authority','{}'::jsonb),COALESCE(p_rule->'absolute_ceilings','{}'::jsonb),
     COALESCE((p_rule->>'approval_timeout_minutes')::integer,15),(p_rule->>'escalation_after_minutes')::integer,ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_rule->'escalation_roles','[]'::jsonb))),
     COALESCE((p_rule->>'require_reason')::boolean,false),(p_rule->>'threshold')::numeric,COALESCE((p_rule->>'is_enabled')::boolean,true),next_version,p_changed_by,now())
  ON CONFLICT (action_key,scope_type,scope_id) DO UPDATE SET
    mode=EXCLUDED.mode,allowed_roles=EXCLUDED.allowed_roles,allowed_user_ids=EXCLUDED.allowed_user_ids,requester_roles=EXCLUDED.requester_roles,requester_user_ids=EXCLUDED.requester_user_ids,
    authority_limits=EXCLUDED.authority_limits,extra_authority=EXCLUDED.extra_authority,absolute_ceilings=EXCLUDED.absolute_ceilings,approval_timeout_minutes=EXCLUDED.approval_timeout_minutes,
    escalation_after_minutes=EXCLUDED.escalation_after_minutes,escalation_roles=EXCLUDED.escalation_roles,require_reason=EXCLUDED.require_reason,threshold=EXCLUDED.threshold,
    is_enabled=EXCLUDED.is_enabled,row_version=EXCLUDED.row_version,updated_by=EXCLUDED.updated_by,updated_at=now()
  RETURNING * INTO saved_row;
  INSERT INTO public.authorization_action_history(action_id,action_key,scope_type,scope_id,row_version,changed_by,change_source,change_kind,snapshot)
  VALUES(saved_row.id,saved_row.action_key,saved_row.scope_type,saved_row.scope_id,saved_row.row_version,p_changed_by,p_change_source,
    CASE WHEN current_row.id IS NULL THEN 'created' ELSE 'updated' END,to_jsonb(saved_row));
  RETURN NEXT saved_row;
END $$;
REVOKE ALL ON FUNCTION public.authorization_rule_save(jsonb,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_rule_save(jsonb,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_actions(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.authorization_actions
    (id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,created_at,updated_at)
  SELECT id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,created_at,updated_at
  FROM jsonb_populate_recordset(NULL::public.authorization_actions,COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    action_key=EXCLUDED.action_key,scope_type=EXCLUDED.scope_type,scope_id=EXCLUDED.scope_id,mode=EXCLUDED.mode,
    allowed_roles=EXCLUDED.allowed_roles,allowed_user_ids=EXCLUDED.allowed_user_ids,requester_roles=EXCLUDED.requester_roles,requester_user_ids=EXCLUDED.requester_user_ids,
    authority_limits=EXCLUDED.authority_limits,extra_authority=EXCLUDED.extra_authority,absolute_ceilings=EXCLUDED.absolute_ceilings,
    approval_timeout_minutes=EXCLUDED.approval_timeout_minutes,escalation_after_minutes=EXCLUDED.escalation_after_minutes,escalation_roles=EXCLUDED.escalation_roles,
    require_reason=EXCLUDED.require_reason,threshold=EXCLUDED.threshold,is_enabled=EXCLUDED.is_enabled,row_version=EXCLUDED.row_version,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
  WHERE (EXCLUDED.row_version,EXCLUDED.updated_at,COALESCE(EXCLUDED.updated_by,''))>
    (authorization_actions.row_version,authorization_actions.updated_at,COALESCE(authorization_actions.updated_by,''));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.sync_apply_authorization_action_history(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.authorization_action_history
  SELECT * FROM jsonb_populate_recordset(NULL::public.authorization_action_history,COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_action_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone)
  VALUES('default','global','authorization_action_history',jsonb_build_object('id',COALESCE(NEW.id,OLD.id))::text,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sync_feed_change ON public.authorization_action_history;
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public.authorization_action_history
  FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_action_history();

CREATE OR REPLACE FUNCTION public.sync_feed_authorization_actions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone)
  VALUES('default','global','authorization_actions',jsonb_build_object('id',COALESCE(NEW.id,OLD.id))::text,lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sync_feed_change ON public.authorization_actions;
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public.authorization_actions
  FOR EACH ROW EXECUTE FUNCTION public.sync_feed_authorization_actions();

CREATE OR REPLACE FUNCTION public.pos_sync_push_governance_batch(
  p_batch_id uuid,p_organization_id text,p_branch_id text,p_table text,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer:=0;
BEGIN
  IF p_table NOT IN ('authorization_actions','authorization_action_history') THEN RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END IF;
  IF p_table='authorization_actions' THEN v_count:=public.sync_apply_authorization_actions(p_rows);
  ELSE v_count:=public.sync_apply_authorization_action_history(p_rows); END IF;
  RETURN jsonb_build_object('ok',true,'applied',v_count,'batch_id',p_batch_id);
END $$;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_actions(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_action_history(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_feed_authorization_action_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_feed_authorization_actions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_push_governance_batch(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_governance_batch(uuid,text,text,text,jsonb) TO service_role;
