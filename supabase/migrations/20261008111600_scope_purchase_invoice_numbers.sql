-- Supplier invoice numbers are unique within their receiving branch.
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_number_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_store_po_number_key') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_store_po_number_key UNIQUE (store_id, po_number);
  END IF;
END $$;
