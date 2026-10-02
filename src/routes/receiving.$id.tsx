/**
 * Receiving workspace — the physical count that puts stock on the shelf.
 *
 * Nothing here is pre-filled from the sender's figures: the counter types
 * what is actually in the box. Any line that differs from what was
 * dispatched forces a written reason before the count can be posted.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Fact,
  NotFoundNote,
  Panel,
  WorkspaceHeader,
  useTransferRecord,
  when,
} from "@/platforms/web/components/pos/TransferWorkspace";
import { StatusHistoryList } from "@/platforms/web/components/pos/StatusHistoryDialog";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { TRANSFER_STATUS_LABELS } from "@/core/types/pos-types";
import { branchDisplayName } from "@/lib/human-readable";
import { exactCodeMatch } from "@/lib/product-search";

export const Route = createFileRoute("/receiving/$id")({
  head: () => ({
    meta: [
      { title: "Receive stock — Retail" },
      {
        name: "description",
        content:
          "Count an arrived transfer in line by line, record any discrepancy and post the stock to this branch.",
      },
      { property: "og:title", content: "Receive stock — Retail" },
      {
        property: "og:description",
        content: "Physically verify an arrived stock transfer before it hits the shelf.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceivingWorkspace,
});

function ReceivingWorkspace() {
  const { id } = Route.useParams();
  const { state, stores, currentStore, receiveTransfer, verifyTransfer } = usePos();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { transfer, live, loading } = useTransferRecord(id);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);

  /** Scanner wedge: an exact code on the note bumps that line's count by one. */
  function countByScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const hit = exactCodeMatch(state.products, code);
    const listed = hit && transfer?.items.some((i) => i.productId === hit.id) ? hit : null;
    if (!listed) {
      toast.error("That code is not on this delivery note");
      return;
    }
    setCounts((prev) => ({
      ...prev,
      [listed.id]: String(Math.max(0, Math.floor(Number(prev[listed.id] ?? 0) || 0)) + 1),
    }));
    setScan("");
  }

  // Start blank so the count is a real count, not a rubber stamp.
  useEffect(() => {
    if (!transfer) return;
    setCounts(Object.fromEntries(transfer.items.map((i) => [i.productId, ""])));
  }, [transfer]);

  const lines = useMemo(() => {
    if (!transfer) return [];
    return transfer.items.map((i) => {
      const expected = i.dispatchedQty ?? i.approvedQty ?? i.qty;
      const raw = counts[i.productId] ?? "";
      const entered = raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw) || 0));
      return {
        productId: i.productId,
        name: state.products.find((p) => p.id === i.productId)?.name ?? "Unknown item",
        code:
          state.products.find((p) => p.id === i.productId)?.barcode ??
          state.products.find((p) => p.id === i.productId)?.sku ??
          "",
        expected,
        entered,
        diff: entered === null ? null : entered - expected,
      };
    });
  }, [transfer, counts, state.products]);

  if (loading)
    return (
      <AppShell>
        <p className="p-10 text-center text-sm text-muted-foreground">Loading delivery…</p>
      </AppShell>
    );

  if (!transfer)
    return (
      <AppShell>
        <NotFoundNote back="/transfers" backLabel="Back to stock movements" />
      </AppShell>
    );

  const mine = transfer.toStoreId === currentStore.id;
  const allowed = live && mine && can("can_receive_transfer");
  const arrived = transfer.status === "received";
  const inTransit = transfer.status === "dispatched";
  const done = !arrived && !inTransit;

  const untouched = lines.some((l) => l.entered === null);
  const shortOrOver = lines.some((l) => l.diff !== null && l.diff !== 0);
  const expectedTotal = lines.reduce((a, l) => a + l.expected, 0);
  const countedTotal = lines.reduce((a, l) => a + (l.entered ?? 0), 0);

  async function post() {
    if (!transfer) return;
    if (untouched) {
      toast.error("Enter a counted quantity on every line — a blank line is not a count");
      return;
    }
    if (shortOrOver && !reason.trim()) {
      toast.error("The count does not match the note — say why before posting");
      return;
    }
    setBusy(true);
    const res = await verifyTransfer(
      transfer.id,
      lines.map((l) => ({ productId: l.productId, qty: l.entered ?? 0 })),
      reason.trim() || undefined,
    );
    setBusy(false);
    if (res && !res.success) {
      toast.error(res.error ?? "Could not post this count");
      return;
    }
    toast.success(
      shortOrOver
        ? `${transfer.ref} closed short — the difference is on the record`
        : `${transfer.ref} received in full`,
    );
    void navigate({ to: "/transfers/$id", params: { id: transfer.id } });
  }

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <WorkspaceHeader
          back="/transfers"
          backLabel="Back to stock movements"
          title={`Receive ${transfer.ref}`}
          status={transfer.status}
          fulfilment={transfer.fulfilment}
          subtitle={
            <>
              Sent from{" "}
              <span className="text-primary">
                {branchDisplayName(stores, transfer.fromStoreId)}
              </span>{" "}
              · dispatched {when(transfer.dispatchedAt)}
            </>
          }
          actions={
            inTransit && allowed ? (
              <Button
                onClick={async () => {
                  const result = await receiveTransfer(transfer.id);
                  if (result.success) toast.success("Marked as arrived — now count it in");
                  else toast.error(result.error ?? "Receipt was not saved");
                }}
              >
                Mark arrived
              </Button>
            ) : null
          }
        />

        <div className="grid gap-4 md:grid-cols-4">
          <Fact label="Status" value={TRANSFER_STATUS_LABELS[transfer.status]} />
          <Fact label="On the note" value={<span className="numeric">{expectedTotal}</span>} />
          <Fact label="Counted" value={<span className="numeric">{countedTotal}</span>} />
          <Fact
            label="Difference"
            value={
              <span className={`numeric ${shortOrOver ? "text-destructive" : ""}`}>
                {untouched ? "—" : countedTotal - expectedTotal}
              </span>
            }
          />
        </div>

        {!mine && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            This delivery belongs to another branch — you can read it, but only{" "}
            {stores.find((s) => s.id === transfer.toStoreId)?.name ?? "the destination"} can count
            it in.
          </p>
        )}

        {inTransit && (
          <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            The box has not been marked as arrived yet. Confirm arrival first, then count.
          </p>
        )}

        <Panel
          title="Physical count"
          description="Type what is actually in the box, or scan each item to count it up. Sent quantities are shown so a difference is obvious, but nothing is pre-filled."
        >
          {arrived && allowed && (
            <div className="mb-4 max-w-sm">
              <Label htmlFor="scan-count" className="text-xs text-muted-foreground">
                Scan to count
              </Label>
              <Input
                id="scan-count"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={countByScan}
                placeholder="Scan a barcode…"
                className="numeric mt-1 h-9"
                disabled={busy}
              />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.productId}>
                  <TableCell>
                    <div className="text-sm">{l.name}</div>
                    <div className="numeric text-[11px] text-muted-foreground">{l.code}</div>
                  </TableCell>
                  <TableCell className="numeric text-right">{l.expected}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="numeric ml-auto h-9 w-24 text-right"
                      inputMode="numeric"
                      value={counts[l.productId] ?? ""}
                      disabled={!allowed || !arrived || busy}
                      placeholder="—"
                      aria-label={`Counted quantity for ${l.name}`}
                      onChange={(e) =>
                        setCounts((prev) => ({ ...prev, [l.productId]: e.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell
                    className={`numeric text-right ${
                      l.diff !== null && l.diff !== 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {l.diff === null ? "—" : l.diff > 0 ? `+${l.diff}` : l.diff}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {arrived && allowed && (
            <div className="mt-5 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="discrepancy">
                  Discrepancy reason {shortOrOver && <span className="text-destructive">*</span>}
                </Label>
                <Textarea
                  id="discrepancy"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Two boxes damaged in transit"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void post()} disabled={busy || untouched}>
                  {busy ? "Posting…" : "Post count & add to stock"}
                </Button>
              </div>
            </div>
          )}

          {done && (
            <p className="mt-4 text-sm text-muted-foreground">
              This delivery is closed — counted {when(transfer.verifiedAt)}
              {transfer.verifiedBy ? ` by ${transfer.verifiedBy}` : ""}.
            </p>
          )}
        </Panel>

        <Panel title="History" description="Every change to this delivery, newest first.">
          <StatusHistoryList entity="stock_transfer" entityId={transfer.id} />
        </Panel>
      </div>
    </AppShell>
  );
}
