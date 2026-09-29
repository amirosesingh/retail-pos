-- Browser background sync and Supabase Realtime both execute as the signed-in
-- `authenticated` role. RLS decides which rows that role may see, but RLS does
-- not replace the table-level SELECT grant Realtime needs while validating a
-- filtered subscription. Restore the least privilege required by those read
-- paths without opening any table to `anon`.

DO $repair$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    -- Browser delta probe.
    'products', 'members', 'membership_tiers', 'promotions', 'stores',
    'suppliers', 'bookings', 'stock_transfers', 'held_orders',
    -- postgres_changes listeners.
    'staff_roles', 'app_users', 'sales', 'sale_items',
    'payment_transactions', 'purchase_orders', 'authorization_requests',
    'activity_events'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      -- These tables all have scoped authenticated policies in the canonical
      -- schema. Keep RLS authoritative before restoring the table privilege.
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    END IF;
  END LOOP;
END
$repair$;

-- Keep the publication aligned with every postgres_changes listener created
-- by the UI. Existing members are skipped, so this is safe to rerun.
DO $realtime$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'staff_roles', 'stores', 'members', 'promotions', 'app_users', 'sales',
    'sale_items', 'payment_transactions', 'products', 'purchase_orders',
    'authorization_requests', 'activity_events'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', table_name);
      IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = table_name
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END
$realtime$;
