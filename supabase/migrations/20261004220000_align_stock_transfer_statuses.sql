-- The application lifecycle moved beyond the legacy pending/in_transit names,
-- but the original table constraint was never widened. Keep legacy spellings
-- readable during rolling upgrades while accepting every current state.
ALTER TABLE public.stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_check;

ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_status_check CHECK (
    status IN (
      'draft',
      'pending',
      'awaiting_approval',
      'approved',
      'in_transit',
      'dispatched',
      'received',
      'verified',
      'completed',
      'completed_with_discrepancy',
      'rejected',
      'cancelled'
    )
  );
