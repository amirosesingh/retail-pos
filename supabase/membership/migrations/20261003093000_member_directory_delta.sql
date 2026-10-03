-- Minimal, service-role-only member directory for POS offline synchronization.
-- Authentication data and private profile fields never leave this project.

create sequence if not exists public.member_directory_revision_seq;

alter table public.members
  add column if not exists directory_revision bigint;

update public.members
set directory_revision = nextval('public.member_directory_revision_seq')
where directory_revision is null;

alter table public.members
  alter column directory_revision set default nextval('public.member_directory_revision_seq'),
  alter column directory_revision set not null;

create index if not exists members_directory_revision_idx
  on public.members (directory_revision);

create or replace function public.bump_member_directory_revision()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  -- Serialize allocation until transaction end. Revisions therefore become
  -- visible in commit order and a POS cursor can never skip an older commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-directory-revision', 0)
  );
  new.directory_revision := nextval('public.member_directory_revision_seq');
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists members_directory_revision on public.members;
create trigger members_directory_revision
before insert or update on public.members
for each row execute function public.bump_member_directory_revision();

create or replace function public.membership_directory_delta(
  p_after_revision bigint default 0,
  p_limit integer default 500
)
returns table (
  id uuid,
  member_code text,
  full_name text,
  phone text,
  tier_name text,
  loyalty_points numeric,
  total_spent numeric,
  is_verified boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  directory_revision bigint
)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.role() <> 'service_role' then raise exception 'MEMBERSHIP_SERVICE_REQUIRED'; end if;
  return query
    with page as (
      select m.*
      from public.members m
      where m.directory_revision > greatest(coalesce(p_after_revision, 0), 0)
      order by m.directory_revision, m.id
      limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    )
    select m.id, m.member_code, m.full_name, coalesce(m.phone, m.member_code),
           coalesce(t.name, 'Member'), m.loyalty_points, m.total_spent,
           m.is_verified, m.status, m.created_at, m.updated_at, m.directory_revision
    from page m
    left join public.membership_tiers t on t.id = m.tier_id
    order by m.directory_revision, m.id;
end;
$fn$;

revoke all on function public.bump_member_directory_revision() from public, anon, authenticated;
revoke all on function public.membership_directory_delta(bigint, integer) from public, anon, authenticated;
grant execute on function public.membership_directory_delta(bigint, integer) to service_role;

notify pgrst, 'reload schema';
