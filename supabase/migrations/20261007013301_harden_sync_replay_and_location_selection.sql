-- A network retry can overlap the original request after central committed the
-- business rows but before its acknowledgement reached the till. The receipt
-- primary key prevents duplicated committed data, but without serialization
-- both transactions can do the work and the loser reports a noisy 23505.
-- Serialize only equal batch ids; unrelated branches and batches still run in
-- parallel. Transaction advisory locks are released automatically on commit or
-- rollback, including when a worker disconnects.
DO $migration$
DECLARE
  signature_name text;
  signature regprocedure;
  definition text;
  updated text;
BEGIN
  FOREACH signature_name IN ARRAY ARRAY[
    'public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)',
    'public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)',
    'public.pos_sync_push_aggregate(uuid,text,text,jsonb)',
    'public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'
  ]
  LOOP
    signature := to_regprocedure(signature_name);
    CONTINUE WHEN signature IS NULL;

    SELECT replace(pg_get_functiondef(signature), E'\r\n', E'\n') INTO definition;
    CONTINUE WHEN position('pos-sync-batch:' in definition) > 0;

    updated := replace(
      definition,
      E'\nBEGIN\n',
      E'\nBEGIN\n PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''pos-sync-batch:'' || p_batch_id::text, 0));\n'
    );
    IF updated = definition THEN
      RAISE EXCEPTION 'Could not install the batch replay lock in %', signature;
    END IF;
    EXECUTE updated;
  END LOOP;
END
$migration$;

-- Keep the privileged sync boundary unchanged after replacing the functions.
DO $grants$
BEGIN
  IF to_regprocedure('public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
      TO service_role;
  END IF;
  IF to_regprocedure('public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)
      TO service_role;
  END IF;
  IF to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)
      TO service_role;
  END IF;
  IF to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
      TO service_role;
  END IF;
END
$grants$;

NOTIFY pgrst, 'reload schema';
