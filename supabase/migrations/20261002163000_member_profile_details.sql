-- Add optional, structured member address details without rewriting existing rows.
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS postal_code text;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_country_code_check;
ALTER TABLE public.members
  ADD CONSTRAINT members_country_code_check
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$') NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_country_code_check;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_postal_code_check;
ALTER TABLE public.members
  ADD CONSTRAINT members_postal_code_check
  CHECK (postal_code IS NULL OR char_length(postal_code) <= 32) NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_postal_code_check;

CREATE OR REPLACE FUNCTION public.membership_portal_profile_for(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'id', m.id, 'member_code', m.member_code, 'full_name', m.full_name,
    'phone', coalesce(m.phone, ''), 'email', coalesce(m.email, ''),
    'address', coalesce(m.address, ''), 'country_code', coalesce(m.country_code, ''),
    'postal_code', coalesce(m.postal_code, ''), 'date_of_birth', m.date_of_birth,
    'joined_at', m.created_at, 'loyalty_points', m.loyalty_points,
    'total_spent', m.total_spent, 'verified', m.is_verified,
    'verified_at', m.verified_at, 'verified_channel', m.verified_channel,
    'tier', jsonb_build_object(
      'id', t.id, 'name', coalesce(t.name, 'Member'),
      'discount_percentage', coalesce(t.discount_percentage, 0),
      'points_multiplier', coalesce(t.points_multiplier, 1)
    )
  )
  FROM public.members m
  LEFT JOIN public.membership_tiers t ON t.id = m.tier_id AND t.deleted_at IS NULL
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_enroll_details(p_profile jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_country text := upper(nullif(btrim(coalesce(p_profile->>'country_code', '')), ''));
  v_postal text := nullif(btrim(coalesce(p_profile->>'postal_code', '')), '');
  v_result jsonb;
  v_member_id uuid;
BEGIN
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Select a valid country.';
  END IF;
  IF char_length(coalesce(v_postal, '')) > 32 THEN RAISE EXCEPTION 'Postal code is too long.'; END IF;

  v_result := public.membership_portal_enroll(
    p_profile->>'full_name', p_profile->>'address',
    nullif(p_profile->>'date_of_birth', '')::date
  );
  v_member_id := (v_result->>'id')::uuid;
  UPDATE public.members
     SET country_code = v_country, postal_code = v_postal, updated_at = now()
   WHERE id = v_member_id AND auth_user_id = (SELECT auth.uid());
  RETURN public.membership_portal_profile_for(v_member_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_update_details(p_profile jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_country text := upper(nullif(btrim(coalesce(p_profile->>'country_code', '')), ''));
  v_postal text := nullif(btrim(coalesce(p_profile->>'postal_code', '')), '');
  v_result jsonb;
  v_member_id uuid;
BEGIN
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Select a valid country.';
  END IF;
  IF char_length(coalesce(v_postal, '')) > 32 THEN RAISE EXCEPTION 'Postal code is too long.'; END IF;

  v_result := public.membership_portal_update(
    p_profile->>'full_name', p_profile->>'address',
    nullif(p_profile->>'date_of_birth', '')::date
  );
  v_member_id := (v_result->>'id')::uuid;
  UPDATE public.members
     SET country_code = v_country, postal_code = v_postal, updated_at = now()
   WHERE id = v_member_id AND auth_user_id = (SELECT auth.uid());
  RETURN public.membership_portal_profile_for(v_member_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.membership_portal_enroll_details(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.membership_portal_update_details(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_portal_enroll_details(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.membership_portal_update_details(jsonb) TO authenticated, service_role;
