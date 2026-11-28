-- FIN62 JSON field identity uses byte ordering, independently of database locale.
-- Preserve the optional cohort, immutable events, financial bytes and all grants.
-- The migration caller owns the transaction; no business rows are rewritten.
DO $financial_fact_key_order$
DECLARE
  routine oid:=to_regprocedure('fin62_history_preparation.fact(jsonb)');
  previous record;
  source_hash text;
  definition text;
BEGIN
  IF routine IS NULL THEN
    IF to_regclass('fin62_history_preparation.nodes') IS NOT NULL THEN
      RAISE EXCEPTION 'FIN62_FACT_KEY_ORDER_BASELINE_MISSING';
    END IF;
    -- The canonical installer may precede optional FIN62 preparation. Do not
    -- create a helper, financial tables, activation or authority in that case.
    RETURN;
  END IF;
  SELECT p.*,l.lanname INTO STRICT previous
  FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=routine;
  source_hash:=md5(replace(previous.prosrc,E'\r\n',E'\n'));
  IF current_user<>'postgres' OR previous.proowner<>'postgres'::regrole
    OR previous.lanname<>'plpgsql' OR previous.prokind<>'f'
    OR previous.prosecdef OR NOT previous.proisstrict OR previous.provolatile<>'i'
    OR previous.proretset OR previous.prorettype<>'jsonb'::regtype
    OR previous.pronargs<>1 OR previous.proargnames IS DISTINCT FROM ARRAY['value']::text[]
    OR previous.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR source_hash NOT IN('110f0e468314681e878cee9a1bfcd778','49814368b1669fc9d9943aca23eb5ce1')
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(previous.proacl,acldefault('f',previous.proowner))) grant_entry
      WHERE grant_entry.grantee<>previous.proowner) THEN
    RAISE EXCEPTION 'FIN62_FACT_KEY_ORDER_SOURCE_UNEXPECTED';
  END IF;
  IF source_hash='49814368b1669fc9d9943aca23eb5ce1' THEN RETURN; END IF;
  definition:=pg_get_functiondef(routine);
  definition:=replace(definition,'array_agg(key ORDER BY key)','array_agg(key ORDER BY key COLLATE "C")');
  EXECUTE definition;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=routine
    AND md5(replace(p.prosrc,E'\r\n',E'\n'))='49814368b1669fc9d9943aca23eb5ce1'
    AND p.proowner=previous.proowner AND p.proacl IS NOT DISTINCT FROM previous.proacl
    AND p.prosecdef=previous.prosecdef AND p.proisstrict=previous.proisstrict
    AND p.provolatile=previous.provolatile AND p.proconfig IS NOT DISTINCT FROM previous.proconfig) THEN
    RAISE EXCEPTION 'FIN62_FACT_KEY_ORDER_POSTFLIGHT_FAILED';
  END IF;
END
$financial_fact_key_order$;
