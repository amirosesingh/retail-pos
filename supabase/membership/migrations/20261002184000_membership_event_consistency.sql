-- Apply only to the dedicated membership project.
-- Keep ledger rows and member aggregates on the same two-decimal values.

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

revoke all on function public.membership_ingest_pos_event(jsonb) from public, anon, authenticated;
grant execute on function public.membership_ingest_pos_event(jsonb) to service_role;
