import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/pos-auth";
import { isTerminalApp } from "@/platform-config/platform";
import { adminActivationRequest, readAdminBrowserProof, writeAdminBrowserProof, type AdminActivation } from "@/lib/admin-web-activation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";

export function AdminWebActivations() {
  const { isAdmin, authUserId } = useAuth();
  if (!isAdmin || !authUserId || isTerminalApp()) return null;
  return <AdminWebActivationPanel userId={authUserId} />;
}
function AdminWebActivationPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<AdminActivation[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { setRows(await adminActivationRequest<AdminActivation[]>("list")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load admin activations"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Admin activation failed"); }
    finally { setBusy(false); }
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
  return <section className="space-y-4 rounded-xl border p-4">
    <div><h2 className="text-lg font-semibold">Admin Web Activation</h2><p className="text-sm text-muted-foreground">Register your admin browser using a one-time code. Records stay in the cloud and are not synchronized to Windows or mobile databases. Admin sign-in is still required.</p></div>
    <div className="flex flex-wrap gap-2"><Input aria-label="Admin browser name" placeholder="Device name, e.g. Office admin browser" maxLength={100} value={name} onChange={e => setName(e.target.value)} className="min-w-48 flex-1" /><Button disabled={busy || !name.trim()} onClick={() => void run(async () => { const result = await adminActivationRequest<{id:string;code:string}>("issue", {p_device_name:name}); setIssued(`AW1:${result.id}:${result.code}`); })}>Create my activation code</Button><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh</Button></div>
    {issued && <div className="space-y-2 rounded-lg bg-muted p-3"><p className="text-sm">Use this code within 15 minutes, signed in as the same admin. It is shown only here.</p><Input aria-label="New admin activation code" readOnly value={issued}/><Button variant="outline" onClick={() => void navigator.clipboard.writeText(issued).then(() => toast.success("Code copied")).catch(() => toast.error("Select and copy the code manually"))}>Copy code</Button></div>}
    <div className="flex flex-wrap gap-2"><Input aria-label="Admin activation code" placeholder="Paste your AW1 activation code" value={code} onChange={e => setCode(e.target.value)} className="min-w-48 flex-1"/><Button disabled={busy || !code.trim()} onClick={() => void run(async () => {
      const match = /^AW1:([0-9a-f-]{36}):([0-9a-f]{64})$/i.exec(code.trim());
      if (!match) throw new Error("Enter a valid admin web activation code");
      const previous = readAdminBrowserProof(userId);
      const next = {id:match[1], proof:crypto.randomUUID()+crypto.randomUUID()};
      // Prove browser storage works before consuming the single-use code.
      writeAdminBrowserProof(userId,{...next,pending:true});
      try { await adminActivationRequest("claim",{p_id:next.id,p_code:match[2],p_proof:next.proof}); }
      catch (reason) {
        // The claim may have committed before its response was lost.
        const confirmed = await adminActivationRequest<{ok:boolean}>("heartbeat",{p_id:next.id,p_proof:next.proof}).catch(() => null);
        if (confirmed?.ok === false) { writeAdminBrowserProof(userId,previous); throw reason; }
        if (!confirmed) { writeAdminBrowserProof(userId,next); throw reason; }
      }
      writeAdminBrowserProof(userId,next);
      setCode(""); toast.success("This admin browser is activated");
    })}>{busy ? "Working…" : "Activate this browser"}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Table managed><TableHeader><TableRow><TableHead>Admin</TableHead><TableHead>Device</TableHead><TableHead>Status</TableHead><TableHead>Activated</TableHead><TableHead>Last active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell>{row.adminEmail}</TableCell><TableCell>{row.deviceName}</TableCell><TableCell>{row.revokedAt ? "Revoked" : row.activatedAt ? "Active" : Date.parse(row.expiresAt) < Date.now() ? "Expired" : "Awaiting activation"}</TableCell><TableCell>{date(row.activatedAt)}</TableCell><TableCell>{date(row.lastSeenAt)}</TableCell><TableCell><Button variant="outline" size="sm" disabled={busy || !!row.revokedAt} onClick={() => void run(async () => { await adminActivationRequest("revoke", {p_id:row.id}); toast.success("Admin browser revoked"); })}>Revoke</Button></TableCell></TableRow>)}</TableBody></Table>
  </section>;
}
