-- PostgREST 14 stores JWT claims in request.jwt.claims.  Reading only the
-- legacy request.jwt.claim.role setting misclassified opaque sb_secret keys
-- as ordinary staff and made server-side SKU reservation fail with
-- STAFF_AUTH_REQUIRED.  auth.role() supports both claim layouts.
create or replace function public.reserve_product_skus(
  p_count integer default 250,
  p_store_id text default null,
  p_terminal_id text default null,
  p_prefix text default 'SKU-',
  p_padding integer default 6
)
returns table (
  lease_id uuid,
  start_value bigint,
  end_value bigint,
  prefix text,
  padding integer,
  reserved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff public.app_users%rowtype;
  v_start bigint;
  v_end bigint;
  v_lease uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_service boolean := coalesce((SELECT auth.role()), '') = 'service_role';
begin
  if p_count < 1 or p_count > 5000 then
    raise exception 'SKU_LEASE_SIZE_INVALID';
  end if;
  if p_padding < 1 or p_padding > 12 then
    raise exception 'SKU_PADDING_INVALID';
  end if;
  if length(coalesce(p_prefix, '')) > 32 then
    raise exception 'SKU_PREFIX_INVALID';
  end if;

  if not v_service then
    select * into v_staff
      from public.app_users
     where auth_user_id = (select auth.uid())
       and is_active
     limit 1;
    if v_staff.id is null then
      raise exception 'STAFF_AUTH_REQUIRED';
    end if;
    if v_staff.role::text <> 'admin'
       and coalesce((v_staff.permissions ->> 'can_add_new_product')::boolean, false) is not true then
      raise exception 'SKU_RESERVATION_FORBIDDEN';
    end if;
    if v_staff.role::text <> 'admin'
       and nullif(v_staff.store_id, '') is distinct from nullif(p_store_id, '') then
      raise exception 'SKU_STORE_SCOPE_FORBIDDEN';
    end if;
  end if;

  insert into public.sku_number_state (singleton, next_value)
  values (true, 1)
  on conflict (singleton) do nothing;

  select state.next_value into v_start
    from public.sku_number_state state
   where state.singleton = true
   for update;
  v_end := v_start + p_count - 1;

  update public.sku_number_state
     set next_value = v_end + 1,
         updated_at = v_now
   where singleton = true;

  insert into public.sku_number_leases (
    id, start_value, end_value, store_id, terminal_id, prefix, padding, reserved_by, created_at
  ) values (
    v_lease, v_start, v_end, nullif(trim(p_store_id), ''), nullif(trim(p_terminal_id), ''),
    coalesce(p_prefix, ''), p_padding, (select auth.uid()), v_now
  );

  return query select v_lease, v_start, v_end, coalesce(p_prefix, ''), p_padding, v_now;
end;
$function$;

revoke all on function public.reserve_product_skus(integer,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_product_skus(integer,text,text,text,integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
