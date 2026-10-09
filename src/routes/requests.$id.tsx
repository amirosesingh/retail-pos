import { sameBranchId } from "@/lib/branch-id";
/**
 * One stock request, in full.
 *
 * The request keeps its original quantities forever: this page reads them
 * back alongside what was approved and what was actually sent, so a request
 * for eight that shipped five reads "requested 8 · fulfilled 5 · short 3"
 * long after the transfer has closed.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import {
  Fact,
  LineLedger,
  NotFoundNote,
  Panel,
  WorkspaceHeader,
  when,
} from "@/platforms/web/components/pos/TransferWorkspace";
import { StatusHistoryList } from "@/platforms/web/components/pos/StatusHistoryDialog";
import {
  TransferStepDialog,
  TransferReasonDialog,
} from "@/platforms/web/components/pos/TransferStepDialog";
import { useTransferRecord } from "@/platforms/web/components/pos/TransferWorkspace";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { groupOf } from "@/lib/stock-transfers";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";

export const Route = createFileRoute("/requests/$id")({
  head: () => ({
    meta: [
      { title: "Stock request — Retail" },
      {
        name: "description",
        content:
          "The full record of one stock request: requested, approved and fulfilled quantities, the transfer raised against it and its history.",
      },
      { property: "og:title", content: "Stock request — Retail" },
      {
        property: "og:description",
        content: "Requested, approved and fulfilled quantities for one branch stock request.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RequestDetail,
});

function RequestDetail() {
  const { id } = Route.useParams();
  const { state, stores, currentStore, approveTransfer, rejectTransfer } = usePos();
  const { can } = useAuth();
  const { transfer, live, loading } = useTransferRecord(id);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  if (loading)
    return (
      <AppShell>
        <p className="p-10 text-center text-sm text-muted-foreground">Loading request…</p>
      </AppShell>
    );

  if (!transfer)
    return (
      <AppShell>
        <NotFoundNote back="/transfers" backLabel="Back to stock movements" />
      </AppShell>
    );

  const storeOf = (sid: string) => stores.find((s) => s.id === sid);
  const source = storeOf(transfer.fromStoreId);
  const destination = storeOf(transfer.toStoreId);
  const fulfillingTransfer = state.transfers.find((t) => t.sourceRequestId === transfer.id) ?? null;

  const requested = transfer.items.reduce((a, i) => a + i.qty, 0);
  const approved = transfer.items.reduce((a, i) => a + (i.approvedQty ?? 0), 0);
  const fulfilled =
    fulfillingTransfer?.items.reduce((a, i) => a + (i.verifiedQty ?? i.dispatchedQty ?? 0), 0) ?? 0;
  const remaining = Math.max(0, requested - fulfilled);

  const mineToApprove = sameBranchId(transfer.fromStoreId, currentStore.id);
  const canApprove =
    live &&
    mineToApprove &&
    (transfer.status === "awaiting_approval" ||
      (transfer.status === "approved" && !fulfillingTransfer)) &&
    can("can_approve_transfer");
  const canReject =
    live && mineToApprove && transfer.status === "awaiting_approval" && can("can_approve_transfer");

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <WorkspaceHeader
          back="/transfers"
          backLabel="Back to stock movements"
          title={transfer.ref || "Stock request"}
          status={transfer.status}
          fulfilment={transfer.fulfilment}
          subtitle={`Raised by ${transfer.createdBy || "—"} · ${when(transfer.createdAt)}`}
          actions={
            <>
              {canApprove && (
                <Button onClick={() => setApproving(true)}>
                  <Check className="size-4" />
                  {transfer.status === "approved"
                    ? "Finish raising transfer"
                    : "Approve & raise transfer"}
                </Button>
              )}
              {canReject && (
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  <X className="size-4 text-destructive" /> Reject
                </Button>
              )}
              {fulfillingTransfer && (
                <Button asChild variant="outline">
                  <Link to="/transfers/$id" params={{ id: fulfillingTransfer.id }}>
                    Open transfer {fulfillingTransfer.ref}
                  </Link>
                </Button>
              )}
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-4">
          <Fact
            label="Supplying branch"
            value={source ? `${source.code} · ${source.name}` : transfer.fromStoreId}
          />
          <Fact
            label="Requesting branch"
            value={destination ? `${destination.code} · ${destination.name}` : transfer.toStoreId}
          />
          <Fact label="Cluster" value={`${groupOf(source)} → ${groupOf(destination)}`} />
          <Fact label="Status" value={TRANSFER_STATUS_LABELS[transfer.status]} />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Fact label="Requested" value={<span className="numeric">{requested}</span>} />
          <Fact label="Approved" value={<span className="numeric">{approved || "—"}</span>} />
          <Fact label="Fulfilled" value={<span className="numeric">{fulfilled}</span>} />
          <Fact
            label="Remaining"
            value={
              <span className={`numeric ${remaining ? "text-warning" : ""}`}>{remaining}</span>
            }
          />
        </div>

        <Panel
          title="Lines"
          description="Original quantities are never overwritten — later steps are recorded beside them."
        >
          <LineLedger transfer={transfer} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Related transfer">
            {fulfillingTransfer ? (
              <div className="space-y-2 text-sm">
                <p>
                  <Link
                    className="text-primary underline"
                    to="/transfers/$id"
                    params={{ id: fulfillingTransfer.id }}
                  >
                    {fulfillingTransfer.ref}
                  </Link>{" "}
                  · {TRANSFER_STATUS_LABELS[fulfillingTransfer.status]}
                </p>
                <p className="text-muted-foreground">
                  Dispatched {when(fulfillingTransfer.dispatchedAt)} · verified{" "}
                  {when(fulfillingTransfer.verifiedAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No transfer has been raised yet. Approving this request creates one.
              </p>
            )}
            {transfer.note && (
              <p className="mt-4 rounded-md border border-border px-3 py-2 text-sm">
                {transfer.note}
              </p>
            )}
            {(transfer.rejectedReason || transfer.cancelledReason) && (
              <p className="mt-4 text-sm text-destructive">
                {transfer.rejectedReason ?? transfer.cancelledReason}
              </p>
            )}
          </Panel>

          <Panel title="History" description="Every change to this request, newest first.">
            <StatusHistoryList entity="stock_transfer" entityId={transfer.id} />
          </Panel>
        </div>
      </div>

      {approving && (
        <TransferStepDialog
          step="approve"
          transfer={transfer}
          nameOf={(pid) => state.products.find((p) => p.id === pid)?.name ?? "Unknown item"}
          onClose={() => setApproving(false)}
          onConfirm={async (lines) => {
            const result = await approveTransfer(transfer.id, lines);
            if (!result.success) return void toast.error(result.error ?? "Approval was not saved");
            toast.success(`${transfer.ref} approved — a transfer has been raised`);
            setApproving(false);
          }}
        />
      )}

      {rejecting && (
        <TransferReasonDialog
          transfer={transfer}
          cancelling={false}
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            const result = await rejectTransfer(transfer.id, reason);
            if (!result.success) return void toast.error(result.error ?? "Rejection was not saved");
            toast.success(`${transfer.ref} rejected`);
            setRejecting(false);
          }}
        />
      )}
    </AppShell>
  );
}
