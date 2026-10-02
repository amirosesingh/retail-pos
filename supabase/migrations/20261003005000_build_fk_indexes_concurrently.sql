-- pg-delta: transaction=false
-- Build missing foreign-key indexes without blocking POS writes. This file
-- must remain non-transactional because PostgreSQL forbids CONCURRENTLY in a
-- transaction. Every statement is idempotent so a partial run can be retried.

-- A canceled concurrent build can leave an unusable index with the intended
-- name. Remove only those invalid remnants before retrying. PostgreSQL does
-- not allow DROP INDEX CONCURRENTLY inside a conditional block, so keep this
-- exceptional cleanup bounded: fail quickly instead of waiting on POS writes.
set lock_timeout = '2s';
do $recovery$
declare
  invalid_index text;
begin
  for invalid_index in
    select quote_ident(ns.nspname) || '.' || quote_ident(index_class.relname)
    from pg_catalog.pg_index index_state
    join pg_catalog.pg_class index_class on index_class.oid = index_state.indexrelid
    join pg_catalog.pg_namespace ns on ns.oid = index_class.relnamespace
    where ns.nspname = 'public'
      and not index_state.indisvalid
      and index_class.relname = any (array[
        'bookings_grip_product_id_idx',
        'bookings_string_source_product_id_idx',
        'coupon_events_member_id_idx',
        'members_tier_id_idx',
        'product_categories_parent_id_idx',
        'products_owner_store_id_idx',
        'shift_reconciliations_count_id_idx',
        'shift_variance_alerts_shift_id_idx'
      ])
  loop
    execute 'drop index if exists ' || invalid_index;
  end loop;
end
$recovery$;
reset lock_timeout;

create index concurrently if not exists bookings_grip_product_id_idx
  on public.bookings(grip_product_id);
create index concurrently if not exists bookings_string_source_product_id_idx
  on public.bookings(string_source_product_id);
create index concurrently if not exists coupon_events_member_id_idx
  on public.coupon_events(member_id);
create index concurrently if not exists members_tier_id_idx
  on public.members(tier_id);
create index concurrently if not exists product_categories_parent_id_idx
  on public.product_categories(parent_id);
create index concurrently if not exists products_owner_store_id_idx
  on public.products(owner_store_id);
create index concurrently if not exists shift_reconciliations_count_id_idx
  on public.shift_reconciliations(count_id);
create index concurrently if not exists shift_variance_alerts_shift_id_idx
  on public.shift_variance_alerts(shift_id);
