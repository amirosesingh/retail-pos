import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/pos-auth";

type Ticket = { ticketId: string; billNo: string; shiftId: string; status: string; updatedAt: string | null; rowVersion: string };
type Item = { name: string | null; quantity: string | null; variant?: string | null; price?: string | null };
type Local = Pick<Ticket, "status" | "updatedAt" | "rowVersion"> & { itemCount: number; items?: Item[]; total?: string | null };
type Cloud = { saleId: string; createdAt: string; total: string | null; paid: string | null; items: Item[]; paymentCount: number; proof: string };
type Reply = { ok: boolean; error?: string; code?: string };
type List = Reply & { available: boolean; items: Ticket[]; nextAfterId: string | null };
type Preview = Reply & Pick<Ticket, "ticketId" | "billNo" | "shiftId"> & {
  local: Local; cloud: Cloud | null; canAdopt: boolean; reviewToken: string | null; reason: string | null;
};
type Resolution = Reply & { state: string; ticketId: string; saleId: string; decisionId: string };
type Api = {
  list(options: { afterId: string | null; limit: number }): Promise<List>;
  preview(ticketId: string): Promise<Preview>;
  resolve(value: { reviewToken: string; reason: string }): Promise<Resolution>;
};

const nativeApi = () => typeof window === "undefined" ? undefined :
  (window.pos as unknown as { sync?: { heldRecovery?: Api } } | undefined)?.sync?.heldRecovery;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isTicketId = (value: unknown): value is string => isText(value) && value.length > 2 &&
  value.length <= 450 && value.startsWith("D:") &&
  Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const textOrNull = (value: unknown) => value === null || isText(value);
const validCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validItems = (value: unknown): value is Item[] => Array.isArray(value) &&
  value.every(item => item && (item.name === null || typeof item.name === "string") && textOrNull(item.quantity) &&
    (item.variant === undefined || textOrNull(item.variant)) && (item.price === undefined || textOrNull(item.price)));
const invalid = () => new Error("The held-bill comparison could not be verified. Open a fresh comparison before making a decision.");

function requireOk<T extends Reply>(reply: T): T {
  if (reply?.ok === true) return reply;
  throw new Error(reply?.error ?? "Held-bill recovery could not be checked.");
}

function readList(reply: List): List {
  requireOk(reply);
  if (typeof reply.available !== "boolean" || !Array.isArray(reply.items) ||
      reply.items.some(item => !item || !isTicketId(item.ticketId) || !isId(item.shiftId) || !isText(item.billNo) || !item.ticketId.endsWith(":" + item.billNo) ||
        !isText(item.status) || !textOrNull(item.updatedAt) || !isText(item.rowVersion)) ||
      (reply.nextAfterId !== null && !isTicketId(reply.nextAfterId)) ||
      (!reply.available && (reply.items.length > 0 || reply.nextAfterId !== null))) throw invalid();
  return reply;
}

function readPreview(reply: Preview, ticket: Ticket): Preview {
  requireOk(reply);
  if (reply.ticketId !== ticket.ticketId || reply.billNo !== ticket.billNo || reply.shiftId !== ticket.shiftId ||
      !reply.local || !isText(reply.local.status) || !textOrNull(reply.local.updatedAt) || !isText(reply.local.rowVersion) ||
      !validCount(reply.local.itemCount) || (reply.local.items !== undefined && !validItems(reply.local.items)) ||
      (reply.local.total !== undefined && !textOrNull(reply.local.total)) ||
      typeof reply.canAdopt !== "boolean" || !textOrNull(reply.reason)) throw invalid();
  const cloud = reply.cloud;
  if (cloud !== null && (!cloud || !isId(cloud.saleId) || !isText(cloud.createdAt) ||
      !textOrNull(cloud.total) || !textOrNull(cloud.paid) || !validItems(cloud.items) ||
      !validCount(cloud.paymentCount) || !["cleaned_hold", "completed_hold"].includes(cloud.proof))) throw invalid();
  if (reply.canAdopt ? (!cloud || !isText(reply.reviewToken) || !/^[A-Za-z0-9_-]{16,96}$/.test(reply.reviewToken) || reply.reason !== null || reply.local.items?.length !== reply.local.itemCount) : reply.reviewToken !== null) throw invalid();
  return reply;
}

function BillItems({ items }: { items?: Item[] }) {
  if (!items?.length) return null;
  return <ul className="mt-2 space-y-1 border-t pt-2 text-xs" aria-label="Bill items">
    {items.map((item, index) => <li key={index} className="flex justify-between gap-3">
      <span className="min-w-0 break-words"><span>{item.name || "Item name unavailable"}</span>{item.variant ? <span className="text-muted-foreground"> · {item.variant}</span> : null}</span>
      <span className="shrink-0 text-right tabular-nums"><span>{item.quantity === null ? "Quantity unavailable" : "Qty " + item.quantity}</span>{item.price ? <span className="block text-muted-foreground">Unit price {item.price}</span> : null}</span>
    </li>)}
  </ul>;
}

function Facts({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return <dl className="space-y-1 text-xs">{rows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3">
    <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-right tabular-nums">{value ?? "Not available"}</dd>
  </div>)}</dl>;
}

function HeldBillComparison({ preview }: { preview: Preview }) {
  const { local, cloud } = preview;
  return <section className="space-y-3" aria-label="Held bill comparison">
    <h3 className="break-words text-sm font-semibold">Bill {preview.billNo}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-md border p-3">
        <h4 className="mb-2 text-sm font-semibold">Local SQL Server</h4>
        <Facts rows={[["Status", local.status], ["Last saved", local.updatedAt], ["Record version", local.rowVersion],
          ["Held total", local.total], ["Item count", local.itemCount]]} />
        <BillItems items={local.items} />
        {local.items && local.items.length < local.itemCount ? <p className="mt-2 text-xs text-muted-foreground">Showing {local.items.length} of {local.itemCount} saved item lines.</p> : null}
      </div>
      <div className="min-w-0 rounded-md border p-3">
        <h4 className="mb-2 text-sm font-semibold">Cloud</h4>
        {cloud ? <>
          <Facts rows={[["Status", "Completed"], ["Sale recorded", cloud.createdAt], ["Total", cloud.total],
            ["Paid", cloud.paid], ["Payment records", cloud.paymentCount]]} />
          <BillItems items={cloud.items} />
        </> : <p className="text-xs text-muted-foreground">Completion could not be verified for this exact held bill.</p>}
      </div>
    </div>
  </section>;
}

function HeldBillReviewDialog({ api }: { api: Api }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [list, setList] = useState<List | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const sequence = useRef(0), requestInFlight = useRef(false), saving = useRef(false);
  const invalidate = () => { sequence.current++; requestInFlight.current = false; };
  useEffect(() => () => { sequence.current++; }, []);
  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const request = ++sequence.current, current = () => request === sequence.current;
    setBusy(true); setError(null);
    try { await work(current); }
    catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Held-bill recovery could not be checked.");
    } finally {
      if (current()) { requestInFlight.current = false; setBusy(false); }
    }
  };
  const load = (afterId: string | null = null) => run(async current => {
    const result = readList(await api.list({ afterId, limit: 25 }));
    if (current()) setList(previous => afterId && previous && result.available ? {
      ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.ticketId === item.ticketId))],
    } : result);
  });
  const inspect = (ticket: Ticket) => run(async current => {
    setPreview(null); setReason(""); setSaved(false);
    const result = readPreview(await api.preview(ticket.ticketId), ticket);
    if (current()) setPreview(result);
  });
  const resolve = () => {
    const reviewToken = preview?.reviewToken;
    if (!preview?.canAdopt || !reviewToken || !preview.cloud || reason.trim().length < 3) return;
    const { ticketId, cloud } = preview;
    void run(async current => {
      // A changed-source or ambiguous reply requires a fresh review before another decision.
      setPreview(null);
      const result = requireOk(await api.resolve({ reviewToken, reason: reason.trim() }));
      if (result.state !== "ADOPTED" || result.ticketId !== ticketId || result.saleId !== cloud.saleId || !isId(result.decisionId)) throw invalid();
      if (current()) {
        setSaved(true); setReason("");
        setList(value => value && { ...value, items: value.items.filter(item => item.ticketId !== ticketId) });
      }
    });
  };

  return <>
    <Button type="button" variant="outline" onClick={() => {
      setOpen(true); setList(null); setPreview(null); setReason(""); setSaved(false); void load();
    }}>Compare held bills</Button>
    <Dialog open={open} onOpenChange={value => {
      setOpen(value);
      if (!value) { invalidate(); setBusy(false); }
    }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare held bills</DialogTitle>
          <DialogDescription>Review held bills from this terminal against proven cloud completions.</DialogDescription>
        </DialogHeader>
        {busy ? <p role="status" className="text-sm text-muted-foreground">Checking held-bill records…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {saved ? <p role="status" className="text-sm">The cloud completion was recorded on this PC. The previous local record and your reason were saved for audit. Shift recovery and synchronization have separate status checks.</p> : null}
        {error && !list ? <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Retry held-bill list</Button> : null}
        {list?.available === false ? <p role="status" className="text-sm">Held-bill comparison is unavailable for this database.</p> : null}
        {list?.available ? <div className="max-h-44 space-y-1 overflow-y-auto" aria-label="Held bills">
          {list.items.map(ticket => <button type="button" key={ticket.ticketId} disabled={busy} onClick={() => void inspect(ticket)}
            className="flex w-full flex-wrap justify-between gap-x-3 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50">
            <span>{ticket.billNo}</span><span>{ticket.status} · {ticket.updatedAt ?? "Time unavailable"}</span>
          </button>)}
          {!list.items.length && !list.nextAfterId ? <p className="text-sm text-muted-foreground">No held bills are listed for this registered terminal.</p> : null}
          {list.nextAfterId ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void load(list.nextAfterId)}>More held bills</Button> : null}
        </div> : null}
        {preview ? <>
          <HeldBillComparison preview={preview} />
          {preview.canAdopt && preview.reviewToken ? <div className="space-y-2">
            <p className="text-sm">Use the verified cloud completion on this PC. This preserves the local held record for audit and does not charge the customer again.</p>
            <Label htmlFor="held-bill-review-reason">Administrator review reason</Label>
            <Input id="held-bill-review-reason" maxLength={400} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
            <Button type="button" disabled={busy || reason.trim().length < 3} onClick={resolve}>Use verified cloud completion</Button>
          </div> : <p role="status" className="text-sm text-muted-foreground">
            {preview.reason === "SCHEMA_REQUIRED" ? "Read-only comparison. Saving a decision requires the reviewed recovery metadata upgrade on this PC."
              : preview.reason === "CART_TOO_LARGE" ? "Read-only comparison. This cart has too many lines to compare in full. The bill remains held."
              : preview.reason === "NO_COMPLETION_PROOF" ? "This bill remains held. A matching completed sale could not be proved."
              : "This bill remains pending. Review the difference before continuing."}
          </p>}
        </> : null}
      </DialogContent>
    </Dialog>
  </>;
}

export function HeldBillRecoveryReview() {
  const { isAdmin, user, authUserId } = useAuth();
  const api = nativeApi();
  if (!isAdmin || !user?.staffId || !api?.list || !api?.preview || !api?.resolve) return null;
  return <HeldBillReviewDialog key={JSON.stringify([user.staffId, authUserId])} api={api} />;
}
