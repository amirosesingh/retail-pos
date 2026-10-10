-- Only temporary, completed holds are removed. Receipts, sold items and tenders remain.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.completed_hold_tombstones (
  held_id text PRIMARY KEY,
  store_id text NOT NULL,
  bill_no text NOT NULL,
  sale_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.completed_hold_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.completed_hold_tombstones FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS completed_hold_tombstones_bill_idx
  ON private.completed_hold_tombstones(store_id,bill_no);

-- A delayed upload is acknowledged without recreating the temporary record.
-- Re-emit its deletion so a terminal that previously deferred a tombstone
-- while it had pending writes receives the deletion again after acknowledgement.
CREATE OR REPLACE FUNCTION private.prevent_cleaned_hold_replay()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE marker private.completed_hold_tombstones%ROWTYPE;
BEGIN
  SELECT * INTO marker FROM private.completed_hold_tombstones t
  WHERE t.held_id=NEW.id OR (t.store_id=NEW.store_id AND t.bill_no=NEW.bill_no)
  LIMIT 1;
  IF FOUND THEN
    IF marker.store_id IS DISTINCT FROM NEW.store_id THEN
      RAISE EXCEPTION 'This retired bill belongs to a different branch.';
    END IF;
    INSERT INTO public.sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone)
    VALUES('default',marker.store_id,'held_orders',jsonb_build_object('id',NEW.id)::text,'delete',COALESCE(NEW.row_version,1),true);
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.prevent_cleaned_hold_replay() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS held_orders_a_cleanup_tombstone ON public.held_orders;
CREATE TRIGGER held_orders_a_cleanup_tombstone BEFORE INSERT OR UPDATE ON public.held_orders
FOR EACH ROW EXECUTE FUNCTION private.prevent_cleaned_hold_replay();

CREATE OR REPLACE FUNCTION private.cleanup_completed_holds()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE ticket record; removed integer:=0;
BEGIN
  -- Serialize cron/manual overlap. Each execution is bounded and resumable.
  IF NOT pg_try_advisory_xact_lock(17380411,1) THEN RETURN 0; END IF;
  FOR ticket IN
    SELECT h.id,h.store_id,h.bill_no,s.id AS sale_id
    FROM public.held_orders h
    JOIN public.sales s ON s.store_id=h.store_id AND s.bill_number=h.bill_no
    WHERE h.status='completed' AND h.updated_at < now()-interval '24 hours'
      AND jsonb_typeof(h.lines)='array'
      AND jsonb_array_length(CASE WHEN jsonb_typeof(h.lines)='array' THEN h.lines ELSE '[]'::jsonb END)>0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.lines)='array' THEN h.lines ELSE '[]'::jsonb END) line
        WHERE jsonb_typeof(line->'qty') IS DISTINCT FROM 'number')
      -- Header-only or partially uploaded item graphs must stay recoverable.
      AND (SELECT count(*) FROM public.sale_items i WHERE i.sale_id=s.id)>=jsonb_array_length(h.lines)
      AND NOT EXISTS (
        SELECT lower(NULLIF(line->>'productId','')) AS product_id,
               COALESCE(line->>'variantCode','') AS variant,
               SUM(CASE WHEN jsonb_typeof(line->'qty')='number' THEN (line->>'qty')::numeric END) AS qty
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.lines)='array' THEN h.lines ELSE '[]'::jsonb END) line GROUP BY 1,2
        EXCEPT
        SELECT lower(i.product_id::text),COALESCE(i.variant_code,''),SUM(i.quantity)::numeric
        FROM public.sale_items i WHERE i.sale_id=s.id GROUP BY 1,2
      )
      -- Zero-value exchanges can legitimately have no payment row.
      AND (GREATEST(s.paid_amount,s.total_amount)=0 OR (
        (SELECT COALESCE(SUM(p.amount),0) FROM public.payment_transactions p
          WHERE p.sale_id=s.id AND p.store_id=s.store_id AND p.source_type='sale'
            AND p.status='completed' AND p.kind IN ('payment','settlement')) >= GREATEST(s.paid_amount,s.total_amount)
        AND (SELECT count(*) FROM public.payment_transactions p
          WHERE p.sale_id=s.id AND p.store_id=s.store_id AND p.source_type='sale'
            AND p.status='completed' AND p.kind IN ('payment','settlement')) >= GREATEST(1,
          (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.payments)='array' THEN s.payments ELSE '[]'::jsonb END) tender
           WHERE COALESCE((tender->>'amount')::numeric,0)<>0))
      ))
    ORDER BY h.updated_at,h.id LIMIT 500 FOR UPDATE OF h SKIP LOCKED
  LOOP
    INSERT INTO private.completed_hold_tombstones(held_id,store_id,bill_no,sale_id)
    VALUES(ticket.id,ticket.store_id,ticket.bill_no,ticket.sale_id) ON CONFLICT(held_id) DO NOTHING;
    -- Existing sync_feed_change emits the deletion to this branch's terminals.
    DELETE FROM public.held_orders WHERE id=ticket.id AND status='completed';
    removed:=removed+1;
  END LOOP;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION private.cleanup_completed_holds() FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS held_orders_completed_cleanup_idx ON public.held_orders(updated_at,id)
  WHERE status='completed';

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('pos-completed-hold-cleanup','17 * * * *','SELECT private.cleanup_completed_holds();');
