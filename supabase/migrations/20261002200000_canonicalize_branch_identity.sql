-- UUID text is case-insensitive as an identity, but JSON object keys and the
-- browser are not. Legacy terminals created upper/lower-case copies of the
-- same branch bucket. Merge those buckets by addition so no stock units are
-- discarded, and canonicalize new writes before lifecycle logic runs.

create or replace function public.canonical_stock_by_store(_stock jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select coalesce(jsonb_object_agg(grouped.branch_id, to_jsonb(grouped.quantity)), '{}'::jsonb)
  from (
    select
      case
        when entry.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then lower(entry.key)
        else btrim(entry.key)
      end as branch_id,
      sum(case when jsonb_typeof(entry.value) = 'number' then (entry.value #>> '{}')::numeric else 0 end) as quantity
    from jsonb_each(coalesce(_stock, '{}'::jsonb)) as entry
    where btrim(entry.key) <> ''
    group by 1
  ) grouped;
$function$;

revoke all on function public.canonical_stock_by_store(jsonb) from public, anon, authenticated;
grant execute on function public.canonical_stock_by_store(jsonb) to service_role;

create or replace function public.products_canonicalize_branch_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.stock_by_store := public.canonical_stock_by_store(new.stock_by_store);
  select coalesce(sum(case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric else 0 end), 0)
    into new.stock_quantity
    from jsonb_each(new.stock_by_store);
  if new.owner_store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.owner_store_id := lower(new.owner_store_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.products_canonicalize_branch_identity() from public, anon, authenticated;

drop trigger if exists products_ab_canonical_branch_identity on public.products;
create trigger products_ab_canonical_branch_identity
before insert or update of stock_by_store, owner_store_id on public.products
for each row execute function public.products_canonicalize_branch_identity();

update public.products
set stock_by_store = public.canonical_stock_by_store(stock_by_store)
where stock_by_store is distinct from public.canonical_stock_by_store(stock_by_store);

create or replace function public.sales_canonicalize_branch_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.store_id := lower(new.store_id);
  end if;
  if new.branch_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.branch_id := lower(new.branch_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.sales_canonicalize_branch_identity() from public, anon, authenticated;

drop trigger if exists sales_ab_canonical_branch_identity on public.sales;
create trigger sales_ab_canonical_branch_identity
before insert or update of store_id, branch_id on public.sales
for each row execute function public.sales_canonicalize_branch_identity();

update public.sales
set
  store_id = case
    when store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then lower(store_id)
    else store_id
  end,
  branch_id = case
    when branch_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then lower(branch_id)
    else branch_id
  end
where
  store_id is distinct from case
    when store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then lower(store_id)
    else store_id
  end
  or branch_id is distinct from case
    when branch_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then lower(branch_id)
    else branch_id
  end;
