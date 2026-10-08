-- Realtime hints wake the existing scoped read/sync path. Keep RLS and grants unchanged.
DO $migration$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'product_categories','uom_units','suppliers','stock_count_drafts',
      'stock_adjustments','stock_transfers','bookings'
    ] LOOP
      IF to_regclass(format('public.%I',table_name)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_publication_tables p
          WHERE p.pubname='supabase_realtime' AND p.schemaname='public' AND p.tablename=table_name)
      THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',table_name);
      END IF;
    END LOOP;
  END IF;
END;
$migration$;
