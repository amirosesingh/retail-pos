-- Minimal mirror metadata for the isolated membership project.
-- Additive only: no existing member or sale data is removed.

alter table public.members add column if not exists membership_revision bigint not null default 0;
alter table public.members add column if not exists membership_status text not null default 'active';
alter table public.members add column if not exists membership_member_id uuid;

create index if not exists members_membership_revision_idx
  on public.members (membership_revision);
create unique index if not exists members_membership_member_id_idx
  on public.members (membership_member_id) where membership_member_id is not null;

create or replace function public.membership_directory_apply(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $fn$
declare
  source record;
  v_target_id uuid;
  v_affected integer;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'MEMBERSHIP_SERVICE_REQUIRED'; end if;

  for source in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as incoming(
      id uuid, member_code text, full_name text, phone text, tier_name text,
      loyalty_points numeric, total_spent numeric, is_verified boolean, status text,
      created_at timestamptz, updated_at timestamptz, directory_revision bigint
    )
  loop
    -- The membership phone number is the public membership number. Serialize
    -- both stable identities so concurrent directory pages cannot create two
    -- POS rows for one customer.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-id:' || source.id::text, 0));
    if nullif(btrim(source.phone), '') is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:' || source.phone, 0));
    end if;

    select member.id into v_target_id
    from public.members member
    where member.membership_member_id = source.id
       or member.id = source.id
       or member.member_code = source.member_code
       or (nullif(btrim(source.phone), '') is not null and member.phone = source.phone)
    order by case
      when nullif(btrim(source.phone), '') is not null and member.phone = source.phone then 0
      when member.membership_member_id = source.id then 1
      when member.id = source.id then 2
      else 3 end,
      member.id
    limit 1
    for update;

    if v_target_id is null then
      insert into public.members (
        id, membership_member_id, member_code, full_name, phone, tier_id,
        loyalty_points, total_spent, created_at, updated_at, is_verified,
        deleted_at, membership_revision, membership_status
      ) values (
        source.id, source.id, source.member_code, source.full_name, source.phone,
        (select tier.id from public.membership_tiers tier where lower(tier.name) = lower(source.tier_name) limit 1),
        source.loyalty_points, source.total_spent, source.created_at, source.updated_at,
        source.is_verified, case when source.status = 'active' then null else source.updated_at end,
        source.directory_revision, source.status
      );
      get diagnostics v_affected = row_count;
    else
      -- If legacy POS data split the same customer over different identifiers,
      -- attach the external UUID to the phone-owned row without deleting or
      -- rewriting historical sale references.
      update public.members
      set membership_member_id = null
      where membership_member_id = source.id and id <> v_target_id;

      update public.members target set
        membership_member_id = source.id,
        member_code = case when not exists (
          select 1 from public.members other
          where other.id <> target.id and other.member_code = source.member_code
        ) then source.member_code else target.member_code end,
        full_name = source.full_name,
        phone = case when nullif(btrim(source.phone), '') is not null and not exists (
          select 1 from public.members other
          where other.id <> target.id and other.phone = source.phone
        ) then source.phone else target.phone end,
        tier_id = (select tier.id from public.membership_tiers tier where lower(tier.name) = lower(source.tier_name) limit 1),
        loyalty_points = source.loyalty_points,
        total_spent = source.total_spent,
        updated_at = source.updated_at,
        is_verified = source.is_verified,
        deleted_at = case when source.status = 'active' then null else source.updated_at end,
        membership_revision = source.directory_revision,
        membership_status = source.status
      where target.id = v_target_id
        and source.directory_revision > target.membership_revision;
      get diagnostics v_affected = row_count;
    end if;
    v_count := v_count + v_affected;
  end loop;

  return v_count;
end;
$fn$;

revoke all on function public.membership_directory_apply(jsonb) from public, anon, authenticated;
grant execute on function public.membership_directory_apply(jsonb) to service_role;

notify pgrst, 'reload schema';
