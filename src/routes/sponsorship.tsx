import { stockReferencePlan } from "@/lib/stock-ref";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/pos-auth";
import { usePos, stockAt, money } from "@/lib/pos-store";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  loadSponsorships,
  requestSponsorship,
  handOverSponsorship,
  getSponsorshipAccess,
} from "@/lib/sponsorship-client";
import {
  sponsorshipInput,
  sponsorshipLineAmounts,
  type SponsorshipRecord,
} from "@/lib/sponsorship";
import { printSponsorshipReceipt } from "@/lib/pos-print";
import { syncNow, subscribeDataChange } from "@/lib/sync-engine";
import {
  createRefreshQueue,
  requestBackgroundRefresh,
  subscribeBackgroundRefresh,
} from "@/lib/background-refresh";
import { hasFeature } from "@/platform-config/features";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/time-zone";
import { submitAuthorizationRequest } from "@/lib/authorization-client";
import { notifyError } from "@/lib/notify";

export const Route = createFileRoute("/sponsorship")({
  component: SponsorshipPage,
  head: () => ({ meta: [{ title: "Sponsorship — Retail" }] }),
});
function SponsorshipPage() {
  const { state, currentStore, stores } = usePos();
  const { can, user, terminalStoreId } = useAuth();
  const [source, setSource] = useState(currentStore.id),
    [offset, setOffset] = useState(0),
    [records, setRecords] = useState<SponsorshipRecord[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false),
    [recipient, setRecipient] = useState(""),
    [contact, setContact] = useState(""),
    [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<
      {
        productId: string;
        quantity: number;
        discount?: number;
        discountType?: "amount" | "percent";
      }[]
    >([]),
    [search, setSearch] = useState("");
  const [handoverError, setHandoverError] = useState("");
  const [handover, setHandover] = useState<SponsorshipRecord | null>(null),
    [receiver, setReceiver] = useState("");
  const lastAttempt = useRef(""),
    attempt = useRef(crypto.randomUUID()),
    sequence = useRef(0),
    busyRef = useRef(false);
  const sourceChoices = stores.filter(
    (store) =>
      store.active !== false &&
      !store.archivedAt &&
      (!terminalStoreId || store.id === terminalStoreId) &&
      (!user?.storeId || store.id === user.storeId),
  );
  const [direct, setDirect] = useState(false);
  const allowed = can("can_view_sponsorship");
  const load = useCallback(
    async (foreground = true) => {
      if (!allowed) return;
      const read = ++sequence.current;
      if (foreground) setLoading(true);
      try {
        const proof = await getPosCallerAuth();
        const [next, access] = await Promise.all([
          loadSponsorships({ data: { ...proof, storeId: source, offset } }),
          getSponsorshipAccess({ data: proof }),
        ]);
        if (read === sequence.current) {
          setRecords(next);
          setDirect(access.direct);
          setError("");
        }
      } catch (cause) {
        if (read === sequence.current)
          setError(cause instanceof Error ? cause.message : "Could not load sponsorships");
      } finally {
        if (read === sequence.current) setLoading(false);
      }
    },
    [allowed, source, offset],
  );
  useEffect(() => {
    void load();
    const activeSequence = sequence;
    return () => {
      activeSequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!allowed) return;
    const queue = createRefreshQueue(() => load(false));
    const off = subscribeDataChange((change) => {
      if (["authorization_requests", "products", "activity_events"].includes(change.table))
        void queue.refresh();
    });
    const catchup = subscribeBackgroundRefresh(() => void queue.refresh(), 60_000);
    return () => {
      off();
      catchup();
      queue.stop();
    };
  }, [allowed, load]);
  const products = useMemo(() => {
    const query = search.trim().toLowerCase();
    return state.products
      .filter(
        (product) =>
          !product.archived &&
          (!product.ownerStoreId || product.ownerStoreId === source) &&
          stockAt(product, source) > 0 &&
          (!query ||
            `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(query)),
      )
      .slice(0, 30);
  }, [state.products, search, source]);
  async function ensureOnline() {
    if (!navigator.onLine)
      throw new Error("Sponsorship requires an online approval and a confirmed stock write");
    if (hasFeature("localDb")) {
      const result = await syncNow("sponsorship-before-write");
      if (!result.ok)
        throw new Error(`Finish stock synchronization before sponsorship: ${result.error}`);
    }
  }
  async function submit() {
    if (busyRef.current) return;
    if (
      lines.some(
        (line) =>
          !sponsorshipLineAmounts(
            state.products.find((product) => product.id === line.productId)?.price ?? 0,
            line.quantity,
            line.discount ?? 0,
            line.discountType ?? "amount",
          ).valid,
      )
    ) {
      toast.error(
        "Check the sponsorship discounts; a discount cannot exceed the product line value",
      );
      return;
    }
    const fingerprint = JSON.stringify({ source, recipient, contact, purpose, lines });
    if (lastAttempt.current && lastAttempt.current !== fingerprint)
      attempt.current = crypto.randomUUID();
    lastAttempt.current = fingerprint;
    const parsed = sponsorshipInput.safeParse({
      id: attempt.current,
      numbering: stockReferencePlan(
        state.settings.integrations.sponsorshipNumbering ?? {},
        stores.find((store) => store.id === source)?.code ?? source,
        "sponsorship",
      ),
      storeId: source,
      recipient,
      contact,
      purpose,
      lines,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the sponsorship details");
      return;
    }
    busyRef.current = true;
    setBusy(direct ? "Saving sponsorship…" : "Sending sponsorship for approval…");
    try {
      await ensureOnline();
      const saved = await requestSponsorship({
        data: { proof: await getPosCallerAuth(), routing: parsed.data },
      });
      setFormOpen(false);
      setLines([]);
      setRecipient("");
      setContact("");
      setPurpose("");
      setSearch("");
      attempt.current = crypto.randomUUID();
      toast.success(
        saved.approval_status === "not_required"
          ? "Sponsorship saved. Confirm handover to issue stock and print the receipt."
          : "Sponsorship sent for approval. No stock has been issued.",
      );
      await load();
    } catch (cause) {
      notifyError(cause, "Could not submit sponsorship. Your details remain available for retry.");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function resend(record: SponsorshipRecord) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("Sending saved sponsorship for approval…");
    try {
      await ensureOnline();
      const result = await submitAuthorizationRequest({
        data: {
          ...(await getPosCallerAuth()),
          requestId: record.id,
          actionKey: "sponsorship",
          storeId: record.store_id,
          reason: record.purpose,
          payload: { sponsorship_id: record.id, document_hash: record.document_hash },
          requestedAmount: record.total_value,
          valueUnit: "currency",
        },
      });
      if (!result.ok) throw new Error(result.error);
      toast.success("Saved sponsorship sent for approval");
      await load();
    } catch (cause) {
      notifyError(cause, "Could not submit saved sponsorship");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function assignExistingNumber(record: SponsorshipRecord) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("Assigning the document number…");
    try {
      await ensureOnline();
      await requestSponsorship({
        data: {
          proof: await getPosCallerAuth(),
          routing: {
            id: record.id,
            storeId: record.store_id,
            recipient: record.recipient_name,
            contact: record.recipient_contact,
            purpose: record.purpose,
            numbering: stockReferencePlan(
              state.settings.integrations.sponsorshipNumbering ?? {},
              stores.find((store) => store.id === record.store_id)?.code ?? record.store_id,
              "sponsorship",
            ),
            lines: record.lines.map((line) => ({
              productId: line.product_id,
              quantity: line.quantity,
              discount: line.discount ?? 0,
              discountType: line.discount_type ?? "amount",
            })),
          },
        },
      });
      await load();
      toast.success("Sponsorship document number assigned. Products and stock are unchanged.");
    } catch (cause) {
      notifyError(cause, "Assigning sponsorship document number");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function give() {
    if (!handover || busyRef.current) return;
    if (receiver.trim().length < 2) {
      toast.error("Enter the name of the person receiving the products");
      return;
    }
    busyRef.current = true;
    setHandoverError("");
    setBusy("Confirming authorization and recording stock handover…");
    try {
      await ensureOnline();
      const saved = await handOverSponsorship({
        data: { ...(await getPosCallerAuth()), id: handover.id, receivedBy: receiver.trim() },
      });
      setHandover(null);
      toast.success("Sponsorship handover recorded");
      await load();
      requestBackgroundRefresh();
      if (hasFeature("localDb")) void syncNow("sponsorship-handover-saved");
      try {
        const printed = await printSponsorshipReceipt(saved);
        if (!printed.ok)
          toast.warning("The handover is saved. Use Print receipt to try printing again.");
      } catch {
        toast.warning("The handover is saved. Use Print receipt to try printing again.");
      }
    } catch (cause) {
      const reason =
        cause instanceof Error ? cause.message : "The server did not confirm the result";
      setHandoverError(reason);
      notifyError(cause, "Confirming sponsorship handover");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Sponsorship</h1>
            <p className="text-sm text-muted-foreground">
              Give products from a shop or warehouse. Administrators and selected direct issuers can
              hand over directly; other users need approval. The operational reporting policy
              controls whether sponsored value is included in daily sales summaries.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!!busy || loading} onClick={() => void load()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            {can("can_create_sponsorship") && (
              <Button disabled={!!busy} onClick={() => setFormOpen(true)}>
                <Plus className="size-4" />
                New sponsorship
              </Button>
            )}
          </div>
        </header>
        {!allowed ? (
          <p role="alert">Sponsorship viewing permission is required.</p>
        ) : (
          <>
            <label className="grid max-w-md gap-2 text-sm">
              Source shop or warehouse
              <select
                aria-label="Sponsorship source"
                className="h-10 rounded-md border bg-background px-3"
                value={source}
                disabled={!!busy || formOpen}
                onChange={(event) => {
                  setSource(event.target.value);
                  setOffset(0);
                }}
              >
                {sourceChoices.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="rounded-lg border bg-muted/25 p-3 text-sm">
              {direct
                ? "Your account may issue sponsorship directly. Other users need an eligible person’s approval in "
                : "Your sponsorships need another eligible person’s approval in "}{" "}
              <Link to="/approvals" className="underline">
                Approvals
              </Link>
              , including zero-value products. Nothing is deducted when you send a request.
            </p>
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 p-3 text-destructive"
              >
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="rounded-lg border p-3">
                {busy}
              </p>
            )}
            {loading ? (
              <p role="status">Loading sponsorship records…</p>
            ) : (
              <div className="overflow-x-auto">
                <Table tableId="routes/sponsorship#1" className="w-full text-sm">
                  <TableHeader>
                    <TableRow className="border-b">
                      <TableHead className="p-3 text-left">Reference / requested</TableHead>
                      <TableHead className="p-3 text-left">Recipient</TableHead>
                      <TableHead className="p-3 text-left">Products / value</TableHead>
                      <TableHead className="p-3 text-left">Discount</TableHead>
                      <TableHead className="p-3 text-left">Approval / handover</TableHead>
                      <TableHead className="p-3 text-left">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record.id} className="border-b align-top">
                        <TableCell className="max-w-56 break-words p-3">
                          <p>{record.reference}</p>
                          {direct &&
                            record.status !== "issued" &&
                            record.approval_status === "not_submitted" &&
                            record.reference === `SP-${record.id}` &&
                            record.created_by === user?.staffId &&
                            can("can_create_sponsorship") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!busy}
                                onClick={() => void assignExistingNumber(record)}
                              >
                                Assign document number
                              </Button>
                            )}
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(new Date(record.created_at))} · {record.created_by_name}
                          </p>
                        </TableCell>
                        <TableCell className="p-3">
                          <p className="font-medium">{record.recipient_name}</p>
                          <p className="text-xs">{record.recipient_contact}</p>
                          <p className="max-w-64 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {record.purpose}
                          </p>
                        </TableCell>
                        <TableCell className="p-3">
                          <p>
                            {record.lines.reduce((sum, line) => sum + line.quantity, 0)} units ·{" "}
                            {money(record.total_value)}
                          </p>
                          <details>
                            <summary className="cursor-pointer">
                              {record.lines.length} product lines
                            </summary>
                            <ul>
                              {record.lines.map((line) => (
                                <li key={line.product_id}>
                                  {line.name} · {line.quantity} × {money(line.unit_value)} ·
                                  Discount {money(line.discount_amount ?? 0)} · Net{" "}
                                  {money(line.line_value ?? line.quantity * line.unit_value)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </TableCell>
                        <TableCell className="p-3">
                          {money(
                            record.lines.reduce(
                              (sum, line) => sum + (line.discount_amount ?? 0),
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="p-3">
                          <p>
                            {record.status === "issued"
                              ? "Handed over"
                              : record.approval_status === "not_submitted" && direct
                                ? "Direct issue available"
                                : record.approval_status?.replaceAll("_", " ")}
                          </p>
                          {record.given_at && (
                            <p className="text-xs">
                              {formatDateTime(new Date(record.given_at))} · {record.given_by_name}
                              <br />
                              Received by {record.received_by}
                              <br />
                              {record.authorization_mode === "direct"
                                ? "Authorized by"
                                : "Approved by"}{" "}
                              {record.approved_by_name}
                            </p>
                          )}
                          {record.approval_note && (
                            <p className="text-xs text-muted-foreground">{record.approval_note}</p>
                          )}
                        </TableCell>
                        <TableCell className="p-3">
                          {record.status === "issued" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!busy}
                              onClick={() => void printSponsorshipReceipt(record)}
                            >
                              <Printer className="size-4" />
                              Print receipt
                            </Button>
                          ) : (record.approval_status === "approved" || direct) &&
                            can("can_issue_sponsorship") ? (
                            <Button
                              size="sm"
                              disabled={!!busy}
                              onClick={() => {
                                setHandoverError("");
                                setHandover(record);
                                setReceiver(record.recipient_name);
                              }}
                            >
                              Confirm handover
                            </Button>
                          ) : record.approval_status === "not_submitted" &&
                            record.created_by === user?.staffId &&
                            can("can_create_sponsorship") ? (
                            <Button disabled={!!busy} size="sm" onClick={() => void resend(record)}>
                              Send for approval
                            </Button>
                          ) : (
                            <Link to="/approvals" className="underline">
                              View approvals
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!records.length && (
                  <p className="p-5 text-sm text-muted-foreground">
                    No sponsorship records for this source.
                  </p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={!!busy || loading || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={!!busy || loading || records.length < 50}
                onClick={() => setOffset((value) => value + 50)}
              >
                Next
              </Button>
            </div>
          </>
        )}
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (!busy) setFormOpen(open);
          }}
        >
          <DialogContent showCloseButton={!busy} className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New sponsorship</DialogTitle>
              <DialogDescription>
                Record the recipient and products. Administrators and selected direct issuers may
                hand over directly; other users need approval.
              </DialogDescription>
            </DialogHeader>
            <Label htmlFor="sponsor-recipient">Recipient / organisation</Label>
            <Input
              id="sponsor-recipient"
              value={recipient}
              maxLength={160}
              disabled={!!busy}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <Label htmlFor="sponsor-contact">Contact or event reference (optional)</Label>
            <Input
              id="sponsor-contact"
              value={contact}
              maxLength={160}
              disabled={!!busy}
              onChange={(event) => setContact(event.target.value)}
            />
            <Label htmlFor="sponsor-purpose">Reason for sponsorship</Label>
            <Textarea
              id="sponsor-purpose"
              value={purpose}
              maxLength={400}
              disabled={!!busy}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <Label htmlFor="sponsor-search">Find products at this source</Label>
            <Input
              id="sponsor-search"
              placeholder="Name, SKU or barcode"
              value={search}
              disabled={!!busy}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="max-h-44 overflow-y-auto rounded-lg border">
              {products.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  disabled={
                    !!busy ||
                    lines.some((line) => line.productId === product.id) ||
                    lines.length >= 100
                  }
                  className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm disabled:opacity-50"
                  onClick={() =>
                    setLines((value) => [...value, { productId: product.id, quantity: 1 }])
                  }
                >
                  <span>
                    {product.name} · {product.sku}
                  </span>
                  <span>
                    {stockAt(product, source)} available · {money(product.price)}
                  </span>
                </button>
              ))}
              {!products.length && (
                <p className="p-3 text-sm">No matching products with available stock.</p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2">Quantity</th>
                    <th className="p-2">Discount</th>
                    <th className="p-2">Final value</th>
                    <th className="p-2">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const product = state.products.find((item) => item.id === line.productId);
                    const amounts = sponsorshipLineAmounts(
                      product?.price ?? 0,
                      line.quantity,
                      line.discount ?? 0,
                      line.discountType ?? "amount",
                    );
                    return (
                      <tr key={line.productId} className="border-b">
                        <td className="min-w-36 p-2">
                          {product?.name ?? line.productId}
                          <p className="text-xs text-muted-foreground">
                            {money(product?.price ?? 0)} each
                          </p>
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min={1}
                            max={100000}
                            className="w-20"
                            aria-label={`Sponsorship quantity for ${product?.name ?? line.productId}`}
                            disabled={!!busy}
                            value={line.quantity}
                            onChange={(event) =>
                              setLines((value) =>
                                value.map((item) =>
                                  item.productId === line.productId
                                    ? { ...item, quantity: Number(event.target.value) }
                                    : item,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex min-w-40 gap-1">
                            <select
                              aria-label={`Discount type for ${product?.name ?? line.productId}`}
                              className="rounded-md border bg-background px-2"
                              disabled={!!busy}
                              value={line.discountType ?? "amount"}
                              onChange={(event) =>
                                setLines((value) =>
                                  value.map((item) =>
                                    item.productId === line.productId
                                      ? {
                                          ...item,
                                          discountType: event.target.value as "amount" | "percent",
                                        }
                                      : item,
                                  ),
                                )
                              }
                            >
                              <option value="amount">Amount</option>
                              <option value="percent">%</option>
                            </select>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              aria-label={`Discount for ${product?.name ?? line.productId}`}
                              className="w-24"
                              disabled={!!busy}
                              value={line.discount ?? 0}
                              onChange={(event) =>
                                setLines((value) =>
                                  value.map((item) =>
                                    item.productId === line.productId
                                      ? { ...item, discount: Number(event.target.value) }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                        </td>
                        <td className="p-2">
                          {amounts.valid ? (
                            money(amounts.total)
                          ) : (
                            <span role="alert" className="text-destructive">
                              Invalid discount
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${product?.name ?? line.productId}`}
                            disabled={!!busy}
                            onClick={() =>
                              setLines((value) =>
                                value.filter((item) => item.productId !== line.productId),
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-right text-sm font-medium">
              Sponsored value:{" "}
              {money(
                lines.reduce(
                  (sum, line) =>
                    sum +
                    sponsorshipLineAmounts(
                      state.products.find((item) => item.id === line.productId)?.price ?? 0,
                      line.quantity,
                      line.discount ?? 0,
                      line.discountType ?? "amount",
                    ).total,
                  0,
                ),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Prices, source stock and the exact approved document are verified by the database.
              Stock is checked again at handover. Online connection is required.
            </p>
            <DialogFooter>
              <Button variant="outline" disabled={!!busy} onClick={() => setFormOpen(false)}>
                Keep draft and close
              </Button>
              <Button disabled={!!busy || !lines.length} onClick={() => void submit()}>
                <Send className="size-4" />
                {busy || (direct ? "Save sponsorship" : "Send for approval")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!handover}
          onOpenChange={(open) => {
            if (!open && !busy) setHandover(null);
          }}
        >
          <DialogContent showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>Confirm sponsorship handover</DialogTitle>
              <DialogDescription>
                {handover?.reference} · {handover?.recipient_name}. This records the actual handover
                time and deducts stock once.
              </DialogDescription>
            </DialogHeader>
            {handoverError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
              >
                {handoverError} Check the history before retrying if the connection was interrupted.
              </p>
            )}
            <Label htmlFor="sponsor-receiver">Person receiving the products</Label>
            <Input
              id="sponsor-receiver"
              value={receiver}
              maxLength={160}
              disabled={!!busy}
              onChange={(event) => setReceiver(event.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" disabled={!!busy} onClick={() => setHandover(null)}>
                Cancel
              </Button>
              <Button disabled={!!busy} onClick={() => void give()}>
                {busy || "Confirm handover & print"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
