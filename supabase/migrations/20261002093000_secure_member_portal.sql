-- Customer membership portal backed by Supabase Auth.
-- Additive only: existing member, sale and loyalty data is preserved.

-- Verified signup replaces the former anonymous member_join flow, so the
-- configured member-domain landing page is intentionally enabled.
INSERT INTO public.public_flags (key, enabled)
VALUES ('member_domain_enabled', true)
ON CONFLICT (key) DO UPDATE SET enabled = true, updated_at = now();

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_auth_user_id_uidx
  ON public.members (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_email_normalized_idx
  ON public.members (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS members_phone_normalized_idx
  ON public.members (public.normalize_phone(phone))
  WHERE btrim(phone) <> '' AND deleted_at IS NULL;

-- The old policies treated every Supabase Auth user as a staff member. That
-- becomes unsafe as soon as customers can sign in, because verification rows
-- contain OTP hashes and attempt state. Keep them visible to real POS staff.
DROP POLICY IF EXISTS member_verifications_staff_read ON public.member_verifications;
DROP POLICY IF EXISTS member_verifications_staff_update ON public.member_verifications;
DROP POLICY IF EXISTS member_verifications_staff_write ON public.member_verifications;
CREATE POLICY member_verifications_staff_read ON public.member_verifications
  FOR SELECT TO authenticated USING ((SELECT public.is_staff_now()));
CREATE POLICY member_verifications_staff_update ON public.member_verifications
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff_now()))
  WITH CHECK ((SELECT public.is_staff_now()));
CREATE POLICY member_verifications_staff_write ON public.member_verifications
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_staff_now()));

CREATE OR REPLACE FUNCTION public.membership_portal_profile_for(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'id', m.id,
    'member_code', m.member_code,
    'full_name', m.full_name,
    'phone', coalesce(m.phone, ''),
    'email', coalesce(m.email, ''),
    'address', coalesce(m.address, ''),
    'date_of_birth', m.date_of_birth,
    'joined_at', m.created_at,
    'loyalty_points', m.loyalty_points,
    'total_spent', m.total_spent,
    'verified', m.is_verified,
    'verified_at', m.verified_at,
    'verified_channel', m.verified_channel,
    'tier', jsonb_build_object(
      'id', t.id,
      'name', coalesce(t.name, 'Member'),
      'discount_percentage', coalesce(t.discount_percentage, 0),
      'points_multiplier', coalesce(t.points_multiplier, 1)
    )
  )
  FROM public.members m
  LEFT JOIN public.membership_tiers t
    ON t.id = m.tier_id AND t.deleted_at IS NULL
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_claim()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text := lower(nullif(btrim(coalesce((SELECT auth.jwt())->>'email', '')), ''));
  v_phone text := public.normalize_phone(coalesce((SELECT auth.jwt())->>'phone', ''));
  v_member_id uuid;
  v_claimed_by uuid;
  v_matches integer;
  v_channel text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_AUTH_REQUIRED'; END IF;

  SELECT id INTO v_member_id
    FROM public.members
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_member_id IS NOT NULL THEN RETURN v_member_id; END IF;
  IF v_email IS NULL AND v_phone = '' THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_email, '') || ':' || v_phone, 0));
  SELECT count(*), (array_agg(id ORDER BY id))[1]
    INTO v_matches, v_member_id
    FROM public.members
   WHERE deleted_at IS NULL
     AND (
       (v_email IS NOT NULL AND lower(btrim(coalesce(email, ''))) = v_email)
       OR (v_phone <> '' AND public.normalize_phone(phone) = v_phone)
     );
  IF v_matches = 0 THEN RETURN NULL; END IF;
  IF v_matches > 1 THEN RAISE EXCEPTION 'MEMBERSHIP_CONTACT_AMBIGUOUS'; END IF;

  SELECT auth_user_id INTO v_claimed_by
    FROM public.members WHERE id = v_member_id FOR UPDATE;
  IF v_claimed_by IS NOT NULL AND v_claimed_by <> v_uid THEN
    RAISE EXCEPTION 'MEMBERSHIP_ALREADY_CLAIMED';
  END IF;
  v_channel := CASE WHEN v_phone <> '' THEN 'sms' ELSE 'email' END;
  UPDATE public.members
     SET auth_user_id = v_uid,
         is_verified = true,
         verified_at = coalesce(verified_at, now()),
         verified_channel = coalesce(verified_channel, v_channel),
         updated_at = now()
   WHERE id = v_member_id;
  RETURN v_member_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_member_id uuid;
BEGIN
  v_member_id := public.membership_portal_claim();
  IF v_member_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.membership_portal_profile_for(v_member_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_enroll(
  p_full_name text,
  p_address text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text := lower(nullif(btrim(coalesce((SELECT auth.jwt())->>'email', '')), ''));
  v_phone text := public.normalize_phone(coalesce((SELECT auth.jwt())->>'phone', ''));
  v_raw_phone text := nullif(btrim(coalesce((SELECT auth.jwt())->>'phone', '')), '');
  v_member_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_code text;
  v_channel text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_AUTH_REQUIRED'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Enter a full name between 2 and 120 characters.';
  END IF;
  IF char_length(coalesce(p_address, '')) > 500 THEN
    RAISE EXCEPTION 'Address is too long.';
  END IF;
  IF p_date_of_birth > current_date OR p_date_of_birth < current_date - interval '120 years' THEN
    RAISE EXCEPTION 'Enter a valid date of birth.';
  END IF;
  IF v_email IS NULL AND v_phone = '' THEN RAISE EXCEPTION 'MEMBERSHIP_AUTH_REQUIRED'; END IF;

  v_member_id := public.membership_portal_claim();
  IF v_member_id IS NOT NULL THEN RETURN public.membership_portal_profile_for(v_member_id); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_email, '') || ':' || v_phone, 0));
  v_member_id := public.membership_portal_claim();
  IF v_member_id IS NOT NULL THEN RETURN public.membership_portal_profile_for(v_member_id); END IF;

  v_code := 'M' || to_char(now(), 'YYMMDD') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_channel := CASE WHEN v_phone <> '' THEN 'sms' ELSE 'email' END;
  INSERT INTO public.members (
    member_code, full_name, phone, email, address, date_of_birth,
    loyalty_points, total_spent, auth_user_id, is_verified, verified_at,
    verified_channel
  ) VALUES (
    v_code, v_name, coalesce(v_raw_phone, ''), v_email,
    nullif(btrim(coalesce(p_address, '')), ''), p_date_of_birth,
    0, 0, v_uid, true, now(), v_channel
  ) RETURNING id INTO v_member_id;
  RETURN public.membership_portal_profile_for(v_member_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_update(
  p_full_name text,
  p_address text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_member_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_AUTH_REQUIRED'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Enter a full name between 2 and 120 characters.';
  END IF;
  IF char_length(coalesce(p_address, '')) > 500 THEN RAISE EXCEPTION 'Address is too long.'; END IF;
  IF p_date_of_birth > current_date OR p_date_of_birth < current_date - interval '120 years' THEN
    RAISE EXCEPTION 'Enter a valid date of birth.';
  END IF;
  SELECT id INTO v_member_id FROM public.members
   WHERE auth_user_id = v_uid AND deleted_at IS NULL FOR UPDATE;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;
  UPDATE public.members
     SET full_name = v_name,
         address = nullif(btrim(coalesce(p_address, '')), ''),
         date_of_birth = p_date_of_birth,
         updated_at = now()
   WHERE id = v_member_id;
  RETURN public.membership_portal_profile_for(v_member_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.membership_portal_sales(p_limit integer DEFAULT 25)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'id', s.id,
    'bill_number', s.bill_number,
    'store_name', coalesce(s.store_name_snapshot, s.store_id, ''),
    'total', s.total_amount,
    'discount', s.discount_amount + coalesce(s.coupon_discount, 0),
    'points_earned', s.points_earned,
    'points_redeemed', s.points_redeemed,
    'refunded', s.is_refunded,
    'created_at', s.created_at,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', i.product_name,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'discount', i.discount_amount + coalesce(i.coupon_discount, 0)
      ) ORDER BY i.created_at, i.id)
      FROM public.sale_items i WHERE i.sale_id = s.id
    ), '[]'::jsonb)
  )
  FROM public.sales s
  JOIN public.members m ON m.id = s.member_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND m.auth_user_id = (SELECT auth.uid())
    AND m.deleted_at IS NULL
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100);
$fn$;

REVOKE ALL ON FUNCTION public.membership_portal_profile_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.membership_portal_enroll(text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.membership_portal_update(text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.membership_portal_sales(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_portal_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.membership_portal_enroll(text, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.membership_portal_update(text, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.membership_portal_sales(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
