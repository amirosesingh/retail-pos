-- Stock transfers use the same configurable authorisation vocabulary as the
-- register. Existing transfer lifecycle locks remain authoritative after the
-- authorisation gate has allowed the transfer to be raised.
ALTER TABLE public.authorization_actions
  ADD COLUMN IF NOT EXISTS approval_timeout_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS escalation_after_minutes integer,
  ADD COLUMN IF NOT EXISTS escalation_roles text[] NOT NULL DEFAULT ARRAY[]::text[];

DO $$ BEGIN
  ALTER TABLE public.authorization_actions
    ADD CONSTRAINT authorization_actions_timeout_chk
    CHECK (approval_timeout_minutes BETWEEN 1 AND 1440);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only modes understood by the POS may be stored.
UPDATE public.authorization_actions
   SET mode = 'request', updated_at = now()
 WHERE mode NOT IN ('none', 'pin', 'request', 'either');

DO $$ BEGIN
  ALTER TABLE public.authorization_actions
    ADD CONSTRAINT authorization_actions_mode_chk
    CHECK (mode IN ('none', 'pin', 'request', 'either'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.authorization_actions
    ADD CONSTRAINT authorization_actions_escalation_chk
    CHECK (escalation_after_minutes IS NULL OR escalation_after_minutes BETWEEN 1 AND 1440);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.authorization_actions (
  action_key, scope_type, scope_id, mode, allowed_roles, allowed_user_ids,
  requester_roles, requester_user_ids, require_reason, is_enabled
)
VALUES (
  'stock_transfer', 'global', '', 'request',
  ARRAY['admin','manager']::text[], ARRAY[]::text[],
  ARRAY['cashier','staff','manager','admin']::text[], ARRAY[]::text[],
  true, true
)
ON CONFLICT (action_key, scope_type, scope_id) DO NOTHING;

-- A historical seed used a mode name the application never recognised.
-- Preserve its approver list but normalize the method to a real request.
UPDATE public.authorization_actions
   SET mode = 'request', updated_at = now()
 WHERE action_key = 'cross_group_transfer_approval'
   AND mode NOT IN ('none', 'pin', 'request', 'either');

-- The selected stock-transfer method supersedes the older boolean switch.
-- If the new rule has not reached a store yet, retain the old behavior.
CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text, _to_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      -- The generic authorization request is now the only approval lifecycle.
      -- Once it grants the creation mutation, do not create a second legacy
      -- transfer approval that would need a second decision.
      SELECT false
        FROM public.authorization_actions a
       WHERE a.action_key = 'stock_transfer'
         AND a.is_enabled
         AND (
           (a.scope_type = 'branch' AND a.scope_id = _store_id)
           OR (a.scope_type = 'global' AND a.scope_id = '')
         )
       ORDER BY CASE WHEN a.scope_type = 'branch' THEN 0 ELSE 1 END
       LIMIT 1
    ),
    public.stock_transfer_approval_required(_store_id)
  )
$$;

REVOKE ALL ON FUNCTION public.stock_transfer_approval_required(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_approval_required(text, text)
  TO authenticated, service_role;

-- PIN verification is reached only through the trusted application server.
-- Direct authenticated execution would expose a SECURITY DEFINER routine.
REVOKE ALL ON FUNCTION public.authorization_verify_pin(text, text, text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_verify_pin(text, text, text[], text[])
  TO service_role;
