ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS offline_login_pin_hash text NOT NULL DEFAULT '';

-- Service-only provisioning. The hosted handler verifies the administrator;
-- neither the hash nor this routine is exposed through staff-list responses.
CREATE OR REPLACE FUNCTION public.set_offline_login_pin(p_user_id text, p_pin text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp' AS $$
BEGIN
  IF p_pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Offline sign-in PIN must be 6 digits'; END IF;
  UPDATE public.app_users SET offline_login_pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),updated_at=now()
  WHERE lower(user_id)=lower(trim(p_user_id)) AND is_active IS TRUE
    AND email LIKE '%@%' AND lower(email) NOT LIKE '%@pos-internal.local' AND lower(email) NOT LIKE '%@pos.local';
  IF NOT FOUND THEN RAISE EXCEPTION 'An active email account is required'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_offline_login_pin(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_offline_login_pin(text,text) TO service_role;

-- Online cashier choices never include email/password accounts or approval-only PINs.
CREATE OR REPLACE FUNCTION public.terminal_staff_list(p_store_id text DEFAULT NULL::text)
RETURNS TABLE(user_id text,full_name text,role_slug text,store_id text,kind text,pin_length smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT a.user_id::text,a.full_name::text,coalesce(a.role_slug,'cashier'),a.store_id::text,'account'::text,0::smallint
 FROM public.app_users a
 WHERE a.is_active AND (lower(a.email) LIKE '%@pos-internal.local' OR lower(a.email) LIKE '%@pos.local')
 AND EXISTS(SELECT 1 FROM public.cashiers c WHERE lower(c.username)=lower(a.user_id) AND c.is_active AND coalesce(c.pin_hash,'')<>'')
 AND (coalesce(trim(p_store_id),'')='' OR coalesce(a.store_id,'') IN ('',trim(p_store_id)))
 ORDER BY a.full_name
$$;
