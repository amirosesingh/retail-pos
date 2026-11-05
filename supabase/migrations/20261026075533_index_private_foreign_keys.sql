-- Optional private/admin tables remain server-only. Add lookup indexes without
-- changing policies, grants, business rows or authentication configuration.
DO $private_fk_indexes$
DECLARE previous_timeout text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout','2s',true);
  IF to_regclass('admin_portal.activation_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS activation_events_activation_id_idx ON admin_portal.activation_events(activation_id);
    CREATE INDEX IF NOT EXISTS activation_events_actor_id_idx ON admin_portal.activation_events(actor_id);
  END IF;
  IF to_regclass('admin_portal.activations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS activations_admin_user_id_idx ON admin_portal.activations(admin_user_id);
  END IF;
  IF to_regclass('pos_private.approval_tokens') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS approval_tokens_terminal_id_idx ON pos_private.approval_tokens(terminal_id);
  END IF;
  PERFORM set_config('lock_timeout',previous_timeout,true);
END $private_fk_indexes$;
