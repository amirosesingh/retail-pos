-- Preserve the exact approver population used when a request was raised.
-- Decisions still re-check the current rule, so removing authority takes
-- effect immediately, while newly-added people cannot decide old requests
-- that were never routed to them.
ALTER TABLE public.authorization_requests
  ADD COLUMN IF NOT EXISTS approval_route jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.authorization_requests.approval_route IS
  'Immutable-at-creation snapshot of primary/escalation approvers and rule routing settings.';

-- Return the committed version in the save transaction itself. This removes
-- the fragile save-then-read round trip that left the editor degraded after
-- an otherwise successful save. Explicit POS-settings permission is accepted
-- for the caller's visible branch; global/cross-branch scope stays protected.
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
