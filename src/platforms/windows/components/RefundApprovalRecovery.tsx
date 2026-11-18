import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { localDb, type PendingRefundApproval } from "@/core/local-db/local-db";
import type { Sale } from "@/core/types/pos-types";
import { useAuth } from "@/lib/pos-auth";
import { useManagerGate } from "@/lib/manager-gate";
import { pendingRefundApproval, recoverRefundApproval, refundApprovalAmount } from "@/lib/refund-approval-recovery-client";
import { sessionEpoch } from "@/lib/session-epoch";
import { notifyError } from "@/lib/notify";

/** Recover an already saved operation through the existing approval dialog. */
export function RefundApprovalRecovery({ sale, branchId }: { sale: Sale | null; branchId: string }) {
  const { can, user } = useAuth();
  const { authorize } = useManagerGate();
  const [pending, setPending] = useState<PendingRefundApproval | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0), active = useRef(false), working = useRef(false);
  const context = `${branchId}:${sale?.id ?? ""}:${user?.staffId ?? ""}:${sessionEpoch()}`;
  const current = useRef(context); current.current = context;
  const invalidate = useCallback(() => { active.current = false; request.current++; }, []);
  const available = Boolean(sale?.refunded && can("can_process_refund") && localDb()?.getRefundApprovalStatus);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    if (!sale?.refunded || !available) { setPending(null); setError(""); return; }
    const started = context;
    try {
      const result = await pendingRefundApproval(sale.id, branchId);
      if (!active.current || sequence !== request.current || current.current !== started) return;
      setPending(result); setError("");
    } catch {
      if (active.current && sequence === request.current && current.current === started)
        setError("The saved refund upload status could not be checked. Its local records remain intact.");
    }
  }, [available, branchId, context, sale?.id, sale?.refunded]);

  useEffect(() => {
    active.current = true;
    setPending(null); setError("");
    void refresh();
    return invalidate;
  }, [refresh, invalidate]);

  const operationId = pending?.operationId;
  useEffect(() => {
    if (!operationId) return;
    // Only monitor a receipt that actually has retained work. Empty receipts
    // don't add another idle poll or sync worker.
    return localDb()?.sync?.subscribe?.(() => { void refresh(); });
  }, [operationId, refresh]);

  async function finishApproval() {
    if (!pending || !sale || working.current || !available) return;
    working.current = true; setBusy(true);
    const started = context;
    try {
      const grant = await authorize({ action: "refund", title: "Approve saved refund synchronization",
        reason: "Recover approval for a refund already saved on this terminal.", storeId: pending.branchId,
        requestedBy: user?.staffId ?? user?.name ?? null, requestedAmount: refundApprovalAmount(pending), valueUnit: "currency",
        refundRecoveryOperationId: pending.operationId,
        payload: { sale_id: pending.saleId, receipt_no: pending.receiptNo ?? sale.receiptNo, total: refundApprovalAmount(pending) } });
      if (!active.current || current.current !== started || !grant.ok) return;
      await recoverRefundApproval(pending, grant.grantToken);
      if (!active.current || current.current !== started) return;
      toast.success("Approval saved. Refund synchronization will retry.");
      await refresh();
    } catch (failure) {
      if (active.current && current.current === started) notifyError(failure, "Recovering saved refund approval");
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!available || !pending && !error) return null;
  return <section className="space-y-2 rounded-md border p-3 text-sm" aria-label="Saved refund synchronization">
    {error ? <>
      <p role="alert">{error}</p>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>Retry refund status</Button>
    </> : <>
      <p role="status">{pending?.requiresApproval
        ? "This refund is already saved locally and needs approval to finish synchronization."
        : "This refund is saved locally and is waiting for central acknowledgement."}</p>
      {pending?.requiresApproval && <Button type="button" variant="outline" disabled={busy} onClick={() => void finishApproval()}>
        {busy ? "Checking approval…" : "Finish refund synchronization"}
      </Button>}
    </>}
  </section>;
}
