-- Keep the atomic transfer implementations privileged, but expose only
-- branch- and permission-checked SECURITY DEFINER entry points.

DROP FUNCTION IF EXISTS public.stock_transfer_receive(uuid, text, boolean);

DO $move_transfer_implementations$
BEGIN
  IF to_regprocedure('public.stock_transfer_approve(uuid,text,jsonb)') IS NOT NULL
     AND to_regprocedure('private.stock_transfer_approve(uuid,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.stock_transfer_approve(uuid, text, jsonb) SET SCHEMA private;
  END IF;
  IF to_regprocedure('public.stock_transfer_dispatch(uuid,text,jsonb)') IS NOT NULL
     AND to_regprocedure('private.stock_transfer_dispatch(uuid,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.stock_transfer_dispatch(uuid, text, jsonb) SET SCHEMA private;
  END IF;
  IF to_regprocedure('public.stock_transfer_receive(uuid,text,boolean,jsonb)') IS NOT NULL
     AND to_regprocedure('private.stock_transfer_receive(uuid,text,boolean,jsonb)') IS NULL THEN
    ALTER FUNCTION public.stock_transfer_receive(uuid, text, boolean, jsonb) SET SCHEMA private;
  END IF;
  IF to_regprocedure('public.stock_transfer_verify(uuid,text,jsonb,text)') IS NOT NULL
     AND to_regprocedure('private.stock_transfer_verify(uuid,text,jsonb,text)') IS NULL THEN
    ALTER FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text) SET SCHEMA private;
  END IF;
END
$move_transfer_implementations$;

REVOKE ALL ON FUNCTION private.stock_transfer_approve(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.stock_transfer_dispatch(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.stock_transfer_receive(uuid, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.stock_transfer_verify(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.stock_transfer_approve(uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.stock_transfer_dispatch(uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.stock_transfer_receive(uuid, text, boolean, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.stock_transfer_verify(uuid, text, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.stock_transfer_approve(
  p_transfer_id uuid,
  p_approved_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t public.stock_transfers;
BEGIN
  SELECT * INTO t
    FROM public.stock_transfers
   WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE';
  END IF;
  IF NOT public.has_perm('can_approve_transfer')
     OR NOT public.user_has_store_access(t.from_store_id) THEN
    RAISE EXCEPTION 'You cannot approve transfers for this sending location'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM private.stock_transfer_approve(p_transfer_id, p_approved_by, p_lines);
END
$fn$;

CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch(
  p_transfer_id uuid,
  p_dispatched_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t public.stock_transfers;
BEGIN
  SELECT * INTO t
    FROM public.stock_transfers
   WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE';
  END IF;
  IF NOT public.has_perm('can_create_transfer')
     OR NOT public.user_has_store_access(t.from_store_id) THEN
    RAISE EXCEPTION 'You cannot dispatch transfers for this sending location'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM private.stock_transfer_dispatch(p_transfer_id, p_dispatched_by, p_lines);
END
$fn$;

CREATE OR REPLACE FUNCTION public.stock_transfer_receive(
  p_transfer_id uuid,
  p_received_by text DEFAULT NULL,
  p_deduct_source boolean DEFAULT false,
  p_lines jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t public.stock_transfers;
BEGIN
  SELECT * INTO t
    FROM public.stock_transfers
   WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE';
  END IF;
  IF NOT public.has_perm('can_receive_transfer')
     OR NOT public.user_has_store_access(t.to_store_id) THEN
    RAISE EXCEPTION 'You cannot receive transfers for this destination location'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM private.stock_transfer_receive(
    p_transfer_id,
    p_received_by,
    p_deduct_source,
    p_lines
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.stock_transfer_verify(
  p_transfer_id uuid,
  p_verified_by text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t public.stock_transfers;
BEGIN
  SELECT * INTO t
    FROM public.stock_transfers
   WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE';
  END IF;
  IF NOT public.has_perm('can_receive_transfer')
     OR NOT public.user_has_store_access(t.to_store_id) THEN
    RAISE EXCEPTION 'You cannot verify transfers for this destination location'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM private.stock_transfer_verify(
    p_transfer_id,
    p_verified_by,
    p_lines,
    p_reason
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_dispatch(uuid, text, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_receive(uuid, text, boolean, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.stock_transfer_approve(uuid, text, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_dispatch(uuid, text, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_receive(uuid, text, boolean, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_verify(uuid, text, jsonb, text)
  TO authenticated, service_role;

DO $add_transfer_quantity_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_transfer_items'::regclass AND conname = 'stock_transfer_items_quantity_nonnegative') THEN
    ALTER TABLE public.stock_transfer_items ADD CONSTRAINT stock_transfer_items_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_transfer_items'::regclass AND conname = 'stock_transfer_items_approved_within_request') THEN
    ALTER TABLE public.stock_transfer_items ADD CONSTRAINT stock_transfer_items_approved_within_request CHECK (quantity_approved IS NULL OR quantity_approved BETWEEN 0 AND quantity) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_transfer_items'::regclass AND conname = 'stock_transfer_items_dispatched_within_approval') THEN
    ALTER TABLE public.stock_transfer_items ADD CONSTRAINT stock_transfer_items_dispatched_within_approval CHECK (quantity_dispatched IS NULL OR quantity_dispatched BETWEEN 0 AND COALESCE(quantity_approved, quantity)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_transfer_items'::regclass AND conname = 'stock_transfer_items_received_within_dispatch') THEN
    ALTER TABLE public.stock_transfer_items ADD CONSTRAINT stock_transfer_items_received_within_dispatch CHECK (quantity_received BETWEEN 0 AND COALESCE(quantity_dispatched, quantity)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_transfer_items'::regclass AND conname = 'stock_transfer_items_verified_within_dispatch') THEN
    ALTER TABLE public.stock_transfer_items ADD CONSTRAINT stock_transfer_items_verified_within_dispatch CHECK (quantity_verified IS NULL OR quantity_verified BETWEEN 0 AND COALESCE(quantity_dispatched, quantity)) NOT VALID;
  END IF;
END
$add_transfer_quantity_constraints$;

ALTER TABLE public.stock_transfer_items
  VALIDATE CONSTRAINT stock_transfer_items_quantity_nonnegative;
ALTER TABLE public.stock_transfer_items
  VALIDATE CONSTRAINT stock_transfer_items_approved_within_request;
ALTER TABLE public.stock_transfer_items
  VALIDATE CONSTRAINT stock_transfer_items_dispatched_within_approval;
ALTER TABLE public.stock_transfer_items
  VALIDATE CONSTRAINT stock_transfer_items_received_within_dispatch;
ALTER TABLE public.stock_transfer_items
  VALIDATE CONSTRAINT stock_transfer_items_verified_within_dispatch;

NOTIFY pgrst, 'reload schema';
