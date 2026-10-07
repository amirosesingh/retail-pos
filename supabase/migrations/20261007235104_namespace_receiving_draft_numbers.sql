-- Draft supplier invoice numbers are provisional. Give every existing draft
-- an internal unique key so multiple unfinished receipts can coexist without
-- reserving the final invoice number.
UPDATE public.purchase_orders
SET po_number = '__draft__:' || id::text || ':' || left(COALESCE(po_number, ''), 400)
WHERE status = 'draft'
  AND po_number NOT LIKE '__draft__:%';
