import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { permissionDisplayMatches } from "@/lib/permission-display-groups";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { PERMISSION_PAGES, pageEnabled, setPageVisibility } from "@/lib/permission-pages";
import { PERMISSION_LABELS, hasPermission, type PermissionKey, type StaffPermissions } from "@/lib/permissions";
import { permissionPageEntryKeys, grantPageEntry } from "@/lib/permission-editor";
import { userRouteVisible, withPageDisplayAccess, type VisibilityMap } from "@/lib/ui-visibility";
import { PERMISSION_SECTIONS, permissionPageLabel, permissionSubpages, permissionPageMatches, permissionEditableKeys, permissionReferenceKeys, permissionControlOwner, setEditablePageFeatures, sectionVisibility, setSectionVisibility } from "@/lib/permission-editor";

type Props = {
  permissions: StaffPermissions;
  onChange: (permissions: StaffPermissions) => void;
  admin: boolean;
  busy: boolean;
  search: string;
  expanded: Set<string>;
  onExpandedChange: (expanded: Set<string>) => void;
  displayRole?: string;
  hidden?: VisibilityMap;
  renderPageDetails?: (id: string) => ReactNode;
};

export function PermissionHierarchy({ permissions, onChange, admin, busy, search, expanded, onExpandedChange, displayRole, hidden = {}, renderPageDetails }: Props) {
  const query = search.trim().toLowerCase();
  const toggle = (id: string) => { const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id); onExpandedChange(next); };
  const disabled = admin || busy;
  const sections = PERMISSION_SECTIONS.map(section => ({ ...section, pages: PERMISSION_PAGES.filter(page => section.pageIds.includes(page.id) && (!query || section.label.toLowerCase().includes(query) || permissionPageMatches(page.id, query) || permissionDisplayMatches(page.id, query))) })).filter(section => section.pages.length);
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Main section → page → visible information and allowed actions. Page visibility does not grant actions. Each permission has one editable home; references open that control. Branch assignments are unchanged.</p>
    {!sections.length && <p role="status" className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No matching pages or permissions.</p>}
    {sections.map(section => {
      const sectionId = `section:${section.id}`;
      const open = !!query || expanded.has(sectionId);
      const visible = admin ? section.pageIds.length : section.pageIds.filter(id => pageEnabled(permissions, id)).length;
      return <section key={section.id} aria-label={`${section.label} permission section`} className="overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/25 p-4">
          <button type="button" className="flex min-w-0 items-center gap-2 text-left font-semibold" aria-expanded={open} onClick={() => toggle(sectionId)}>{open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}{section.label}</button>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={admin || sectionVisibility(permissions, section)} disabled={disabled} aria-label={`${section.label}: all page visibility`} onCheckedChange={checked => onChange(section.pages.reduce((next, page) => withPageDisplayAccess(next, page.routes, checked === true), setSectionVisibility(permissions, section, checked === true)))} />All pages · {visible}/{section.pageIds.length}</label>
        </div>
        {open && <div className="space-y-3 border-t border-border p-3 sm:p-4">
          {section.pages.map(page => {
            const label = permissionPageLabel(page);
            const pageOpen = !!query || expanded.has(page.id);
            const enabled = admin || pageEnabled(permissions, page.id);
            const subpages = permissionSubpages(page.id);
            const related = permissionReferenceKeys(page.id);
            const editable = permissionEditableKeys(page.id);
            const entryKeys = permissionPageEntryKeys(page.id);
            const missingEntry = entryKeys.filter(key => !hasPermission(permissions, key));
            const restricted = displayRole && !admin ? [...page.routes.map(path => ({ path, label })), ...subpages]
              .filter(item => !userRouteVisible(hidden, item.path, displayRole, permissions)) : [];
            return <section key={page.id} aria-label={`${label} permissions`} className="rounded-lg border border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <button type="button" className="flex min-w-0 items-center gap-2 text-left text-sm font-medium" aria-expanded={pageOpen} onClick={() => toggle(page.id)}>{pageOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}{label}</button>
                <label className="flex items-center gap-2 text-xs">Show page<Switch checked={enabled} disabled={disabled} aria-label={`${label} page visibility`} onCheckedChange={checked => onChange(withPageDisplayAccess(setPageVisibility(permissions, page.id, checked), page.routes, checked))} /></label>
              </div>
              {pageOpen && <div className="space-y-4 border-t border-border/70 p-3 sm:p-4">
                {restricted.length > 0 && <p className="rounded-lg border border-amber-500/40 p-3 text-xs">Currently hidden: {[...new Set(restricted.map(item => item.label))].join(", ")}. Review Show page and Settings subpages &amp; screen elements in this editor. Action permissions do not grant page visibility.</p>}
                {entryKeys.length > 0 && <div className="rounded-lg bg-muted/30 p-3 text-xs">
                  <p>To open this page: {entryKeys.map(key => PERMISSION_LABELS[key]).join(", ")}.</p>
                  {!admin && missingEntry.length > 0 && <Button variant="outline" size="sm" className="mt-2" disabled={disabled} onClick={() => onChange(withPageDisplayAccess(grantPageEntry(permissions, page.id), page.routes, true))}>Grant page entry</Button>}
                  <p className="mt-1 text-muted-foreground">Actions below are separate. Role display restrictions also apply.</p>
                </div>}
                {!renderPageDetails && subpages.length > 0 && <div className="space-y-2"><h4 className="text-xs font-semibold text-muted-foreground">Subpages sharing this page access</h4><ul className="grid gap-2 sm:grid-cols-2">{subpages.map(item => <li key={`${item.path}#${item.hash ?? ""}`} className="min-w-0 rounded-lg bg-muted/20 px-3 py-2 text-sm"><span className="break-words">{item.label}</span><span className="block break-all text-xs text-muted-foreground">{item.path}{item.hash ? `#${item.hash}` : ""}</span></li>)}</ul><p className="text-xs text-muted-foreground">These subpages share existing access and action checks; they do not have independent grants.</p></div>}
                {renderPageDetails?.(page.id)}
                {!enabled && <p className="text-xs text-muted-foreground">Page access is off. Saved actions remain editable here and can apply on other enabled pages.</p>}
                <>
                  {!!editable.length && <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Permissions for {label}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(setEditablePageFeatures(permissions, page.id, true))}>Select all</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(setEditablePageFeatures(permissions, page.id, false))}>Deselect all</Button></div></div>}
                  {(["Visible information", "Allowed actions"] as const).map(heading => {
                    const isView = (key: PermissionKey) => key.startsWith("can_view_") || key.endsWith("_view");
                    const keys = editable.filter(key => !["can_use_management_pc", "can_use_management_mobile"].includes(key) && (heading === "Visible information") === isView(key));
                    return keys.length ? <div key={heading} className="space-y-3"><h4 className="text-sm font-semibold">{heading}</h4><div className="grid gap-3 sm:grid-cols-2">{keys.map(key => {
                      const shared = PERMISSION_PAGES.filter(owner => owner.id !== page.id && owner.keys.includes(key));
                      return <label key={key} className="flex min-w-0 items-start gap-3 text-sm"><Checkbox className="mt-0.5 shrink-0" checked={admin || permissions[key]} disabled={disabled} onCheckedChange={checked => onChange({ ...permissions, [key]: checked === true })} /><span className="min-w-0 break-words">{PERMISSION_LABELS[key]}{shared.length > 0 && <span className="mt-1 block text-xs text-muted-foreground">Shared with {shared.map(permissionPageLabel).join(", ")}</span>}</span></label>;
                    })}</div></div> : null;
                  })}
                  {related.length > 0 && <div className="space-y-3 rounded-lg border border-dashed p-3">
                    <h4 className="text-sm font-semibold">Permissions managed elsewhere</h4>
                    <div className="grid gap-2 sm:grid-cols-2">{related.map(key => {
                      const owner = permissionControlOwner(key);
                      const section = PERMISSION_SECTIONS.find(item => item.pageIds.includes(owner.id));
                      return <button key={key} type="button" className="text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => onExpandedChange(new Set([...expanded, `section:${section?.id}`, owner.id]))}>
                        {PERMISSION_LABELS[key]} · Manage in {permissionPageLabel(owner)}
                      </button>;
                    })}</div>
                  </div>}
                  {page.id === "approvals" && <p className="text-xs text-muted-foreground">Show page controls access to the approvals queue. Decisions follow the separate Approver rules and this person's branch scope.</p>}
                  {!editable.length && !related.length && <p className="text-xs text-muted-foreground">This page has no separate configurable actions.</p>}
                </>
              </div>}
            </section>;
          })}
        </div>}
      </section>;
    })}
  </div>;
}
