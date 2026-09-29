-- Application-level optimistic concurrency conflicts are not PostgreSQL
-- serialization failures. SQLSTATE 40001 tells PostgREST/database clients to
-- retry the transaction, which turned one stale authorization save into a
-- tight retry loop ending in a gateway timeout. PT409 returns HTTP 409 once.

CREATE OR REPLACE FUNCTION public.pos_rules_save(
  _store_id text,
  _patch jsonb,
  _expected_version integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  sid text := COALESCE(btrim(_store_id), '');
  known jsonb := public.pos_rules_defaults();
  clean jsonb := '{}'::jsonb;
  k text;
  current_version integer;
  sets text;
BEGIN
  IF NOT (public.is_supervisor_now() OR public.has_perm('can_access_pos_settings')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: POS settings permission required' USING ERRCODE = '42501';
  END IF;
  IF sid <> '' AND NOT public.store_visible(sid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: branch is not visible to this account' USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(COALESCE(_patch, '{}'::jsonb)) LOOP
    IF known ? k AND jsonb_typeof(_patch -> k) IN ('boolean', 'number') THEN
      clean := clean || jsonb_build_object(k, _patch -> k);
    END IF;
  END LOOP;

  IF clean = '{}'::jsonb THEN
    RAISE EXCEPTION 'NO_VALID_RULES: nothing recognised in the change' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pos_store_settings(store_id) VALUES (sid)
    ON CONFLICT (store_id) DO NOTHING;

  SELECT row_version INTO current_version
    FROM public.pos_store_settings WHERE store_id = sid FOR UPDATE;

  IF _expected_version IS NOT NULL AND _expected_version <> current_version THEN
    RAISE EXCEPTION 'STALE_RULES: these rules were changed elsewhere (version %, expected %)',
      current_version, _expected_version USING ERRCODE = 'PT409';
  END IF;

  SELECT string_agg(format('%I = ($1 ->> %L)::%s', key, key,
           CASE WHEN jsonb_typeof(known -> key) = 'boolean' THEN 'boolean' ELSE 'numeric' END), ', ')
    INTO sets
    FROM jsonb_object_keys(clean) AS key;

  EXECUTE format(
    'UPDATE public.pos_store_settings SET %s, row_version = row_version + 1,
        updated_by = $2, updated_at = now() WHERE store_id = $3', sets)
    USING clean, COALESCE(auth.uid()::text, 'service'), sid;

  RETURN public.pos_rules_snapshot(sid);
END $$;

REVOKE ALL ON FUNCTION public.pos_rules_save(text,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_rules_save(text,jsonb,integer) TO authenticated, service_role;

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
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
  ELSIF NOT FOUND AND COALESCE(p_expected_version,0) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This authorization rule changed on another device. Reload it before saving.';
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

NOTIFY pgrst, 'reload schema';
