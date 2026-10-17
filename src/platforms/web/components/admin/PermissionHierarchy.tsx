import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { PERMISSION_PAGES, pageEnabled, setPageFeatures, setPageVisibility } from "@/lib/permission-pages";
import { PERMISSION_LABELS, type PermissionKey, type StaffPermissions } from "@/lib/permissions";
import { PERMISSION_SECTIONS, permissionPageLabel, permissionSubpages, permissionPageMatches, permissionRelatedKeys, sectionVisibility, setSectionVisibility } from "@/lib/permission-editor";

type Props = {
  permissions: StaffPermissions;
  onChange: (permissions: StaffPermissions) => void;
  admin: boolean;
  busy: boolean;
  search: string;
  expanded: Set<string>;
  onExpandedChange: (expanded: Set<string>) => void;
};

export function PermissionHierarchy({ permissions, onChange, admin, busy, search, expanded, onExpandedChange }: Props) {
  const query = search.trim().toLowerCase();
  const toggle = (id: string) => { const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id); onExpandedChange(next); };
  const disabled = admin || busy;
  const sections = PERMISSION_SECTIONS.map(section => ({ ...section, pages: PERMISSION_PAGES.filter(page => section.pageIds.includes(page.id) && (!query || section.label.toLowerCase().includes(query) || permissionPageMatches(page.id, query))) })).filter(section => section.pages.length);
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Main section → page → visible information and allowed actions. Page visibility does not grant actions. Shared controls affect every page using that permission. Branch assignments are unchanged.</p>
    {!sections.length && <p role="status" className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No matching pages or permissions.</p>}
    {sections.map(section => {
      const sectionId = `section:${section.id}`;
      const open = !!query || expanded.has(sectionId);
      const visible = admin ? section.pageIds.length : section.pageIds.filter(id => pageEnabled(permissions, id)).length;
      return <section key={section.id} aria-label={`${section.label} permission section`} className="overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/25 p-4">
          <button type="button" className="flex min-w-0 items-center gap-2 text-left font-semibold" aria-expanded={open} onClick={() => toggle(sectionId)}>{open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}{section.label}</button>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={admin || sectionVisibility(permissions, section)} disabled={disabled} aria-label={`${section.label}: all page visibility`} onCheckedChange={checked => onChange(setSectionVisibility(permissions, section, checked === true))} />All pages · {visible}/{section.pageIds.length}</label>
        </div>
        {open && <div className="space-y-3 border-t border-border p-3 sm:p-4">
          {section.pages.map(page => {
            const label = permissionPageLabel(page);
            const pageOpen = !!query || expanded.has(page.id);
            const enabled = admin || pageEnabled(permissions, page.id);
            const subpages = permissionSubpages(page.id);
            const related = permissionRelatedKeys(page.id);
            return <section key={page.id} aria-label={`${label} permissions`} className="rounded-lg border border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <button type="button" className="flex min-w-0 items-center gap-2 text-left text-sm font-medium" aria-expanded={pageOpen} onClick={() => toggle(page.id)}>{pageOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}{label}</button>
                <label className="flex items-center gap-2 text-xs">Open page<Switch checked={enabled} disabled={disabled} aria-label={`${label} page visibility`} onCheckedChange={checked => onChange(setPageVisibility(permissions, page.id, checked))} /></label>
              </div>
              {pageOpen && <div className="space-y-4 border-t border-border/70 p-3 sm:p-4">
                {subpages.length > 0 && <div className="space-y-2"><h4 className="text-xs font-semibold text-muted-foreground">Subpages sharing this page access</h4><ul className="grid gap-2 sm:grid-cols-2">{subpages.map(item => <li key={`${item.path}#${item.hash ?? ""}`} className="min-w-0 rounded-lg bg-muted/20 px-3 py-2 text-sm"><span className="break-words">{item.label}</span><span className="block break-all text-xs text-muted-foreground">{item.path}{item.hash ? `#${item.hash}` : ""}</span></li>)}</ul><p className="text-xs text-muted-foreground">These subpages share existing access and action checks; they do not have independent grants.</p></div>}
                {!enabled ? <p className="text-xs text-muted-foreground">Page access is off. Selected permissions are preserved; shared actions can still work on other enabled pages.</p> : <>
                  {!!page.keys.length && <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Permissions for {label}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(setPageFeatures(permissions, page.id, true))}>Select all</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(setPageFeatures(permissions, page.id, false))}>Deselect all</Button></div></div>}
                  {(["Visible information", "Allowed actions"] as const).map(heading => {
                    const isView = (key: PermissionKey) => key.startsWith("can_view_") || key.endsWith("_view");
                    const keys = page.keys.filter(key => (heading === "Visible information") === isView(key));
                    return keys.length ? <div key={heading} className="space-y-3"><h4 className="text-sm font-semibold">{heading}</h4><div className="grid gap-3 sm:grid-cols-2">{keys.map(key => {
                      const shared = PERMISSION_PAGES.filter(owner => owner.id !== page.id && owner.keys.includes(key));
                      return <label key={key} className="flex min-w-0 items-start gap-3 text-sm"><Checkbox className="mt-0.5 shrink-0" checked={admin || permissions[key]} disabled={disabled} onCheckedChange={checked => onChange({ ...permissions, [key]: checked === true })} /><span className="min-w-0 break-words">{PERMISSION_LABELS[key]}{shared.length > 0 && <span className="mt-1 block text-xs text-muted-foreground">Shared with {shared.map(permissionPageLabel).join(", ")}</span>}</span></label>;
                    })}</div></div> : null;
                  })}
                  {related.length > 0 && <div className="space-y-3 rounded-lg border border-dashed p-3">
                    <h4 className="text-sm font-semibold">Related shared controls</h4>
                    <p className="text-xs text-muted-foreground">These existing permissions are also used here. Changes apply on their other pages too; existing page access checks still apply. Select all above affects only this page’s own permissions.</p>
                    <div className="grid gap-3 sm:grid-cols-2">{related.map(key => <label key={key} className="flex min-w-0 items-start gap-3 text-sm"><Checkbox className="mt-0.5 shrink-0" checked={admin || permissions[key]} disabled={disabled} onCheckedChange={checked => onChange({ ...permissions, [key]: checked === true })} /><span className="min-w-0 break-words">{PERMISSION_LABELS[key]}<span className="mt-1 block text-xs text-muted-foreground">Shared with {PERMISSION_PAGES.filter(owner => owner.keys.includes(key)).map(permissionPageLabel).join(", ")}</span></span></label>)}</div>
                  </div>}
                  {page.id === "approvals" && <p className="text-xs text-muted-foreground">Who can approve each action is also governed by the existing authorization rules and branch scope.</p>}
                  {!page.keys.length && !related.length && <p className="text-xs text-muted-foreground">This page has no separate configurable actions.</p>}
                </>}
              </div>}
            </section>;
          })}
        </div>}
      </section>;
    })}
  </div>;
}
