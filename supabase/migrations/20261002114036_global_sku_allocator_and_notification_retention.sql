-- One monotonically increasing SKU number space is shared by every cluster,
-- branch and terminal.  Terminals reserve durable ranges while online, then
-- consume those numbers locally when the connection drops.  A reserved number
-- is never returned to the pool, so merging clusters cannot create collisions.

create table if not exists public.sku_number_state (
  singleton boolean primary key default true check (singleton),
  next_value bigint not null check (next_value > 0),
  updated_at timestamptz not null default now()
);

alter table public.sku_number_state enable row level security;
revoke all on table public.sku_number_state from public, anon, authenticated;
grant all on table public.sku_number_state to service_role;

create table if not exists public.sku_number_leases (
  id uuid primary key default gen_random_uuid(),
  start_value bigint not null,
  end_value bigint not null check (end_value >= start_value),
  store_id text,
  terminal_id text,
  prefix text not null default 'SKU-',
  padding smallint not null default 6 check (padding between 1 and 12),
  reserved_by uuid,
  created_at timestamptz not null default now(),
  constraint sku_number_leases_range_unique unique (start_value, end_value)
);

create index if not exists sku_number_leases_store_created_idx
  on public.sku_number_leases (store_id, created_at desc);

alter table public.sku_number_leases enable row level security;
revoke all on table public.sku_number_leases from public, anon, authenticated;
grant all on table public.sku_number_leases to service_role;

insert into public.sku_number_state (singleton, next_value)
select true, greatest(
  1,
  coalesce(
    max((substring(sku from '([0-9]+)$'))::bigint) + 1,
    1
  )
)
from public.products
where coalesce(sku, '') ~ '[0-9]+$'
on conflict (singleton) do update
set next_value = greatest(public.sku_number_state.next_value, excluded.next_value),
    updated_at = now();

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
  v_service boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
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

-- Fallback for trusted import/sync paths that omit the SKU. Normal UI writes
-- use a lease so the assigned code is known before the product is displayed.
create schema if not exists private;
create or replace function private.assign_product_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_number bigint;
  v_explicit_number bigint;
begin
  if nullif(trim(coalesce(new.sku, '')), '') is not null then
    v_explicit_number := nullif(substring(new.sku from '([0-9]+)$'), '')::bigint;
    if v_explicit_number is not null then
      insert into public.sku_number_state (singleton, next_value)
      values (true, v_explicit_number + 1)
      on conflict (singleton) do update
        set next_value = greatest(public.sku_number_state.next_value, excluded.next_value),
            updated_at = now();
    end if;
    return new;
  end if;
  insert into public.sku_number_state (singleton, next_value)
  values (true, 1)
  on conflict (singleton) do nothing;
  select next_value into v_number
    from public.sku_number_state
   where singleton = true
   for update;
  update public.sku_number_state
     set next_value = v_number + 1,
         updated_at = now()
   where singleton = true;
  new.sku := 'SKU-' || lpad(v_number::text, 6, '0');
  return new;
end;
$function$;

revoke all on function private.assign_product_sku() from public, anon, authenticated;

drop trigger if exists products_aa_assign_global_sku on public.products;
create trigger products_aa_assign_global_sku
before insert on public.products
for each row execute function private.assign_product_sku();

comment on table public.sku_number_leases is
  'Durable, never-reused SKU ranges reserved for online and offline terminals across every cluster.';
comment on function public.reserve_product_skus(integer,text,text,text,integer) is
  'Atomically reserves globally unique SKU numbers after verifying the active staff identity and branch scope.';
