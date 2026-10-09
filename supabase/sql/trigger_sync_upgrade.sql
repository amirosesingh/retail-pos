-- Additive upgrade: run once in the POS Supabase project's SQL Editor as owner.
-- The same definitions are included in supabase/schema.sql for fresh installs.
-- This only sends wake-up hints. The authenticated delta API still owns data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.pos_sync_topic_allowed(p_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user public.app_users%ROWTYPE;
  v_terminal public.terminal_tokens%ROWTYPE;
  v_branch text;
  v_topic_terminal text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_user FROM public.app_users
    WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_user.id IS NULL THEN RETURN false; END IF;
  v_branch := v_user.store_id;
  -- Machine accounts use a server-owned profile, never user_metadata claims.
  IF lower(COALESCE(v_user.email,'')) LIKE 'terminal.%@pos.local' THEN
    SELECT * INTO v_terminal FROM public.terminal_tokens
      WHERE lower('terminal.' || id::text || '@pos.local')=lower(v_user.email)
        AND revoked_at IS NULL AND claimed_at IS NOT NULL AND status IN ('active','used') LIMIT 1;
    IF v_terminal.id IS NULL THEN RETURN false; END IF;
    v_branch := v_terminal.location_id;
  END IF;
  IF p_topic='pos-sync:default:global' THEN RETURN true; END IF;
  IF p_topic='pos-sync:default:branch:' || v_branch THEN RETURN true; END IF;
  IF p_topic LIKE 'pos-sync:default:terminal:%' THEN
    v_topic_terminal := substr(p_topic,length('pos-sync:default:terminal:')+1);
    IF v_terminal.id IS NOT NULL THEN RETURN v_topic_terminal=v_terminal.id::text; END IF;
    RETURN EXISTS (SELECT 1 FROM public.terminal_tokens t
      WHERE t.id::text=v_topic_terminal AND t.revoked_at IS NULL
        AND t.claimed_at IS NOT NULL AND t.status IN ('active','used')
        AND (v_user.role='admin' OR t.location_id=v_branch));
  END IF;
  RETURN v_terminal.id IS NULL AND v_user.role='admin' AND p_topic LIKE 'pos-sync:default:branch:%';
END $$;
REVOKE ALL ON FUNCTION private.pos_sync_topic_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.pos_sync_topic_allowed(text) TO authenticated;

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_sync_wake_receive ON realtime.messages;
CREATE POLICY pos_sync_wake_receive ON realtime.messages FOR SELECT TO authenticated
USING (extension='broadcast' AND private.pos_sync_topic_allowed((SELECT realtime.topic())));
-- Existing broad policies cannot widen this namespace or let clients forge hints.
DROP POLICY IF EXISTS pos_sync_wake_receive_scope ON realtime.messages;
CREATE POLICY pos_sync_wake_receive_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT realtime.topic()) NOT LIKE 'pos-sync:%' OR private.pos_sync_topic_allowed((SELECT realtime.topic())));
DROP POLICY IF EXISTS pos_sync_wake_no_anonymous_receive ON realtime.messages;
CREATE POLICY pos_sync_wake_no_anonymous_receive ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon
USING ((SELECT realtime.topic()) NOT LIKE 'pos-sync:%');
DROP POLICY IF EXISTS pos_sync_wake_server_send_only ON realtime.messages;
CREATE POLICY pos_sync_wake_server_send_only ON realtime.messages AS RESTRICTIVE FOR INSERT TO authenticated, anon
WITH CHECK ((SELECT realtime.topic()) NOT LIKE 'pos-sync:%');

CREATE OR REPLACE FUNCTION private.pos_sync_wake_from_feed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_topic text; v_key text; v_seen jsonb;
BEGIN
  IF NEW.organization_id <> 'default' THEN RETURN NULL; END IF;
  v_topic := CASE
    WHEN NEW.terminal_id IS NOT NULL THEN 'pos-sync:default:terminal:' || NEW.terminal_id
    WHEN NEW.branch_id='global' THEN 'pos-sync:default:global'
    ELSE 'pos-sync:default:branch:' || NEW.branch_id END;
  IF v_topic IS NULL THEN RETURN NULL; END IF;
  v_key := v_topic || ':' || NEW.table_name;
  v_seen := COALESCE(NULLIF(current_setting('pos.sync_wake_sent',true),''),'{}')::jsonb;
  -- One table/topic hint per transaction, even when 500 audit rows are inserted.
  IF v_seen ? v_key THEN RETURN NULL; END IF;
  PERFORM realtime.send(jsonb_build_object('table',NEW.table_name),'sync_changed',v_topic,true);
  PERFORM set_config('pos.sync_wake_sent',(v_seen || jsonb_build_object(v_key,true))::text,true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Notifications are best effort; never roll back a sale for a socket outage.
  RAISE WARNING 'POS sync notification unavailable [%]', SQLSTATE;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.pos_sync_wake_from_feed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pos_sync_wake ON public.sync_change_feed;
CREATE TRIGGER pos_sync_wake AFTER INSERT ON public.sync_change_feed
FOR EACH ROW EXECUTE FUNCTION private.pos_sync_wake_from_feed();
COMMIT;
