-- Apply to the dedicated membership project after the base membership schema.
-- Prefix name lookup is service-role-only and indexed for a large member list.

create index if not exists members_name_prefix_idx
  on public.members (lower(full_name) text_pattern_ops)
  where status = 'active';

create or replace function public.membership_lookup_for_pos(p_query text)
returns table (id uuid, member_code text, full_name text, loyalty_points numeric, tier_name text)
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_phone text := regexp_replace(coalesce(p_query, ''), '[^0-9+]', '', 'g');
  v_name_pattern text;
begin
  if auth.role() <> 'service_role' then raise exception 'MEMBERSHIP_SERVICE_REQUIRED'; end if;
  if char_length(v_query) < 2 then return; end if;
  v_name_pattern := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select m.id, m.member_code, m.full_name, m.loyalty_points, coalesce(t.name, 'Member')
    from public.members m
    left join public.membership_tiers t on t.id = m.tier_id
    where m.status = 'active' and (
      lower(m.member_code) = v_query or
      lower(coalesce(m.email, '')) = v_query or
      (v_phone <> '' and regexp_replace(coalesce(m.phone, ''), '[^0-9+]', '', 'g') = v_phone) or
      lower(m.full_name) like v_name_pattern escape '\'
    )
    order by
      case when lower(m.member_code) = v_query then 0
           when v_phone <> '' and regexp_replace(coalesce(m.phone, ''), '[^0-9+]', '', 'g') = v_phone then 1
           when lower(coalesce(m.email, '')) = v_query then 2
           else 3 end,
      lower(m.full_name), m.id
    limit 10;
end;
$fn$;

revoke all on function public.membership_lookup_for_pos(text) from public, anon, authenticated;
grant execute on function public.membership_lookup_for_pos(text) to service_role;
