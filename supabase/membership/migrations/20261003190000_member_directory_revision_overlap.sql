-- Sequence values are assigned before commit. A later revision may therefore
-- become visible before an earlier one. Replaying a bounded overlap prevents a
-- late commit from being skipped; the POS mirror applies only newer revisions.

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
    with bounds as (
      select greatest(coalesce(p_after_revision, 0), 0) as cursor_revision,
             least(greatest(coalesce(p_limit, 500), 1), 1000) as page_limit,
             64::bigint as overlap
    ), page as (
      (select m.* from public.members m, bounds b
       where m.directory_revision <= b.cursor_revision
         and m.directory_revision > greatest(b.cursor_revision - b.overlap, 0)
       order by m.directory_revision desc, m.id
       limit 64)
      union all
      (select m.* from public.members m, bounds b
       where m.directory_revision > b.cursor_revision
       order by m.directory_revision, m.id
       limit (select page_limit from bounds))
    )
    select m.id, m.member_code, m.full_name, coalesce(m.phone, m.member_code),
           coalesce(t.name, 'Member'), m.loyalty_points, m.total_spent,
           m.is_verified, m.status, m.created_at, m.updated_at, m.directory_revision
    from page m
    left join public.membership_tiers t on t.id = m.tier_id
    order by m.directory_revision, m.id;
end;
$fn$;

revoke all on function public.membership_directory_delta(bigint, integer) from public, anon, authenticated;
grant execute on function public.membership_directory_delta(bigint, integer) to service_role;

notify pgrst, 'reload schema';
