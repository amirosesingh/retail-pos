import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { VISIBILITY_ELEMENTS, userElementVisible, type VisibilityMap } from "@/lib/ui-visibility";
import { TABLE_CATALOG } from "@/lib/table-catalog";
import { tableColumnHidden, tableColumnKey } from "@/lib/table-column-policy";
import { PERMISSION_PAGES } from "@/lib/permission-pages";
import { PERMISSION_LABELS, type StaffPermissions } from "@/lib/permissions";

export function UserDisplayPermissions({ permissions, onChange, hidden, role, userId, admin, busy, search }: {
  permissions: StaffPermissions; onChange: (next: StaffPermissions) => void;
  hidden: VisibilityMap; role: string; userId: string; admin: boolean; busy: boolean; search: string;
}) {
  const query = search.trim().toLowerCase();
  const set = (key: string, shown: boolean) => onChange({ ...permissions, [`display:${key}`]: shown });
  const inherit = (key: string) => { const next = { ...permissions }; delete next[`display:${key}`]; onChange(next); };
  const elements = VISIBILITY_ELEMENTS.filter(item =>
    !PERMISSION_PAGES.some(page => page.routes.includes(item.route ?? "")) &&
    `${item.label} ${item.group} ${item.blurb}`.toLowerCase().includes(query));
  return <div className="space-y-4">
    <section className="rounded-xl border p-4" aria-label="Management device access">
      <h3 className="font-semibold">Management device access</h3>
      <p className="my-3 text-xs text-muted-foreground">Allow this person to sign in on registered management devices. Their page, action and branch permissions still apply. This does not allow device registration or settings changes.</p>
      {(["can_use_management_pc", "can_use_management_mobile"] as const).map(key => <label key={key} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{PERMISSION_LABELS[key]}</span><Switch aria-label={PERMISSION_LABELS[key]} checked={admin || permissions[key] === true} disabled={admin || busy} onCheckedChange={allowed => onChange({ ...permissions, [key]: allowed })} /></label>)}
    </section>
    <details className="rounded-xl border p-4" open={query ? true : undefined}>
      <summary className="cursor-pointer font-semibold">Settings subpages &amp; screen elements</summary>
      <p className="my-3 text-xs text-muted-foreground">These choices save with this account. Inherited choices retain existing role defaults. Showing an element still requires its action permissions; owner-only controls remain protected.</p>
      {elements.map(item => <div key={item.key} className="flex items-start justify-between gap-3 border-t py-3 text-sm">
        <div><p>{item.label}</p><p className="text-xs text-muted-foreground">{item.group} · {typeof permissions[`display:${item.key}`] === "boolean" ? "User override" : "Inherited"}{item.lock === "core" ? " · Owner only" : ""}</p></div>
        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" disabled={admin || busy || permissions[`display:${item.key}`] === undefined} onClick={() => inherit(item.key)}>Inherit</Button><Switch aria-label={`Show ${item.label}`} checked={admin || userElementVisible(hidden, item.key, role, permissions)} disabled={admin || busy || item.lock === "core"} onCheckedChange={shown => set(item.key, shown)} /></div>
      </div>)}
    </details>
    <details className="rounded-xl border p-4" open={query ? true : undefined}>
      <summary className="cursor-pointer font-semibold">Table columns &amp; visible information</summary>
      <p className="my-3 text-xs text-muted-foreground">Control which available columns this person sees. Company-wide column blocks and sensitive-data permissions still apply.</p>
      {TABLE_CATALOG.filter(table => `${table.title} ${table.columns.join(" ")}`.toLowerCase().includes(query)).map(table => <details className="border-t py-2" key={table.id}><summary className="cursor-pointer text-sm">{table.title}</summary><div className="grid gap-3 py-3 sm:grid-cols-2">{table.columns.map((label, index) => {
        const key = tableColumnKey(table.id, index);
        const globalBlock = (hidden[key] ?? []).includes("all");
        return <label key={index} className="flex items-center justify-between gap-2 text-xs"><span>{label}{globalBlock ? " · Globally hidden" : typeof permissions[`display:${key}`] === "boolean" ? " · User override" : " · Inherited"}</span><Switch aria-label={`${table.title}: show ${label}`} checked={!globalBlock && (admin || !tableColumnHidden(hidden, table.id, index, role, userId, permissions))} disabled={admin || busy || globalBlock} onCheckedChange={shown => set(key, shown)} /></label>;
      })}</div></details>)}
    </details>
  </div>;
}
