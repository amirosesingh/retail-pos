-- Safe post-upgrade checks: never refund a real bill or change business rows.
DO $$
DECLARE sid uuid; branch text; msg text;
BEGIN
  IF to_regprocedure('public.sale_refund(uuid,jsonb,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Five-argument refund routine is missing';
  END IF;
  IF to_regprocedure('public.sale_refund(uuid,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'An obsolete refund overload remains';
  END IF;
  IF has_function_privilege('anon', 'public.sale_refund(uuid,jsonb,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous refund execution must remain disabled';
  END IF;
  BEGIN
    PERFORM public.sale_refund('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'contract-check', NULL, NULL);
    RAISE EXCEPTION 'Unexpected refund acceptance';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg <> 'Unknown bill' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.sale_refund('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'legacy-contract-check', NULL);
    RAISE EXCEPTION 'Unexpected refund acceptance';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg <> 'Unknown bill' THEN RAISE; END IF;
  END;
  SELECT id, store_id INTO sid, branch FROM public.sales LIMIT 1;
  IF sid IS NOT NULL THEN
    BEGIN
      PERFORM public.sale_refund(sid, NULL, 'branch-contract-check', NULL, coalesce(branch, '') || ':invalid-branch');
      RAISE EXCEPTION 'Unexpected branch acceptance';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      IF msg <> 'The refund must belong to the specified branch' THEN RAISE; END IF;
    END;
  END IF;
END $$;
SELECT 'Refund RPC checks passed; no business rows changed' AS verification;
