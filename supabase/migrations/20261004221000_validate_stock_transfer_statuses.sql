-- Validation uses SHARE UPDATE EXCLUSIVE rather than holding the brief
-- ADD-CONSTRAINT lock for the duration of a table scan.
ALTER TABLE public.stock_transfers
  VALIDATE CONSTRAINT stock_transfers_status_check;
