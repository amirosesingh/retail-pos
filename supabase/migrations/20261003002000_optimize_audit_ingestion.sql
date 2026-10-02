-- Keep audit ingestion fast under offline catch-up batches. This migration
-- changes no audit rows: it removes duplicate RLS evaluations and replaces
-- the row-by-row sync-feed trigger with three set-based statement triggers.

alter table public.audit_logs
  add column if not exists store_id text;

drop policy if exists "Staff can append audit logs" on public.audit_logs;
drop policy if exists "Staff can read audit logs" on public.audit_logs;
drop policy if exists audit_logs_staff_insert on public.audit_logs;
drop policy if exists audit_logs_staff_read on public.audit_logs;

create policy audit_logs_staff_insert on public.audit_logs
  for insert to authenticated
  with check ((select public.is_staff_now()));

create policy audit_logs_staff_read on public.audit_logs
  for select to authenticated
  using ((select public.is_staff_now()));

drop trigger if exists sync_feed_change on public.audit_logs;
drop trigger if exists sync_feed_insert on public.audit_logs;
drop trigger if exists sync_feed_update on public.audit_logs;
drop trigger if exists sync_feed_delete on public.audit_logs;
drop function if exists public.sync_feed_audit_logs();

create or replace function public.sync_feed_audit_logs_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.sync_change_feed(
    organization_id, branch_id, terminal_id, table_name,
    entity_id, operation, row_version, tombstone
  )
  select 'default', coalesce(n.store_id, 'global'), null, 'audit_logs',
         jsonb_build_object('id', n.id)::text, 'insert', 1, false
  from new_audit_rows n;
  return null;
end;
$fn$;

create or replace function public.sync_feed_audit_logs_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.sync_change_feed(
    organization_id, branch_id, terminal_id, table_name,
    entity_id, operation, row_version, tombstone
  )
  select 'default', coalesce(n.store_id, 'global'), null, 'audit_logs',
         jsonb_build_object('id', n.id)::text, 'update', 1, false
  from new_audit_rows n;
  return null;
end;
$fn$;

create or replace function public.sync_feed_audit_logs_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.sync_change_feed(
    organization_id, branch_id, terminal_id, table_name,
    entity_id, operation, row_version, tombstone
  )
  select 'default', coalesce(o.store_id, 'global'), null, 'audit_logs',
         jsonb_build_object('id', o.id)::text, 'delete', 1, true
  from old_audit_rows o;
  return null;
end;
$fn$;

create trigger sync_feed_insert
after insert on public.audit_logs
referencing new table as new_audit_rows
for each statement execute function public.sync_feed_audit_logs_insert();

create trigger sync_feed_update
after update on public.audit_logs
referencing new table as new_audit_rows
for each statement execute function public.sync_feed_audit_logs_update();

create trigger sync_feed_delete
after delete on public.audit_logs
referencing old table as old_audit_rows
for each statement execute function public.sync_feed_audit_logs_delete();

revoke all on function public.sync_feed_audit_logs_insert() from public, anon, authenticated;
revoke all on function public.sync_feed_audit_logs_update() from public, anon, authenticated;
revoke all on function public.sync_feed_audit_logs_delete() from public, anon, authenticated;

notify pgrst, 'reload schema';
