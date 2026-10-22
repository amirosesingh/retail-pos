import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { useAuth } from "@/lib/pos-auth";
import { PERMISSION_GROUPS, PERMISSION_LABELS } from "@/lib/permissions";
import { PERMISSION_PAGES, pageKey } from "@/lib/permission-pages";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { notifyError } from "@/lib/notify";
import { broadcastSettingsChange } from "@/lib/sync-engine";
import { toast } from "sonner";

export function GlobalRestrictionPanel() {
  const { isAdmin } = useAuth();
  const [denied, setDenied] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const client = supabaseExternal as unknown as SupabaseClient;
    void Promise.resolve(client.rpc("global_permission_restrictions")).then(({ data, error }) => {
      if (!active) return;
      if (error) { setError("Global restrictions could not be loaded. Check the connection and that the permissions migration is installed."); return; }
      if (!Array.isArray(data) || data.some(key => typeof key !== "string")) {
        setError("The server returned an invalid restriction policy."); return;
      }
      setDenied(data); setSaved(data); setReady(true);
    }).catch(() => { if (active) setError("Global restrictions could not be loaded. Check the connection."); });
    return () => { active = false; };
  }, [isAdmin]);
  if (!isAdmin) return null;
  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const { data, error } = await (supabaseExternal as unknown as SupabaseClient)
        .rpc("set_global_permission_restrictions", { p_denied: denied });
      if (error) throw error;
      if (!Array.isArray(data) || data.some(key => typeof key !== "string")) throw new Error("Invalid saved policy response");
      setDenied(data); setSaved(data);
      toast.success("Global restrictions saved");
      // Existing account-change subscribers refresh verified permissions. Offline
      // Windows tills receive the same effective matrices through normal SQL sync.
      try { await broadcastSettingsChange("app_users"); }
      catch { toast.warning("Saved centrally; connected terminals will refresh on their next permission check."); }
    } catch (error) { notifyError(error, "Global restrictions could not be saved"); }
    finally { setBusy(false); }
  };
  const dirty = [...denied].sort().join("|") !== [...saved].sort().join("|");
  return <details className="rounded-xl border border-border p-4">
    <summary className="cursor-pointer text-sm font-semibold">Global restrictions · {ready ? `${denied.length} blocked` : error ? "unavailable" : "loading"}</summary>
    <p className="mt-3 text-xs text-muted-foreground">Checked actions are blocked for every non-administrator, even when a role or user grants them. Existing branch restrictions remain. Offline terminals enforce the last synchronized policy until they reconnect.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {!ready && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading restrictions…</p>}
    {ready && <div className="mt-4 space-y-3"><details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">Pages</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{PERMISSION_PAGES.map(page => <label key={page.id} className="flex items-start gap-2 text-sm">
        <Checkbox checked={denied.includes(pageKey(page.id))} disabled={busy} aria-label={"Globally block page " + page.label}
          onCheckedChange={checked => setDenied(current => checked === true ? [...new Set([...current, pageKey(page.id)])] : current.filter(value => value !== pageKey(page.id)))} />
        <span>{page.label}</span>
      </label>)}</div>
    </details>{PERMISSION_GROUPS.map(group => <details key={group.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">{group.label}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{group.keys.map(key => <label key={key} className="flex items-start gap-2 text-sm">
        <Checkbox checked={denied.includes(key)} disabled={busy} aria-label={`Globally block ${PERMISSION_LABELS[key]}`}
          onCheckedChange={checked => setDenied(current => checked === true ? [...new Set([...current, key])] : current.filter(value => value !== key))} />
        <span>{PERMISSION_LABELS[key]}</span>
      </label>)}</div>
    </details>)}<Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save global restrictions"}</Button></div>}
  </details>;
}
