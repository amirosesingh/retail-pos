import { sameBranchId } from "@/lib/branch-id";
/**
 * One transfer note, in full: what was asked for, approved, packed and
 * finally counted in. The page is the workspace for the sending branch —
 * the receiving side's counting lives on /receiving/$id.
 */
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, PackageCheck, Send, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import {
  Fact,
  LineLedger,
  NotFoundNote,
  Panel,
  WorkspaceHeader,
  useTransferRecord,
  when,
} from "@/platforms/web/components/pos/TransferWorkspace";
import { StatusHistoryList } from "@/platforms/web/components/pos/StatusHistoryDialog";
import {
  TransferStepDialog,
  TransferReasonDialog,
} from "@/platforms/web/components/pos/TransferStepDialog";
import type { TransferStep } from "@/platforms/web/components/pos/TransferStepDialog";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { groupOf } from "@/lib/stock-transfers";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";

export const Route = createFileRoute("/transfers/$id")({
  head: () => ({
    meta: [
      { title: "Stock transfer — Retail" },
      {
        name: "description",
        content:
          "The full record of one stock transfer: approved, dispatched and verified quantities, discrepancies and history.",
      },
      { property: "og:title", content: "Stock transfer — Retail" },
      {
        property: "og:description",
        content: "Approved, dispatched and verified quantities for one branch stock transfer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TransferDetail,
});

function TransferDetail() {
  const { id } = Route.useParams();
  const {
    state,
    stores,
    currentStore,
    approveTransfer,
    dispatchTransfer,
    receiveTransfer,
    rejectTransfer,
  } = usePos();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { transfer, live, loading } = useTransferRecord(id);
  const [step, setStep] = useState<TransferStep | null>(null);
  const [rejecting, setRejecting] = useState(false);

  if (loading)
    return (
      <AppShell>
        <p className="p-10 text-center text-sm text-muted-foreground">Loading transfer…</p>
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
  const sending = sameBranchId(transfer.fromStoreId, currentStore.id);
  const receiving = sameBranchId(transfer.toStoreId, currentStore.id);
  const parentRequest = transfer.sourceRequestId
    ? (state.transfers.find((t) => t.id === transfer.sourceRequestId) ?? null)
    : null;

  const asked = transfer.items.reduce((a, i) => a + i.qty, 0);
  const sent = transfer.items.reduce((a, i) => a + (i.dispatchedQty ?? 0), 0);
  const counted = transfer.items.reduce((a, i) => a + (i.verifiedQty ?? 0), 0);

  const canApprove =
    live && sending && transfer.status === "awaiting_approval" && can("can_approve_transfer");
  const canDispatch =
    live && sending && transfer.status === "approved" && can("can_create_transfer");
  const canReceive =
    live && receiving && transfer.status === "dispatched" && can("can_receive_transfer");
  const canVerify =
    live && receiving && transfer.status === "received" && can("can_receive_transfer");
  const canReject =
    live &&
    sending &&
    transfer.status === "awaiting_approval" &&
    can("can_approve_transfer");

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <WorkspaceHeader
          back="/transfers"
          backLabel="Back to stock movements"
          title={transfer.ref || "Stock transfer"}
          status={transfer.status}
          fulfilment={transfer.fulfilment}
          subtitle={`Raised by ${transfer.createdBy || "—"} · ${when(transfer.createdAt)}`}
          actions={
            <>
              {canApprove && (
                <Button onClick={() => setStep("approve")}>
                  <Check className="size-4" /> Approve
                </Button>
              )}
              {canDispatch && (
                <Button onClick={() => setStep("dispatch")}>
                  <Send className="size-4" /> Dispatch
                </Button>
              )}
              {canReceive && (
                <Button onClick={() => setStep("receive")}>
                  <PackageCheck className="size-4" /> Mark arrived
                </Button>
              )}
              {canVerify && (
                <Button asChild>
                  <Link to="/receiving/$id" params={{ id: transfer.id }}>
                    Count it in
                  </Link>
                </Button>
              )}
              {canReject && (
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  <X className="size-4 text-destructive" /> Reject
                </Button>
              )}
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-4">
          <Fact
            label="From"
            value={source ? `${source.code} · ${source.name}` : transfer.fromStoreId}
          />
          <Fact
            label="To"
            value={destination ? `${destination.code} · ${destination.name}` : transfer.toStoreId}
          />
          <Fact label="Cluster" value={`${groupOf(source)} → ${groupOf(destination)}`} />
          <Fact label="Status" value={TRANSFER_STATUS_LABELS[transfer.status]} />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Fact label="On the note" value={<span className="numeric">{asked}</span>} />
          <Fact label="Dispatched" value={<span className="numeric">{sent || "—"}</span>} />
          <Fact label="Counted in" value={<span className="numeric">{counted || "—"}</span>} />
          <Fact
            label="Difference"
            value={
              <span className={`numeric ${sent && counted !== sent ? "text-destructive" : ""}`}>
                {sent ? counted - sent : "—"}
              </span>
            }
          />
        </div>

        <Panel
          title="Lines"
          description="Each step is recorded next to the original quantity, never over it."
        >
          <LineLedger transfer={transfer} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Paper trail">
            <dl className="space-y-2 text-sm">
              <Row label="Approved" value={when(transfer.approvedAt)} />
              <Row label="Dispatched" value={when(transfer.dispatchedAt)} />
              <Row label="Arrived" value={when(transfer.receivedAt)} />
              <Row
                label="Verified"
                value={`${when(transfer.verifiedAt)}${
                  transfer.verifiedBy ? ` · ${transfer.verifiedBy}` : ""
                }`}
              />
            </dl>
            {parentRequest && (
              <p className="mt-4 text-sm">
                Raised against{" "}
                <Link
                  className="text-primary underline"
                  to="/requests/$id"
                  params={{ id: parentRequest.id }}
                >
                  {parentRequest.ref}
                </Link>
              </p>
            )}
            {transfer.note && (
              <p className="mt-4 rounded-md border border-border px-3 py-2 text-sm">
                {transfer.note}
              </p>
            )}
            {transfer.discrepancyReason && (
              <p className="mt-4 text-sm text-destructive">
                Discrepancy: {transfer.discrepancyReason}
              </p>
            )}
            {(transfer.rejectedReason || transfer.cancelledReason) && (
              <p className="mt-2 text-sm text-destructive">
                {transfer.rejectedReason ?? transfer.cancelledReason}
              </p>
            )}
          </Panel>

          <Panel title="History" description="Every change to this note, newest first.">
            <StatusHistoryList entity="stock_transfer" entityId={transfer.id} />
          </Panel>
        </div>
      </div>

      {step && (
        <TransferStepDialog
          step={step}
          transfer={transfer}
          nameOf={(pid) => state.products.find((p) => p.id === pid)?.name ?? "Unknown item"}
          onClose={() => setStep(null)}
          onConfirm={async (lines) => {
            let result;
            if (step === "approve") {
              result = await approveTransfer(transfer.id, lines);
              if (!result.success)
                return void toast.error(result.error ?? "Approval was not saved");
              toast.success(`${transfer.ref} approved`);
            } else if (step === "dispatch") {
              result = await dispatchTransfer(transfer.id, lines);
              if (!result.success)
                return void toast.error(result.error ?? "Dispatch was not saved");
              toast.success(`${transfer.ref} dispatched`);
            } else if (step === "receive") {
              result = await receiveTransfer(transfer.id);
              if (!result.success) return void toast.error(result.error ?? "Receipt was not saved");
              toast.success(`${transfer.ref} marked as arrived — count it in next`);
              void navigate({ to: "/receiving/$id", params: { id: transfer.id } });
            }
            setStep(null);
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
