-- AUTH-37 foundation only. Source/isolated fixtures approved; no live enrollment
-- or application. This stores public author keys, never signing credentials.
BEGIN;
CREATE SCHEMA IF NOT EXISTS pos_sync_private;
CREATE TABLE pos_sync_private.shift_author_keys (
 key_id uuid PRIMARY KEY,
 author_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 terminal_id text NOT NULL,
 project_origin text NOT NULL CHECK(project_origin ~ '^https://[^/?#@]+$'),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200 AND subject !~ '[[:cntrl:]]'),
 public_key text NOT NULL UNIQUE CHECK(public_key ~ '^[A-Za-z0-9_-]{59}$'),
 enrolled_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE(project_origin,terminal_id,author_id)
);
ALTER TABLE pos_sync_private.shift_author_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_private.shift_author_keys FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pos_sync_private.shift_author_key_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.key_id,NEW.author_id,NEW.terminal_id,NEW.project_origin,NEW.subject,NEW.public_key,NEW.enrolled_at)
   IS DISTINCT FROM ROW(OLD.key_id,OLD.author_id,OLD.terminal_id,OLD.project_origin,OLD.subject,OLD.public_key,OLD.enrolled_at) OR
   (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_KEY_IMMUTABLE'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pos_sync_private.shift_author_key_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER shift_author_key_immutable BEFORE UPDATE OR DELETE ON pos_sync_private.shift_author_keys
 FOR EACH ROW EXECUTE FUNCTION pos_sync_private.shift_author_key_immutable();

-- Only the hosted verified-person endpoint can call this routine. Possession and
-- the exact personal identity are checked there before reaching this service API.
CREATE FUNCTION public.pos_shift_author_enroll(p_enrollment jsonb,p_subject text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE saved pos_sync_private.shift_author_keys%ROWTYPE; person public.app_users%ROWTYPE;
 v_author uuid; v_key uuid; v_terminal text; v_project text; v_public text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 IF jsonb_typeof(p_enrollment) IS DISTINCT FROM 'object' OR p_enrollment->>'version' IS DISTINCT FROM '1' OR
   p_enrollment->>'algorithm' IS DISTINCT FROM 'Ed25519' OR
   (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_enrollment) k) IS DISTINCT FROM
   ARRAY['algorithm','authorId','keyId','projectOrigin','publicKey','terminalId','version']::text[]
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 v_author:=(p_enrollment->>'authorId')::uuid; v_key:=(p_enrollment->>'keyId')::uuid;
 v_terminal:=p_enrollment->>'terminalId'; v_project:=p_enrollment->>'projectOrigin'; v_public:=p_enrollment->>'publicKey';
 IF v_author IS NULL OR v_key IS NULL OR v_terminal IS NULL OR v_project IS NULL OR v_public IS NULL OR
   v_terminal='' OR length(v_terminal)>200 OR v_terminal<>btrim(v_terminal) OR v_terminal ~ '[[:cntrl:]]' OR
   v_project !~ '^https://[^/?#@]+$' OR v_public !~ '^[A-Za-z0-9_-]{59}$'
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 SELECT * INTO person FROM public.app_users WHERE id=v_author FOR SHARE;
 IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM p_subject
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=v_terminal AND platform='pc' AND
   status IN ('active','used') AND is_claimed=true AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('shift-author:'||v_project||':'||v_terminal||':'||v_author::text,0));
 SELECT * INTO saved FROM pos_sync_private.shift_author_keys
  WHERE project_origin=v_project AND terminal_id=v_terminal AND author_id=v_author FOR UPDATE;
 IF FOUND THEN
  IF saved.key_id IS DISTINCT FROM v_key OR saved.public_key IS DISTINCT FROM v_public OR saved.subject IS DISTINCT FROM p_subject OR saved.revoked_at IS NOT NULL
  THEN RAISE EXCEPTION 'SHIFT_AUTHOR_KEY_MISMATCH'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys WHERE key_id=v_key OR public_key=v_public)
 THEN RAISE EXCEPTION 'SHIFT_AUTHOR_KEY_MISMATCH'; END IF;
 INSERT INTO pos_sync_private.shift_author_keys(key_id,author_id,terminal_id,project_origin,subject,public_key)
 VALUES(v_key,v_author,v_terminal,v_project,p_subject,v_public);
 RETURN jsonb_build_object('ok',true,'replayed',false);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_shift_author_enroll(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_shift_author_enroll(jsonb,text) TO service_role;

-- Revoked keys remain available for exact accepted-history verification. No key
-- or account state in this read grants permission for a new financial write.
CREATE FUNCTION public.pos_shift_author_key(p_project_origin text,p_terminal_id text,p_author_id uuid DEFAULT NULL,p_key_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE saved jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SHIFT_AUTHOR_DENIED'; END IF;
 SELECT to_jsonb(k) INTO saved FROM pos_sync_private.shift_author_keys k
 WHERE k.project_origin=p_project_origin AND k.terminal_id=p_terminal_id AND k.author_id=p_author_id AND k.key_id=p_key_id;
 RETURN jsonb_build_object('terminal_enrolled',EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys
  WHERE project_origin=p_project_origin AND terminal_id=p_terminal_id),'key',saved);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_shift_author_key(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_shift_author_key(text,text,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
