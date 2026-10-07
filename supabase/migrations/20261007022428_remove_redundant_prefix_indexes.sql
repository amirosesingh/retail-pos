-- Each removed index is an unused, non-unique left-prefix duplicate of the
-- retained index named beside it. The retained btree serves the same equality
-- and join probes while also supporting the longer ordering/filter shape.
DROP INDEX IF EXISTS public.bookings_store_idx; -- bookings_store_status_created_idx
DROP INDEX IF EXISTS public.issued_vouchers_campaign_idx; -- issued_vouchers_campaign_member_idx
DROP INDEX IF EXISTS public.item_activity_logs_product_id_idx; -- item_activity_logs_product_idx
DROP INDEX IF EXISTS public.item_activity_logs_store_id_idx; -- item_activity_logs_store_idx
DROP INDEX IF EXISTS public.payment_transactions_store_id_idx; -- payment_transactions_store_idx
DROP INDEX IF EXISTS public.purchase_orders_store_idx; -- idx_purchase_orders_store_entry
DROP INDEX IF EXISTS public.purchase_orders_store_status_idx; -- purchase_orders_store_status_created_idx
DROP INDEX IF EXISTS public.sales_shift_idx; -- sales_shift_created_idx
DROP INDEX IF EXISTS public.sales_store_idx; -- sales_store_created_idx
DROP INDEX IF EXISTS public.stock_transfers_to_idx; -- stock_transfers_to_status_idx
