-- Isolated fixture only. Captured read-only from installed POS on 2026-10-31.
-- Required creation/approval dependencies absent from the canonical function extractor.
-- Never applied by application migrations or production setup.
CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_arg_type text;
  v_result boolean;
BEGIN
  IF NULLIF(btrim(_store_id), '') IS NULL THEN
    RETURN false;
  END IF;

  /*
   * Prefer an existing TEXT implementation if one exists.
   */
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n
        ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'stock_transfer_approval_required'
       AND p.pronargs = 1
       AND p.proargtypes[0] = 'text'::regtype
       AND p.oid <> 'public.stock_transfer_approval_required(text)'::regprocedure
  ) THEN

    EXECUTE
      'SELECT public.stock_transfer_approval_required($1::text)'
      INTO v_result
      USING _store_id;

    RETURN COALESCE(v_result, false);
  END IF;

  /*
   * If the existing implementation uses UUID, call that version.
   */
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n
        ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'stock_transfer_approval_required'
       AND p.pronargs = 1
       AND p.proargtypes[0] = 'uuid'::regtype
  ) THEN

    BEGIN
      EXECUTE
        'SELECT public.stock_transfer_approval_required($1::uuid)'
        INTO v_result
        USING _store_id::uuid;

      RETURN COALESCE(v_result, false);

    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN false;
    END;
  END IF;

  /*
   * No existing one-store approval function was found.
   *
   * Returning false preserves the intended behaviour:
   * cross-group transfers are still forced to approval below.
   */
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text, _to_store_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.is_cross_group_transfer(_store_id,_to_store_id) THEN true
    ELSE COALESCE(
      (SELECT false FROM public.authorization_actions a
        WHERE a.action_key='stock_transfer' AND a.is_enabled
          AND ((a.scope_type='branch' AND a.scope_id=_store_id)
            OR (a.scope_type='global' AND a.scope_id=''))
        ORDER BY CASE WHEN a.scope_type='branch' THEN 0 ELSE 1 END LIMIT 1),
      public.stock_transfer_approval_required(_store_id)
    )
  END
$function$
;

CREATE OR REPLACE FUNCTION private.stock_transfer_approve(p_transfer_id uuid, p_approved_by text DEFAULT NULL::text, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.stock_transfers;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can approve a transfer';
  END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Transfer % is % and is not waiting for approval', t.ref, t.status;
  END IF;

  -- No list means "everything as asked for".
  UPDATE public.stock_transfer_items i
     SET quantity_approved = COALESCE(
           (SELECT (l ->> 'qty')::int FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
             WHERE l ->> 'product_id' = i.product_id::text LIMIT 1),
           i.quantity)
   WHERE i.transfer_id = t.id;

  UPDATE public.stock_transfers
     SET status = 'approved', approved_by = COALESCE(p_approved_by, approved_by), approved_at = now()
   WHERE id = t.id;
END $function$
;
