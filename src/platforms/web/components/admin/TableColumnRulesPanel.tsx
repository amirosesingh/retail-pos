import { useEffect, useMemo, useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { TABLE_CATALOG } from "@/lib/table-catalog";
import { tableColumnHidden, withTableColumnRule } from "@/lib/table-column-policy";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { readCredentials } from "@/lib/pos-credentials";
import { listManagedStaffAccounts } from "@/lib/staff-admin-client";

type RoleChoice = { slug: string; name: string };
type StaffChoice = { user_id: string; full_name: string };

/** Admin-controlled presentation rules; action permissions remain authoritative. */
export function TableColumnRulesPanel({ roles }: { roles: RoleChoice[] }) {
  const { isAdmin } = useAuth();
  const { state, updateGlobalSettings } = usePos();
  const [open, setOpen] = useState(false);
  const [tableId, setTableId] = useState<string>(TABLE_CATALOG[0]?.id ?? "");
  const [scopeKind, setScopeKind] = useState<"all" | "role" | "user">("all");
  const [scopeId, setScopeId] = useState("");
  const [staff, setStaff] = useState<StaffChoice[]>([]);
  const [staffError, setStaffError] = useState("");
  const table = useMemo(() => TABLE_CATALOG.find(row => row.id === tableId), [tableId]);
  const scope = scopeKind === "all" ? "all" : scopeId ? `${scopeKind}:${scopeId}` : "";
  const rules = (state.settings.visibility?.hidden ?? {}) as Record<string, string[]>;

  useEffect(() => {
    if (!open || scopeKind !== "user" || staff.length || staffError) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await listManagedStaffAccounts({ data: await readCredentials() });
        if (!cancelled) {
          if (!result.ok) setStaffError(result.error || "Accounts could not be loaded.");
          else setStaff(result.rows.map(row => ({ user_id: row.user_id, full_name: row.full_name })));
        }
      } catch {
        if (!cancelled) setStaffError("Accounts could not be loaded.");
      }
    })();
    return () => { cancelled = true; };
  }, [open, scopeKind, staff.length, staffError]);

  if (!isAdmin) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Columns3 className="mr-2 size-4" />Table columns</Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>Table columns</DialogTitle><DialogDescription>Choose a table and set visible columns for everyone, a role, or one person. Existing data permissions still control access.</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Table
          <select aria-label="Table" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={tableId} onChange={event => setTableId(event.target.value)}>
            {TABLE_CATALOG.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">Applies to
          <select aria-label="Applies to" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={scopeKind} onChange={event => { setScopeKind(event.target.value as typeof scopeKind); setScopeId(""); }}>
            <option value="all">All users</option><option value="role">A role</option><option value="user">One user</option>
          </select>
        </label>
      </div>
      {scopeKind === "role" && <select aria-label="Role" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={scopeId} onChange={event => setScopeId(event.target.value)}><option value="">Select role</option>{roles.map(role => <option key={role.slug} value={role.slug}>{role.name}</option>)}</select>}
      {scopeKind === "user" && <><select aria-label="User" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={scopeId} onChange={event => setScopeId(event.target.value)}><option value="">Select user</option>{staff.map(person => <option key={person.user_id} value={person.user_id}>{person.full_name} · {person.user_id}</option>)}</select>{staffError && <p className="text-xs text-destructive">{staffError}</p>}</>}
      <div className="space-y-1 rounded-lg border p-2">
        {(table?.columns ?? []).map((label, column) => {
          const fixed = column === 0 || /^(actions?|open)$/i.test(label);
          const hidden = !!scope && tableColumnHidden(rules, tableId, column, scopeKind === "role" ? scopeId : null, scopeKind === "user" ? scopeId : null);
          const specificallyHidden = !!scope && (rules[`table:${tableId}:${column}`] ?? []).includes(scope);
          return <label key={column} className="flex min-h-9 items-center justify-between gap-2 rounded-md px-2 text-sm hover:bg-muted/40">
            <span>{label}{fixed && <span className="ml-1 text-xs text-muted-foreground">required</span>}{hidden && !specificallyHidden && <span className="ml-1 text-xs text-muted-foreground">hidden by all-user rule</span>}</span>
            <Switch aria-label={`Show ${label}`} checked={!specificallyHidden} disabled={!scope || fixed} onCheckedChange={checked => updateGlobalSettings({ visibility: { hidden: withTableColumnRule(rules, tableId, column, scope, !checked) } })} />
          </label>;
        })}
      </div>
    </DialogContent>
  </Dialog>;
}
