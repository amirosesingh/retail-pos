-- Membership-only Supabase project schema.
-- Apply to the dedicated membership project, never to the POS project.

create extension if not exists pgcrypto;

create table if not exists public.membership_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  minimum_spend numeric(14,2) not null default 0 check (minimum_spend >= 0),
  discount_percentage numeric(7,4) not null default 0
    check (discount_percentage between 0 and 100),
  points_multiplier numeric(9,4) not null default 1 check (points_multiplier >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  member_code text not null unique,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text,
  phone text,
  address text check (address is null or char_length(address) <= 500),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or char_length(postal_code) <= 32),
  date_of_birth date check (
    date_of_birth is null or
    (date_of_birth <= current_date and date_of_birth >= current_date - interval '120 years')
  ),
  tier_id uuid references public.membership_tiers(id) on delete set null,
  loyalty_points numeric(14,2) not null default 0,
  total_spent numeric(14,2) not null default 0,
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_channel text check (verified_channel is null or verified_channel in ('email', 'sms')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists members_email_uidx
  on public.members (lower(btrim(email)))
  where email is not null and btrim(email) <> '' and status <> 'closed';
create unique index if not exists members_phone_uidx
  on public.members (regexp_replace(phone, '[^0-9+]', '', 'g'))
  where phone is not null and btrim(phone) <> '' and status <> 'closed';
create index if not exists members_tier_idx on public.members (tier_id);

create table if not exists public.membership_events (
  event_id text primary key,
  member_id uuid not null references public.members(id) on delete restrict,
  event_type text not null check (event_type in ('sale', 'return', 'void', 'correction')),
  pos_sale_id uuid,
  bill_number text not null,
  store_id text,
  store_name text,
  amount_delta numeric(14,2) not null,
  points_delta numeric(14,2) not null,
  source_revision integer not null default 1 check (source_revision > 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists membership_events_member_time_idx
  on public.membership_events (member_id, occurred_at desc, event_id desc);
create index if not exists membership_events_sale_idx
  on public.membership_events (pos_sale_id) where pos_sale_id is not null;

alter table public.membership_tiers enable row level security;
alter table public.members enable row level security;
alter table public.membership_events enable row level security;

revoke all on table public.membership_tiers from public, anon, authenticated;
revoke all on table public.members from public, anon, authenticated;
revoke all on table public.membership_events from public, anon, authenticated;
grant all on table public.membership_tiers to service_role;
grant all on table public.members to service_role;
grant all on table public.membership_events to service_role;

create or replace function public.membership_profile_for(p_member_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
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
  from public.members m
  left join public.membership_tiers t on t.id = m.tier_id and t.is_active
  where m.id = p_member_id and m.status = 'active';
$fn$;

create or replace function public.membership_claim()
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(btrim(coalesce(auth.jwt()->>'email', '')), ''));
  v_phone text := regexp_replace(coalesce(auth.jwt()->>'phone', ''), '[^0-9+]', '', 'g');
  v_member_id uuid;
  v_matches integer;
begin
  if v_uid is null then raise exception 'MEMBERSHIP_AUTH_REQUIRED'; end if;

  select id into v_member_id from public.members
   where auth_user_id = v_uid and status = 'active' limit 1;
  if v_member_id is not null then return v_member_id; end if;
  if v_email is null and v_phone = '' then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(coalesce(v_email, '') || ':' || v_phone, 0));
  select count(*), (array_agg(id order by id))[1]
    into v_matches, v_member_id
    from public.members
   where status = 'active' and (
     (v_email is not null and lower(btrim(coalesce(email, ''))) = v_email) or
     (v_phone <> '' and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone)
   );
  if v_matches = 0 then return null; end if;
  if v_matches > 1 then raise exception 'MEMBERSHIP_CONTACT_AMBIGUOUS'; end if;

  update public.members
     set auth_user_id = v_uid, is_verified = true,
         verified_at = coalesce(verified_at, now()),
         verified_channel = coalesce(verified_channel, case when v_phone <> '' then 'sms' else 'email' end),
         updated_at = now()
   where id = v_member_id and auth_user_id is null;
  if not found then raise exception 'MEMBERSHIP_ALREADY_CLAIMED'; end if;
  return v_member_id;
end;
$fn$;

create or replace function public.membership_portal_profile()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_member_id uuid;
begin
  v_member_id := public.membership_claim();
  if v_member_id is null then return null; end if;
  return public.membership_profile_for(v_member_id);
end;
$fn$;

create or replace function public.membership_portal_enroll_details(p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(btrim(coalesce(auth.jwt()->>'email', '')), ''));
  v_phone text := nullif(regexp_replace(coalesce(auth.jwt()->>'phone', ''), '[^0-9+]', '', 'g'), '');
  v_name text := btrim(coalesce(p_profile->>'full_name', ''));
  v_country text := upper(nullif(btrim(coalesce(p_profile->>'country_code', '')), ''));
  v_postal text := nullif(btrim(coalesce(p_profile->>'postal_code', '')), '');
  v_dob date := nullif(p_profile->>'date_of_birth', '')::date;
  v_member_id uuid;
begin
  if v_uid is null or v_phone is null then raise exception 'MEMBERSHIP_PHONE_VERIFICATION_REQUIRED'; end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Enter a full name between 2 and 120 characters.';
  end if;
  if char_length(coalesce(p_profile->>'address', '')) > 500 then raise exception 'Address is too long.'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'Select a valid country.'; end if;
  if char_length(coalesce(v_postal, '')) > 32 then raise exception 'Postal code is too long.'; end if;
  if v_dob > current_date or v_dob < current_date - interval '120 years' then
    raise exception 'Enter a valid date of birth.';
  end if;

  v_member_id := public.membership_claim();
  if v_member_id is not null then return public.membership_profile_for(v_member_id); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select id into v_member_id from public.members where auth_user_id = v_uid;
  if v_member_id is null then
    insert into public.members (
      auth_user_id, member_code, full_name, email, phone, address, country_code,
      postal_code, date_of_birth, is_verified, verified_at, verified_channel
    ) values (
      v_uid, v_phone, v_name, v_email, v_phone,
      nullif(btrim(coalesce(p_profile->>'address', '')), ''), v_country, v_postal, v_dob,
      true, now(), 'sms'
    ) returning id into v_member_id;
  end if;
  return public.membership_profile_for(v_member_id);
end;
$fn$;

create or replace function public.membership_portal_update_details(p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_name text := btrim(coalesce(p_profile->>'full_name', ''));
  v_country text := upper(nullif(btrim(coalesce(p_profile->>'country_code', '')), ''));
  v_postal text := nullif(btrim(coalesce(p_profile->>'postal_code', '')), '');
  v_dob date := nullif(p_profile->>'date_of_birth', '')::date;
begin
  if v_uid is null then raise exception 'MEMBERSHIP_AUTH_REQUIRED'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'Enter a full name between 2 and 120 characters.'; end if;
  if char_length(coalesce(p_profile->>'address', '')) > 500 then raise exception 'Address is too long.'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'Select a valid country.'; end if;
  if char_length(coalesce(v_postal, '')) > 32 then raise exception 'Postal code is too long.'; end if;
  if v_dob > current_date or v_dob < current_date - interval '120 years' then raise exception 'Enter a valid date of birth.'; end if;

  update public.members set
    full_name = v_name,
    address = nullif(btrim(coalesce(p_profile->>'address', '')), ''),
    country_code = v_country, postal_code = v_postal, date_of_birth = v_dob,
    updated_at = now()
  where auth_user_id = v_uid and status = 'active'
  returning id into v_member_id;
  if v_member_id is null then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  return public.membership_profile_for(v_member_id);
end;
$fn$;

create or replace function public.membership_portal_sales(p_limit integer default 25)
returns setof jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'id', e.event_id, 'bill_number', e.bill_number,
    'store_name', coalesce(e.store_name, e.store_id, ''),
    'total', e.amount_delta, 'discount', coalesce((e.metadata->>'discount')::numeric, 0),
    'points_earned', greatest(e.points_delta, 0),
    'points_redeemed', greatest(-e.points_delta, 0),
    'refunded', e.event_type in ('return', 'void'),
    'created_at', e.occurred_at, 'items', e.items
  )
  from public.membership_events e
  join public.members m on m.id = e.member_id
  where auth.uid() is not null and m.auth_user_id = auth.uid() and m.status = 'active'
  order by e.occurred_at desc, e.event_id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$fn$;

create or replace function public.membership_lookup_for_pos(p_query text)
returns table (id uuid, member_code text, full_name text, loyalty_points numeric, tier_name text)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.role() <> 'service_role' then raise exception 'MEMBERSHIP_SERVICE_REQUIRED'; end if;
  return query
    select m.id, m.member_code, m.full_name, m.loyalty_points, coalesce(t.name, 'Member')
    from public.members m left join public.membership_tiers t on t.id = m.tier_id
    where m.status = 'active' and (
      lower(m.member_code) = lower(btrim(p_query)) or
      lower(coalesce(m.email, '')) = lower(btrim(p_query)) or
      regexp_replace(coalesce(m.phone, ''), '[^0-9+]', '', 'g') = regexp_replace(p_query, '[^0-9+]', '', 'g')
    ) limit 10;
end;
$fn$;

create or replace function public.membership_ingest_pos_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_event_id text := nullif(btrim(p_event->>'event_id'), '');
  v_member_id uuid := nullif(p_event->>'member_id', '')::uuid;
  v_type text := p_event->>'event_type';
  v_amount numeric := round(coalesce((p_event->>'amount_delta')::numeric, 0), 2);
  v_points numeric := round(coalesce((p_event->>'points_delta')::numeric, 0), 2);
  v_inserted boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'MEMBERSHIP_SERVICE_REQUIRED'; end if;
  if v_event_id is null or v_member_id is null or v_type not in ('sale','return','void','correction') then
    raise exception 'INVALID_MEMBERSHIP_EVENT';
  end if;
  if not exists (select 1 from public.members where id = v_member_id and status = 'active') then
    raise exception 'MEMBERSHIP_NOT_FOUND';
  end if;

  insert into public.membership_events (
    event_id, member_id, event_type, pos_sale_id, bill_number, store_id, store_name,
    amount_delta, points_delta, source_revision, items, occurred_at, metadata
  ) values (
    v_event_id, v_member_id, v_type, nullif(p_event->>'pos_sale_id','')::uuid,
    coalesce(nullif(p_event->>'bill_number',''), 'UNKNOWN'), p_event->>'store_id', p_event->>'store_name',
    v_amount, v_points, greatest(coalesce((p_event->>'source_revision')::integer, 1), 1),
    coalesce(p_event->'items', '[]'::jsonb),
    coalesce(nullif(p_event->>'occurred_at','')::timestamptz, now()),
    coalesce(p_event->'metadata', '{}'::jsonb)
  ) on conflict (event_id) do nothing;
  v_inserted := found;

  if v_inserted then
    update public.members set
      total_spent = greatest(total_spent + v_amount, 0),
      loyalty_points = greatest(loyalty_points + v_points, 0),
      updated_at = now()
    where id = v_member_id;
  end if;
  return jsonb_build_object('accepted', true, 'duplicate', not v_inserted, 'event_id', v_event_id);
end;
$fn$;

revoke all on function public.membership_profile_for(uuid) from public, anon, authenticated;
revoke all on function public.membership_claim() from public, anon, authenticated;
revoke all on function public.membership_portal_profile() from public, anon;
revoke all on function public.membership_portal_enroll_details(jsonb) from public, anon;
revoke all on function public.membership_portal_update_details(jsonb) from public, anon;
revoke all on function public.membership_portal_sales(integer) from public, anon;
revoke all on function public.membership_lookup_for_pos(text) from public, anon, authenticated;
revoke all on function public.membership_ingest_pos_event(jsonb) from public, anon, authenticated;

grant execute on function public.membership_portal_profile() to authenticated;
grant execute on function public.membership_portal_enroll_details(jsonb) to authenticated;
grant execute on function public.membership_portal_update_details(jsonb) to authenticated;
grant execute on function public.membership_portal_sales(integer) to authenticated;
grant execute on function public.membership_lookup_for_pos(text) to service_role;
grant execute on function public.membership_ingest_pos_event(jsonb) to service_role;

insert into public.membership_tiers (code, name, minimum_spend, discount_percentage, points_multiplier)
values ('member', 'Member', 0, 0, 1)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
