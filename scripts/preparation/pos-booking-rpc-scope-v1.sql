-- Isolated POS beta preparation. Preserve the reviewed booking transactions.
-- Apply once to the verified base. Unknown definitions or grants abort.
BEGIN;
SET LOCAL search_path = pg_catalog;

DO $booking_scope$
DECLARE
  routine record;
  target regprocedure;
  definition text;
  locked_booking constant text := '  SELECT * INTO b FROM public.bookings bk WHERE bk.id = _booking_id FOR UPDATE;';
  scoped_booking constant text := $body$  SELECT * INTO b
  FROM public.bookings bk
  WHERE bk.id = _booking_id
    AND ((SELECT auth.role()) = 'service_role'
      OR ((SELECT auth.uid()) IS NOT NULL
        AND public.is_staff_now()
        AND public.store_visible(bk.store_id)
        AND public.user_has_store_access(bk.store_id)))
  FOR UPDATE;$body$;
BEGIN
  FOR routine IN
    SELECT * FROM (VALUES
      ('public.booking_balance_state(uuid)', 'ad6b0962da0bc80146e6c270472ac332c0e381b0bc8f65facbf652e37d2dbbf6', false),
      ('public.booking_net_paid(uuid)', '8f437dbb04be81723024139ee95620c046886638effccaa6e0686f2eb8971d51', false),
      ('public.booking_collect(uuid,numeric,text,text,text,text,boolean)', '397a8cab01e28f4e52aea30c9c9dc8976e5f4718872878b72b4eb94dee3f9014', true),
      ('public.booking_refund(uuid,numeric,text,text,text,text)', '2842dec33eea97fbc13f8c5b97b0837e1f3ec1670655e7a921732f43085c137d', true),
      ('public.booking_cancel(uuid,text,text,text,text,text)', '7c62faf75d150df422e3a43d640734a051fa088a94217471918421c3d9e383d7', true)
    ) AS reviewed(signature, sha256_hex, writer)
  LOOP
    target := to_regprocedure(routine.signature);
    SELECT pg_get_functiondef(proc.oid) INTO definition
    FROM pg_proc AS proc
    WHERE proc.oid = target AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
    IF definition IS NULL
       OR encode(sha256(convert_to(replace(definition, E'\r\n', E'\n'), 'UTF8')), 'hex') <> routine.sha256_hex
       OR has_function_privilege('anon', target, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', target, 'EXECUTE')
       OR NOT has_function_privilege('service_role', target, 'EXECUTE') THEN
      RAISE EXCEPTION 'POS_BOOKING_SCOPE_SOURCE_UNEXPECTED: %', routine.signature;
    END IF;

    IF routine.writer THEN
      IF length(definition) - length(replace(definition, locked_booking, '')) <> length(locked_booking) THEN
        RAISE EXCEPTION 'POS_BOOKING_SCOPE_LOCK_UNEXPECTED: %', routine.signature;
      END IF;
      EXECUTE replace(definition, locked_booking, scoped_booking);
    ELSE
      -- Public reads inherit the existing bookings and parent-payment RLS.
      -- Their guarded internal callers still run as the booking writer.
      EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', target);
    END IF;
  END LOOP;
END;
$booking_scope$;

NOTIFY pgrst, 'reload schema';
COMMIT;
