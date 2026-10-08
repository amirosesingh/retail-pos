-- The lifecycle function existed on earlier projects but was not attached to
-- the table. Attach it so direct writes and synchronization cannot bypass the
-- same transition and approval rules enforced by the public RPCs.
DROP TRIGGER IF EXISTS stock_transfers_enforce_lifecycle ON public.stock_transfers;
CREATE TRIGGER stock_transfers_enforce_lifecycle
BEFORE INSERT OR UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.stock_transfers_enforce_lifecycle();

NOTIFY pgrst, 'reload schema';
