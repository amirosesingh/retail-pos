-- Preparation only: persist the seven summaries this existing routine already
-- calculates. No historical rows are repaired by applying this routine change.
-- Preserve the existing caller/permission model, arithmetic, facts and dates.
DO $shift_reconcile_summaries$
DECLARE
  routine oid := pg_catalog.to_regprocedure('public.shift_reconcile_now(uuid,uuid,numeric,numeric,numeric)');
  before_row pg_catalog.pg_proc%ROWTYPE;
  after_row pg_catalog.pg_proc%ROWTYPE;
  original_body text;
  normalized_body text;
  corrected_body text;
  definition text;
  needle text := '         variance_status = v_status, updated_at = now()';
  assignments text := E'         expected_cash = e.expected_cash,\n         expected_card = e.expected_card,\n         expected_digital = e.expected_digital,\n         variance_cash = v_var_cash,\n         variance_card = v_var_card,\n         variance_digital = v_var_digital,\n         variance_total = v_total,\n';
BEGIN
  IF routine IS NULL THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_ROUTINE_MISSING'; END IF;
  SELECT * INTO STRICT before_row FROM pg_catalog.pg_proc WHERE oid=routine;
  IF before_row.proowner IS DISTINCT FROM 'postgres'::pg_catalog.regrole
     OR before_row.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
     OR NOT before_row.prosecdef OR before_row.proisstrict
     OR before_row.provolatile <> 'v' OR before_row.prokind <> 'f'
     OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR pg_catalog.pg_get_function_result(routine) <> 'TABLE(state text, variance_status text)'
  THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_ATTRIBUTES_UNEXPECTED'; END IF;
  original_body := before_row.prosrc;
  normalized_body := pg_catalog.replace(original_body,E'\r\n',E'\n');
  -- A fresh canonical install already contains these assignments. An earlier
  -- successful upgrade is likewise a no-op; neither path rewrites grants.
  IF pg_catalog.md5(normalized_body) IN ('de87d75592ce3fe5872de90b4be9a466','c8d204768ba0a711946401920411f80a') THEN RETURN; END IF;
  IF pg_catalog.md5(normalized_body) <> '8e70ac04aaa3368aea5cbcbe9bd1434a'
     OR (pg_catalog.length(normalized_body)-pg_catalog.length(pg_catalog.replace(normalized_body,needle,''))) <> pg_catalog.length(needle)
  THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_SOURCE_UNEXPECTED'; END IF;
  corrected_body := pg_catalog.replace(normalized_body,needle,assignments||needle);
  IF pg_catalog.md5(corrected_body) <> 'de87d75592ce3fe5872de90b4be9a466'
  THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_PATCH_UNEXPECTED'; END IF;
  definition := pg_catalog.pg_get_functiondef(routine);
  IF (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,original_body,''))) <> pg_catalog.length(original_body)
  THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_DEFINITION_UNEXPECTED'; END IF;
  EXECUTE pg_catalog.replace(definition,original_body,corrected_body);
  SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=routine;
  IF pg_catalog.md5(pg_catalog.replace(after_row.prosrc,E'\r\n',E'\n')) <> 'de87d75592ce3fe5872de90b4be9a466'
     OR ROW(after_row.oid,after_row.proowner,after_row.proacl,after_row.prolang,after_row.prosecdef,
            after_row.proisstrict,after_row.provolatile,after_row.proconfig,after_row.prorettype,
            after_row.proretset,after_row.proargtypes,after_row.proallargtypes,after_row.proargmodes,
            after_row.proargnames,after_row.proparallel,after_row.proleakproof,after_row.procost,after_row.prorows)
        IS DISTINCT FROM
        ROW(before_row.oid,before_row.proowner,before_row.proacl,before_row.prolang,before_row.prosecdef,
            before_row.proisstrict,before_row.provolatile,before_row.proconfig,before_row.prorettype,
            before_row.proretset,before_row.proargtypes,before_row.proallargtypes,before_row.proargmodes,
            before_row.proargnames,before_row.proparallel,before_row.proleakproof,before_row.procost,before_row.prorows)
  THEN RAISE EXCEPTION 'SHIFT_RECONCILE_SUMMARIES_METADATA_CHANGED'; END IF;
END;
$shift_reconcile_summaries$;
