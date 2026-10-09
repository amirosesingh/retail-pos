-- Cloud-only admin browser registrations. Never part of the POS sync registry.
BEGIN;
CREATE SCHEMA IF NOT EXISTS admin_portal;
REVOKE ALL ON SCHEMA admin_portal FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS admin_portal.activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_user_id uuid NOT NULL REFERENCES auth.users(id),
 device_name text NOT NULL,
 code_hash text,
 code_expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 proof_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 activated_at timestamptz,
 last_seen_at timestamptz,
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS admin_portal.activation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 activation_id uuid NOT NULL REFERENCES admin_portal.activations(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_portal.activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_portal.activation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA admin_portal FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.admin_web_activation(
 p_action text, p_id uuid DEFAULT NULL, p_code text DEFAULT NULL,
 p_device_name text DEFAULT NULL, p_proof text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_row admin_portal.activations; v_code text;
BEGIN
 IF v_user IS NULL OR NOT public.has_role(v_user,'admin'::public.app_role) THEN
  RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_action='list' THEN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'adminUserId',a.admin_user_id,'adminEmail',u.email,'deviceName',a.device_name,
   'createdAt',a.created_at,'activatedAt',a.activated_at,'lastSeenAt',a.last_seen_at,
   'revokedAt',a.revoked_at,'expiresAt',a.code_expires_at
  ) ORDER BY a.created_at DESC) FROM admin_portal.activations a JOIN auth.users u ON u.id=a.admin_user_id),'[]'::jsonb);
 ELSIF p_action='issue' THEN
  IF length(btrim(COALESCE(p_device_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Enter a device name (1–100 characters)'; END IF;
  v_code := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  INSERT INTO admin_portal.activations(admin_user_id,device_name,code_hash)
   VALUES(v_user,btrim(p_device_name),encode(sha256(convert_to(v_code,'UTF8')),'hex')) RETURNING * INTO v_row;
  INSERT INTO admin_portal.activation_events(activation_id,actor_id,action) VALUES(v_row.id,v_user,'issued');
  RETURN jsonb_build_object('id',v_row.id,'code',v_code,'expiresAt',v_row.code_expires_at);
 ELSIF p_action='claim' THEN
  IF length(COALESCE(p_code,''))<>64 OR length(COALESCE(p_proof,'')) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'INVALID_ACTIVATION'; END IF;
  UPDATE admin_portal.activations SET activated_at=now(),last_seen_at=now(),code_hash=NULL,
   proof_hash=encode(sha256(convert_to(p_proof,'UTF8')),'hex')
   WHERE id=p_id AND admin_user_id=v_user AND revoked_at IS NULL AND activated_at IS NULL
   AND code_expires_at>now() AND code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Activation code is expired, used, revoked or belongs to another admin'; END IF;
  INSERT INTO admin_portal.activation_events(activation_id,actor_id,action) VALUES(v_row.id,v_user,'activated');
  RETURN jsonb_build_object('ok',true,'id',v_row.id);
 ELSIF p_action='heartbeat' THEN
  IF length(COALESCE(p_proof,'')) NOT BETWEEN 32 AND 128 THEN RETURN jsonb_build_object('ok',false); END IF;
  UPDATE admin_portal.activations SET last_seen_at=now()
   WHERE id=p_id AND admin_user_id=v_user AND revoked_at IS NULL AND activated_at IS NOT NULL
   AND proof_hash=encode(sha256(convert_to(p_proof,'UTF8')),'hex');
  RETURN jsonb_build_object('ok',FOUND);
 ELSIF p_action='revoke' THEN
  UPDATE admin_portal.activations SET revoked_at=now(),code_hash=NULL,proof_hash=NULL WHERE id=p_id AND revoked_at IS NULL;
  IF FOUND THEN INSERT INTO admin_portal.activation_events(activation_id,actor_id,action) VALUES(p_id,v_user,'revoked'); END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION 'Unsupported admin activation action';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_web_activation(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_web_activation(text,uuid,text,text,text) TO authenticated;
COMMIT;
