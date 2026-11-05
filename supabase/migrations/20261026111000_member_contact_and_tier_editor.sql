-- Contact email is separate from verified membership identity.
BEGIN;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS contact_email text;
DO $check$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='members_contact_email_valid' AND conrelid='public.members'::regclass) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_contact_email_valid CHECK(contact_email IS NULL OR btrim(contact_email)='' OR (length(contact_email)<=254 AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));
  END IF;
END $check$;
DO $patch$
DECLARE definition text;
BEGIN
  IF to_regprocedure('public.sync_apply_members(jsonb)') IS NOT NULL THEN
    definition := pg_get_functiondef('public.sync_apply_members(jsonb)'::regprocedure);
    IF position('contact_email' in definition)=0 THEN
      definition := replace(definition,'phone, email, address','phone, email, contact_email, address');
      definition := replace(definition,'email = excluded.email,','email = excluded.email, contact_email = coalesce(excluded.contact_email, public.members.contact_email),');
      EXECUTE definition;
    END IF;
  END IF;
END;
$patch$;
CREATE OR REPLACE FUNCTION public.staff_membership_tier_save(p_name text,p_discount numeric DEFAULT 0,p_multiplier numeric DEFAULT 1,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE result public.membership_tiers; clean_name text:=btrim(p_name);
BEGIN
  IF NOT coalesce(public.is_staff_now(),false) OR NOT coalesce(public.has_perm('can_edit_member_points'),false) THEN RAISE EXCEPTION 'MEMBER_TIER_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
  IF clean_name IS NULL OR length(clean_name)<1 OR length(clean_name)>80 OR p_discount IS NULL OR p_discount<0 OR p_discount>100 OR p_discount::text IN ('NaN','Infinity','-Infinity') OR p_multiplier IS NULL OR p_multiplier<0 OR p_multiplier>100 OR p_multiplier::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid tier name, discount or points multiplier'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-tier:'||lower(clean_name),0));
  IF EXISTS(SELECT 1 FROM public.membership_tiers WHERE lower(btrim(name))=lower(clean_name) AND deleted_at IS NULL AND (p_id IS NULL OR id<>p_id)) THEN RAISE EXCEPTION 'A membership tier with this name already exists'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.membership_tiers(name,discount_percentage,points_multiplier) VALUES(clean_name,p_discount,p_multiplier) RETURNING * INTO result;
  ELSE
    UPDATE public.membership_tiers SET name=clean_name,discount_percentage=p_discount,points_multiplier=p_multiplier,updated_at=now() WHERE id=p_id AND deleted_at IS NULL RETURNING * INTO result;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership tier no longer exists'; END IF;
  END IF;
  RETURN to_jsonb(result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.staff_membership_tier_save(text,numeric,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_membership_tier_save(text,numeric,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
