-- Membership project only. Consent evidence stays outside the POS business mirror.
BEGIN;
CREATE TABLE IF NOT EXISTS public.member_signup_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  marketing_consent boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS member_signup_consents_member_idx
  ON public.member_signup_consents(member_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS member_signup_consents_owner_idx
  ON public.member_signup_consents(auth_user_id, accepted_at DESC);
ALTER TABLE public.member_signup_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_signup_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_signup_consents TO authenticated;
GRANT ALL ON public.member_signup_consents TO service_role;
DROP POLICY IF EXISTS member_signup_consents_read_own ON public.member_signup_consents;
CREATE POLICY member_signup_consents_read_own ON public.member_signup_consents
  FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.membership_signup_policy_version()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $policy$
  SELECT jsonb_build_object('terms_version', '2026-10-17.1', 'privacy_version', '2026-10-17.1');
$policy$;
REVOKE ALL ON FUNCTION public.membership_signup_policy_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.membership_signup_policy_version() TO anon, authenticated, service_role;

-- Email OTP may claim a pre-existing member before enrollment. The previous
-- function returned that row immediately, leaving the newly submitted mobile
-- number and profile details unsaved. Treat enrollment as an idempotent
-- completion operation for both newly inserted and just-claimed members.

create or replace function public.membership_portal_enroll_details(p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(btrim(coalesce(auth.jwt()->>'email', '')), ''));
  v_phone text := nullif(regexp_replace(coalesce(p_profile->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_name text := btrim(coalesce(p_profile->>'full_name', ''));
  v_address text := nullif(btrim(coalesce(p_profile->>'address', '')), '');
  v_country text := upper(nullif(btrim(coalesce(p_profile->>'country_code', '')), ''));
  v_postal text := nullif(btrim(coalesce(p_profile->>'postal_code', '')), '');
  v_dob date := nullif(p_profile->>'date_of_birth', '')::date;
  v_member_id uuid;
begin
  if p_profile->'terms_accepted' IS DISTINCT FROM 'true'::jsonb then
    raise exception 'MEMBERSHIP_TERMS_ACCEPTANCE_REQUIRED';
  end if;
  if p_profile->>'terms_version' IS DISTINCT FROM '2026-10-17.1'
     or p_profile->>'privacy_version' IS DISTINCT FROM '2026-10-17.1' then
    raise exception 'MEMBERSHIP_POLICY_VERSION_CHANGED';
  end if;
  if p_profile ? 'marketing_consent' and jsonb_typeof(p_profile->'marketing_consent') IS DISTINCT FROM 'boolean' then
    raise exception 'Invalid marketing consent choice.';
  end if;
  if v_uid is null or v_email is null or not exists (
    select 1 from auth.users u
     where u.id = v_uid
       and lower(u.email) = v_email
       and u.email_confirmed_at is not null
  ) then
    raise exception 'MEMBERSHIP_EMAIL_VERIFICATION_REQUIRED';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{5,14}$' then
    raise exception 'Enter a valid international mobile number.';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Enter a full name between 2 and 120 characters.';
  end if;
  if char_length(coalesce(v_address, '')) > 500 then raise exception 'Address is too long.'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'Select a valid country.'; end if;
  if char_length(coalesce(v_postal, '')) > 32 then raise exception 'Postal code is too long.'; end if;
  if v_dob > current_date or v_dob < current_date - interval '120 years' then
    raise exception 'Enter a valid date of birth.';
  end if;

  -- Serialize on the membership number before either claiming or inserting.
  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));
  v_member_id := public.membership_claim();
  if v_member_id is null then
    select id into v_member_id from public.members where auth_user_id = v_uid;
  end if;

  if v_member_id is null then
    insert into public.members (
      auth_user_id, member_code, full_name, email, phone, address, country_code,
      postal_code, date_of_birth, is_verified, verified_at, verified_channel
    ) values (
      v_uid, v_phone, v_name, v_email, v_phone, v_address, v_country, v_postal, v_dob,
      true, now(), 'email'
    ) returning id into v_member_id;
  else
    update public.members
       set member_code = v_phone,
           full_name = v_name,
           email = v_email,
           phone = v_phone,
           address = v_address,
           country_code = v_country,
           postal_code = v_postal,
           date_of_birth = v_dob,
           is_verified = true,
           verified_at = coalesce(verified_at, now()),
           verified_channel = 'email',
           updated_at = now()
     where id = v_member_id and auth_user_id = v_uid;
    if not found then raise exception 'MEMBERSHIP_ALREADY_CLAIMED'; end if;
  end if;

  INSERT INTO public.member_signup_consents(member_id, auth_user_id, terms_version, privacy_version, marketing_consent)
  VALUES (v_member_id, v_uid, '2026-10-17.1', '2026-10-17.1', coalesce((p_profile->>'marketing_consent')::boolean, false));
  return public.membership_profile_for(v_member_id);
exception
  when unique_violation then raise exception 'MEMBERSHIP_PHONE_ALREADY_REGISTERED';
end;
$fn$;

revoke all on function public.membership_portal_enroll_details(jsonb) from public, anon;
grant execute on function public.membership_portal_enroll_details(jsonb) to authenticated;

comment on function public.membership_portal_enroll_details(jsonb) is
  'Completes verified email enrollment with versioned terms/privacy acceptance and an optional marketing choice.';

COMMIT;
