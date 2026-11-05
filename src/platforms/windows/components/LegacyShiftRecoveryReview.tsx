import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/pos-auth";

type Summary = { status: string; openedAt: string | null; closedAt: string | null; countedCash: string | null; countedCard: string | null;
  countedDigital: string | null; expectedCash: string | null; expectedCard: string | null; expectedDigital: string | null };
type Item = { shiftId: string; status: string; openedAt: string | null; closedAt: string | null };
type Reply = { ok: boolean; error?: string; code?: string };
type List = Reply & { available: boolean; items: Item[]; nextAfterId?: string | null };
type Preview = Reply & { shiftId: string; captureKey: string; classification: string; canApprove: boolean; canAcceptCloud?: boolean; local: Summary; cloud: Summary };
type Api = { list(options: { afterId?: string | null; limit?: number }): Promise<List>; preview(shiftId: string): Promise<Preview>;
  approve(value: { captureKey: string; recoveryId: string; reason: string }): Promise<Reply & { state?: string }>;
  acceptCloud?(value: { captureKey: string; decisionId: string; reason: string }): Promise<Reply & { state?: string; checkpointAdvanced?: boolean; downloadRecoveryComplete?: boolean }> };
const api = () => typeof window === "undefined" ? undefined : (window.pos as unknown as { sync?: { legacyRecovery?: Api } })?.sync?.legacyRecovery;
const requireOk = <T extends Reply>(reply: T): T => { if (!reply || reply.ok !== true) throw Object.assign(new Error(reply?.error ?? "Saved shift recovery could not be read."), { code: reply?.code }); return reply; };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const invalid = () => { throw new Error("The saved shift response is incomplete. Update or reconnect this app before reviewing it."); };
function readList(reply: List): List {
  requireOk(reply);
  if (typeof reply.available !== "boolean" || !Array.isArray(reply.items) || !reply.items.every(item => item && UUID.test(item.shiftId) &&
      typeof item.status === "string" && textOrNull(item.openedAt) && textOrNull(item.closedAt)) ||
      (reply.nextAfterId != null && !UUID.test(reply.nextAfterId)) || (!reply.available && reply.items.length !== 0)) invalid();
  return reply;
}
function readPreview(reply: Preview): Preview {
  requireOk(reply);
  const fields: Array<keyof Summary> = ["openedAt", "closedAt", "countedCash", "countedCard", "countedDigital", "expectedCash", "expectedCard", "expectedDigital"];
  if (!UUID.test(reply.shiftId) || !/^[a-f0-9]{64}$/.test(reply.captureKey) || typeof reply.classification !== "string" || typeof reply.canApprove !== "boolean" ||
      [reply.local, reply.cloud].some(summary => !summary || typeof summary.status !== "string" || fields.some(field => !textOrNull(summary[field]))) ||
      (reply.canApprove && reply.classification !== "legacy-local-closing-needs-review") || (reply.canAcceptCloud !== undefined && typeof reply.canAcceptCloud !== "boolean")) invalid();
  return reply;
}
const amount = (value: string | null) => value === null ? "Not recorded" : value;

export function LegacyShiftRecoveryReview() {
  const { isAdmin, user, authUserId } = useAuth();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [list, setList] = useState<List | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const sequence = useRef(0), recoveryId = useRef<string | null>(null);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    invalidate(); setOpen(false); setBusy(false); setList(null); setPreview(null); setReason(""); setError(null); setMessage(null); recoveryId.current = null;
    return invalidate;
  }, [isAdmin, user?.staffId, authUserId, invalidate]);
  if (!isAdmin || !api()) return null;
  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (busy) return;
    const request = ++sequence.current, current = () => request === sequence.current;
    setBusy(true); setError(null); setMessage(null);
    try { await work(current); }
    catch (cause) { if (current()) {
      if (cause && typeof cause === "object" && "code" in cause && ["EREVIEWED_SOURCE_CHANGED", "ELEGACY_RECOVERY_REVIEW_CHANGED"].includes(String(cause.code))) { setPreview(null); setReason(""); recoveryId.current = null; }
      setError(cause instanceof Error ? cause.message : "Saved shift recovery could not complete.");
    } }
    finally { if (current()) setBusy(false); }
  };
  const load = (afterId: string | null = null) => run(async current => {
    const result = readList(await api()!.list({ afterId, limit: 25 }));
    if (current()) {
      if (!result.available) { setPreview(null); setReason(""); recoveryId.current = null; }
      setList(previous => afterId && previous && result.available ? { ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.shiftId === item.shiftId))] } : result);
    }
  });
  const inspect = (shiftId: string) => run(async current => {
    setPreview(null); setReason(""); recoveryId.current = null;
    const result = readPreview(await api()!.preview(shiftId));
    if (result.shiftId !== shiftId) invalid();
    if (current()) { setPreview(result); recoveryId.current = crypto.randomUUID(); }
  });
  const approve = () => run(async current => {
    if (!preview?.canApprove || !recoveryId.current || reason.trim().length < 3) return;
    const result = requireOk(await api()!.approve({ captureKey: preview.captureKey, recoveryId: recoveryId.current, reason: reason.trim() }));
    if (result.state !== "PENDING") throw new Error("The saved recovery state was not confirmed. Review synchronization before retrying.");
    if (current()) { setMessage("Review saved in SQL Server for background synchronization. Cloud acceptance is not yet confirmed."); setPreview(value => value ? { ...value, canApprove: false } : null); }
  });
  const acceptCloud = () => run(async current => {
    if (!preview?.canAcceptCloud || !recoveryId.current || reason.trim().length < 3 || !api()?.acceptCloud) return;
    const result = requireOk(await api()!.acceptCloud!({ captureKey: preview.captureKey, decisionId: recoveryId.current, reason: reason.trim() }));
    if (result.state !== "ADOPTED" || result.checkpointAdvanced !== false || result.downloadRecoveryComplete !== false) throw new Error("The local recovery decision was not confirmed. Refresh the comparison before retrying.");
    if (current()) { setMessage("The reviewed record is confirmed locally and your decision is saved. All retained shifts must still pass normal database recovery before trading resumes."); setPreview(value => value ? { ...value, canAcceptCloud: false } : null); }
  });
  const rows: Array<[string, keyof Summary]> = [["Status", "status"], ["Opened", "openedAt"], ["Closed", "closedAt"], ["Counted cash", "countedCash"],
    ["Counted card", "countedCard"], ["Counted digital", "countedDigital"], ["Expected cash", "expectedCash"], ["Expected card", "expectedCard"], ["Expected digital", "expectedDigital"]];
  return <>
    <Button type="button" variant="outline" onClick={() => { setPreview(null); setList(null); setReason(""); recoveryId.current = null; setOpen(true); void load(); }}>Review saved closings</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { sequence.current++; setBusy(false); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Saved shift recovery</DialogTitle><DialogDescription>Compare this terminal’s saved shifts with the cloud. No shift changes are made by opening this review.</DialogDescription></DialogHeader>
        {busy ? <p role="status" className="text-sm text-muted-foreground">Reading saved recovery records…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {list?.available === false ? <p className="text-sm">This database needs the reviewed recovery metadata upgrade before saved closings can be reviewed. Existing shifts have not been changed.</p> : null}
        {list?.available ? <div className="max-h-44 space-y-1 overflow-y-auto" aria-label="Saved shifts">
          {list.items.map(item => <button type="button" key={item.shiftId} disabled={busy} onClick={() => void inspect(item.shiftId)}
            className="flex w-full flex-wrap items-center justify-between gap-x-3 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50">
            <span>{item.openedAt ?? "Opening time not recorded"}</span><span>{item.status} · {item.shiftId.slice(0, 8)}</span>
          </button>)}
          {!list.items.length ? <p className="text-sm text-muted-foreground">No shifts are listed for this registered terminal.</p> : null}
          {list.nextAfterId ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void load(list.nextAfterId!)}>More shifts</Button> : null}
        </div> : null}
        {preview ? <section className="space-y-3" aria-label="Closing comparison">
          <p className="break-all text-xs text-muted-foreground">Shift {preview.shiftId}</p>
          <div className="grid gap-3 sm:grid-cols-2">{([["Local SQL Server", preview.local], ["Cloud", preview.cloud]] as const).map(([title, summary]) =>
            <div key={title} className="min-w-0 rounded-md border p-3"><h3 className="mb-2 text-sm font-semibold">{title}</h3><dl className="space-y-1 text-xs">
              {rows.map(([label, field]) => <div key={field} className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-right tabular-nums">{amount(summary[field])}</dd></div>)}
            </dl></div>)}</div>
          {preview.canApprove ? <>
            <p className="text-sm">This is an older saved closing whose original financial snapshot is unavailable. Administrator review preserves the original cashier’s details and records your reason; it does not certify the missing snapshot.</p>
            <div className="space-y-1"><Label htmlFor="legacy-closing-reason">Administrator review reason</Label><Input id="legacy-closing-reason" maxLength={400} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>
            <Button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void approve()}>Save reviewed recovery</Button>
          </> : preview.canAcceptCloud && api()?.acceptCloud ? <>
            <p className="text-sm">{preview.classification === "exact" ? "Confirm this matching saved record for recovery in your current Administrator session. This records your reason without rewriting matching business data. A restart or later local edit requires fresh verification." : "Choose the currently saved cloud record for this terminal. The full previous local record is preserved in recovery evidence. A later local edit or pending upload will hold this action for review."}</p>
            <div className="space-y-1"><Label htmlFor="cloud-closing-reason">Administrator decision reason</Label><Input id="cloud-closing-reason" maxLength={400} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>
            <Button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void acceptCloud()}>{preview.classification === "exact" ? "Confirm matching record for recovery" : "Use reviewed cloud closing locally"}</Button>
          </> : <p className="text-sm text-muted-foreground">{preview.classification === "exact" ? "These saved records match. No recovery upload is needed." : "This comparison is held for review. This action will not overwrite a cloud correction or replace either saved history."}</p>}
        </section> : null}
      </DialogContent>
    </Dialog>
  </>;
}
