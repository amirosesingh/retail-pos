import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemedSelect } from "./ThemedSelect";
import { usePos, money } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import { sameBranchId } from "@/lib/branch-id";
import { effectiveTimeZone, posDateTimeToIso } from "@/lib/time-zone";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { addMissedBill, listMissedBillCashiers } from "@/lib/missed-bill-client";
import { missedBillInput, type MissedBillInput } from "@/lib/missed-bill-input";
import { pageDataScope } from "@/lib/page-data-cache";
import { withReadDeadline } from "@/lib/read-retry";

type Line = { key: string; productId: string; quantity: string; unitPrice: string; unitCost: string; discountAmount: string; taxAmount: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), productId: "", quantity: "1", unitPrice: "", unitCost: "", discountAmount: "0", taxAmount: "0" });
const methods = [["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["wallet", "Wallet"]] as const;

export function AddMissedBillDialog({ onSaved }: { onSaved: (result: { saleId: string; receiptNo: string; receiptJson?: string; storeId: string }) => void }) {
  const { state, currentStore } = usePos();
  const { isAdmin, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [cashier, setCashier] = useState("");
  const [shift, setShift] = useState("none");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [stock, setStock] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);
  const clientKey = useRef(crypto.randomUUID());
  const submitted = useRef<MissedBillInput | null>(null);
  const branchAtOpen = useRef(currentStore.id);
  const branchChanged = !sameBranchId(branchAtOpen.current, currentStore.id);
  const cashiers = useQuery({
    queryKey: ["missed-bill-cashiers", ...pageDataScope(user), currentStore.id],
    enabled: open && isAdmin && Boolean(currentStore.id) && !branchChanged,
    staleTime: 0, gcTime: 300_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => withReadDeadline(async () => {
      const result = await listMissedBillCashiers({ data: { ...await getPosCallerAuth(), storeId: currentStore.id }, signal });
      if (!result.ok) throw new Error(result.error);
      return result.rows;
    }, 20_000),
  });
  const catalogue = useMemo(() => {
    const visible = createCatalogueVisibility(state.settings, state.stores, state.transfers);
    return state.products.filter(p => visible(p, currentStore.id)).map(p => ({ value: p.id, label: `${p.name} · ${p.sku} · ${p.barcode}` }));
  }, [state.settings, state.stores, state.transfers, state.products, currentStore.id]);
  const total = Math.round(lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitPrice) - Number(line.discountAmount) + Number(line.taxAmount), 0) * 100) / 100;
  const paid = Math.round(Object.values(payments).reduce((sum, value) => sum + Number(value || 0), 0) * 100) / 100;
  const patchLine = (key: string, field: keyof Line, value: string) => setLines(previous => previous.map(line => line.key === key ? { ...line, [field]: value } : line));
  const reset = () => {
    setDate(""); setCashier(""); setShift("none"); setReference(""); setReason(""); setStock(""); setStockReason("");
    setLines([blankLine()]); setPayments({}); setReviewed(false); setError(""); setLocked(false);
    submitted.current = null; clientKey.current = crypto.randomUUID();
  };
  const save = async () => {
    if (inFlight.current || !isAdmin) return;
    if (branchChanged) { setError("Return to the branch where this entry was started before saving."); return; }
    if (!navigator.onLine) { setError("An online connection is required. Your form is retained; no offline transaction was queued."); return; }
    try {
      setError("");
      if (!submitted.current) {
        if (!reviewed) throw new Error("Confirm the customer already paid and the historical details are correct.");
        if (lines.some(line => !line.unitPrice.trim() || !line.unitCost.trim())) throw new Error("Enter the actual historical unit price and cost for every item, including zero where appropriate.");
        const occurredAt = posDateTimeToIso(date);
        if (Date.parse(occurredAt) > Date.now()) throw new Error("The original sale cannot be in the future.");
        const input = missedBillInput.safeParse({
          storeId: currentStore.id, clientKey: clientKey.current, originalReference: reference, occurredAt,
          cashierId: cashier, originalShiftId: shift === "none" ? null : shift, reason, stockHandling: stock, stockReason,
          items: lines.map(line => ({ productId: line.productId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), unitCost: Number(line.unitCost), discountAmount: Number(line.discountAmount), taxAmount: Number(line.taxAmount) })),
          payments: methods.flatMap(([method]) => Number(payments[method] || 0) > 0 ? [{ method, amount: Number(payments[method]) }] : []),
        });
        if (!input.success) throw new Error(input.error.issues[0]?.message ?? "Check the historical bill fields.");
        if (total <= 0 || Math.abs(total - paid) > 0.001) throw new Error("Received payments must equal the historical bill total exactly.");
        submitted.current = input.data;
        setLocked(true);
      }
      inFlight.current = true; setBusy(true);
      const result = await addMissedBill({ data: { ...submitted.current, ...await getPosCallerAuth() } });
      if (!result.ok) {
        if ("canEdit" in result && result.canEdit) { submitted.current = null; setLocked(false); }
        throw new Error(result.error);
      }
      toast.success(`Missed bill ${result.receiptNo} recorded. No new payment was collected.`);
      onSaved({ ...result, storeId: submitted.current.storeId });
      setOpen(false); reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Retry the same entry after reconnecting.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  if (!isAdmin) return null;
  return <>
    <Button variant="outline" onClick={() => { if (!submitted.current) { if (!sameBranchId(branchAtOpen.current, currentStore.id)) reset(); branchAtOpen.current = currentStore.id; } setOpen(true); }}><Plus className="size-4" />Add missed bill</Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Add missed bill · {currentStore.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Record an already-paid historical sale. Online connection required. This does not charge the customer, open the drawer or print automatically.</p>
        <p className="text-xs text-muted-foreground">The original shift is an audit reference only. Today's drawer and previously issued shift reports stay unchanged.</p>
        {branchChanged && <p role="alert" className="text-destructive">Branch changed. Return to the original branch before continuing.</p>}
        <fieldset disabled={busy || locked || branchChanged} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="space-y-1">Original date/time ({effectiveTimeZone()})<Input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></Label>
            <div className="space-y-1"><Label>Original cashier</Label><ThemedSelect value={cashier} onChange={setCashier} placeholder={cashiers.isFetching ? "Loading original cashiers…" : "Select original cashier"} ariaLabel="Original cashier" options={(cashiers.data ?? []).map(person => ({ value: person.userId, label: `${person.name} · ${person.userId}` }))} disabled={busy || locked || branchChanged || cashiers.isFetching} />
              {cashiers.isError && <div role="alert" className="text-xs text-destructive">{cashiers.error.message} <Button type="button" size="sm" variant="ghost" disabled={cashiers.isFetching} onClick={() => void cashiers.refetch()}>Retry cashiers</Button></div>}
              {cashiers.fetchStatus === "paused" && <p role="status" className="text-xs text-muted-foreground">Connect online to load the original cashier accounts.</p>}
              {cashiers.isSuccess && cashiers.data.length === 0 && <p role="status" className="text-xs text-muted-foreground">No active cashiers are assigned to this branch or all branches.</p>}
            </div>
            <Label className="space-y-1">Original paper/reference number (if available)<Input value={reference} maxLength={128} onChange={e => setReference(e.target.value)} /></Label>
            <div className="space-y-1"><Label>Original shift reference</Label><ThemedSelect value={shift} onChange={setShift} ariaLabel="Original shift reference" options={[{ value: "none", label: "Unknown / no shift reference" }, ...state.shifts.filter(s => sameBranchId(s.storeId, currentStore.id)).map(s => ({ value: s.id, label: `${s.openedAt} · ${s.status}` }))]} disabled={busy || locked || branchChanged} /></div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">Items · enter actual historical values, not today's prices</p>
            <p className="text-xs text-muted-foreground">Unit price excludes tax. Discount and tax are totals for the entire line, not per unit.</p>
            {lines.map((line, index) => <div key={line.key} className="space-y-2 rounded-md border p-3">
              <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><ThemedSelect value={line.productId} onChange={value => patchLine(line.key, "productId", value)} options={catalogue} placeholder="Search product / SKU / barcode" ariaLabel={`Product ${index + 1}`} disabled={busy || locked || branchChanged} /></div><Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))}><Trash2 className="size-4" /></Button></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{([["quantity", "Quantity"], ["unitPrice", "Unit price"], ["unitCost", "Unit cost"], ["discountAmount", "Line discount"], ["taxAmount", "Line tax"]] as const).map(([field, label]) => <Label key={field} className="space-y-1 text-xs">{label}<Input aria-label={`${label} item ${index + 1}`} type="number" min="0" step={field === "quantity" ? "1" : "0.01"} value={line[field]} onChange={e => patchLine(line.key, field, e.target.value)} /></Label>)}</div>
            </div>)}
            <Button type="button" size="sm" variant="outline" disabled={lines.length >= 500} onClick={() => setLines(previous => [...previous, blankLine()])}><Plus className="size-4" />Add item</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>Stock handling (required)</Label><ThemedSelect value={stock} onChange={setStock} placeholder="Choose stock handling" ariaLabel="Stock handling" options={[{ value: "deduct", label: "Deduct stock once — not yet recorded" }, { value: "already_corrected", label: "Stock already corrected — do not deduct" }]} disabled={busy || locked || branchChanged} /></div><Label className="space-y-1">Stock explanation / adjustment reference<Textarea value={stockReason} maxLength={500} onChange={e => setStockReason(e.target.value)} /></Label></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{methods.map(([method, label]) => <Label key={method} className="space-y-1">{label} already received<Input type="number" min="0" step="0.01" value={payments[method] ?? ""} onChange={e => setPayments(previous => ({ ...previous, [method]: e.target.value }))} /></Label>)}</div>
          <Label className="block space-y-1">Reason for late entry<Textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></Label>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={reviewed} onCheckedChange={checked => setReviewed(checked === true)} disabled={busy || locked || branchChanged} className="mt-1" aria-label="Historical details and prior payment verified" />I checked history for duplicate bills and verified the customer already paid, received the goods, and these are the original sale details.</label>
        </fieldset>
        <div className="flex flex-wrap justify-between gap-2 rounded-md bg-muted p-3 text-sm"><span>Bill total: <strong>{money(Number.isFinite(total) ? total : 0)}</strong></span><span>Payments recorded: <strong>{money(Number.isFinite(paid) ? paid : 0)}</strong></span></div>
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        {locked && <p role="status" className="text-xs text-muted-foreground">This entry is locked after submission. Retry sends the exact same bill to prevent duplicate stock or payments. Closing retains this form for retry.</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button><Button disabled={busy || branchChanged || (!locked && (cashiers.isPending || cashiers.isError))} onClick={() => void save()}>{busy ? "Saving historical bill…" : locked ? "Retry same entry" : "Save missed bill"}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
