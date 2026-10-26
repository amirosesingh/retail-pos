import { canUseEcommerceDevice } from "@/lib/ecommerce-device";
import { SettingsBackLink } from "@/platforms/web/components/pos/settings/SettingsBackLink";
import { HelpTip } from "@/components/ui/help-tip";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/pos-auth";
import { notifyError } from "@/lib/notify";
import {
  deleteCategory,
  deleteUnit,
  isActive,
  listOf,
  reorderCategory,
  saveCategory,
  saveUnit,
  setCategoryActive,
  setUnitActive,
  useCategories,
  useUnits,
} from "@/lib/catalog-meta";
import { usePos } from "@/lib/pos-store";
import type { CatalogKind, ProductCategory } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/catalog")({
  head: () => ({
    meta: [
      { title: "Categories & Units — Retail" },
      {
        name: "description",
        content:
          "Manage product categories, sub-categories, groups and the units of measure used across the catalogue.",
      },
      { property: "og:title", content: "Categories & Units — Retail" },
      {
        property: "og:description",
        content: "Catalogue classification and unit of measure setup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CatalogMetaSettings,
});

function ListEditor({
  kind,
  title,
  hint,
  placeholder,
  categories,
  allowed,
  onRename,
  onRemove,
}: {
  kind: CatalogKind;
  title: string;
  hint: string;
  placeholder: string;
  categories: ProductCategory[];
  allowed: boolean;
  onRename: (node: ProductCategory) => void;
  onRemove: (node: ProductCategory, kind: CatalogKind) => void;
}) {
  const [name, setName] = useState("");
  const adding = useRef(false);
  const [busy, setBusy] = useState(false);
  const items = listOf(categories, kind);

  async function add() {
    if (!allowed || adding.current) return;
    const value = name.trim();
    if (!value) return toast.error(`Give the ${title.toLowerCase()} a name`);
    if (items.some((i) => i.name.toLowerCase() === value.toLowerCase())) {
      return toast.error(`${value} is already on the list`);
    }
    adding.current = true;
    setBusy(true);
    try {
      await saveCategory({ name: value, kind, parentId: null, sort: items.length + 1 });
      setName("");
      toast.success("Saved");
    } catch {
      toast.error("Could not save that entry");
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <div className="flex items-center gap-1">
          <h3 className="font-medium">{title}</h3>
          <HelpTip text={hint} label={`About ${title}`} />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="h-9"
            disabled={!allowed || busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
        </div>
        <Button onClick={add} disabled={!allowed || busy}>
          <Plus className="size-4" /> {busy ? "Saving…" : "Add"}
        </Button>
      </div>

      <div className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 truncate text-sm">
              <span
                className={
                  isActive(item) ? "truncate" : "truncate text-muted-foreground line-through"
                }
              >
                {item.name}
              </span>
              {!isActive(item) && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Inactive
                </Badge>
              )}
            </span>
            <div className="flex items-center gap-1">
              <Switch
                checked={isActive(item)}
                disabled={!allowed}
                aria-label={`${item.name} active`}
                onCheckedChange={(next) => {
                  void setCategoryActive(item.id, next).catch(error => notifyError(error, "Could not update category status"));
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                disabled={!allowed}
                aria-label={`Move ${item.name} up`}
                onClick={() => void reorderCategory(categories, item.id, -1).catch(error => notifyError(error, "Could not reorder categories"))}
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!allowed}
                aria-label={`Move ${item.name} down`}
                onClick={() => void reorderCategory(categories, item.id, 1).catch(error => notifyError(error, "Could not reorder categories"))}
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!allowed}
                aria-label={`Rename ${item.name}`}
                onClick={() => onRename(item)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!allowed}
                aria-label={`Delete ${item.name}`}
                onClick={() => onRemove(item, kind)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {!items.length && (
          <p className="p-3 text-xs text-muted-foreground">Nothing on this list yet.</p>
        )}
      </div>
    </div>
  );
}

function CatalogMetaSettings() {
  const { can } = useAuth();
  const allowed = can("can_manage_categories");
  const categories = useCategories();
  const units = useUnits();
  const {
    state,
    configuredGlobalSettings,
    updateGlobalSettings,
    saveConfiguredSettings,
    settingsScopeLoading,
  } = usePos();
  const autoArchiveZeroStock = configuredGlobalSettings.integrations.autoArchiveZeroStock !== false;

  const [ecomDraft, setEcomDraft] = useState<boolean | null>(null);
  const [ecomBusy, setEcomBusy] = useState(false);
  const ecommerceEnabled = ecomDraft ?? configuredGlobalSettings.integrations.ecommerceEnabled !== false;

  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitDecimal, setUnitDecimal] = useState(false);
  const addingUnit = useRef(false);
  const [unitBusy, setUnitBusy] = useState(false);

  /** How many catalogue items still carry this name at this level. */
  const productsUsing = (node: ProductCategory, kind: CatalogKind) =>
    state.products.filter((p) =>
      kind === "category"
        ? p.category === node.name
        : kind === "group"
          ? (p.group ?? "") === node.name
          : (p.subCategory ?? "") === node.name,
    ).length;

  async function renameNode(node: ProductCategory) {
    const next = window.prompt(`Rename "${node.name}" to`, node.name)?.trim();
    if (!next || next === node.name) return;
    try {
      await saveCategory({ ...node, name: next });
      toast.success("Renamed");
    } catch {
      toast.error("Could not rename that entry");
    }
  }

  async function removeNode(node: ProductCategory, kind: CatalogKind) {
    const inUse = productsUsing(node, kind);
    if (inUse) {
      toast.error(`${inUse} product${inUse > 1 ? "s are" : " is"} still filed under ${node.name}`);
      return;
    }
    try {
      await deleteCategory(node.id);
      toast.success(`${node.name} removed`);
    } catch (error) {
      notifyError(error, "Could not remove that category");
    }
  }

  async function addUnit() {
    if (!allowed || addingUnit.current) return;
    const code = unitCode.trim().toLowerCase();
    if (!code) return toast.error("Give the unit a short code, e.g. kg");
    addingUnit.current = true;
    setUnitBusy(true);
    try {
      await saveUnit({
        code,
        name: unitName.trim() || code,
        allowDecimal: unitDecimal,
        sort: units.length + 1,
      });
      setUnitCode("");
      setUnitName("");
      setUnitDecimal(false);
      toast.success("Unit saved");
    } catch {
      toast.error("Could not save that unit");
    } finally {
      addingUnit.current = false;
      setUnitBusy(false);
    }
  }

  return (
    <SettingsShell>
      <div className="pos-page-container">
        <header className="flex items-start gap-3">
          <SettingsBackLink />
          <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Categories & Units</h1>
          <p className="text-sm text-muted-foreground page-description">
            Keep three simple lists — categories, groups and sub-categories — and pick from them
            when adding products. Switch an entry off to retire it without losing what old records
            say.
          </p>
          </div>
        </header>

        {canUseEcommerceDevice() && <section className="space-y-3 rounded-xl border bg-card p-4">
          <label className="flex items-center justify-between gap-3"><span><span className="block font-medium">E-commerce catalog controls</span><span className="block text-sm text-muted-foreground">Available on the management web app and registered management devices only, with Publish products permission. Price edits also require Edit product pricing.</span></span><Switch aria-label="Enable e-commerce catalog controls" checked={ecommerceEnabled} disabled={!can("can_access_pos_settings") || settingsScopeLoading || ecomBusy} onCheckedChange={setEcomDraft} /></label>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Disabling hides the controls and preserves existing e-commerce prices and publication records.</p><Button type="button" size="sm" disabled={ecomDraft === null || !can("can_access_pos_settings") || settingsScopeLoading || ecomBusy} onClick={async () => { setEcomBusy(true); try { updateGlobalSettings({ integrations: { ...configuredGlobalSettings.integrations, ecommerceEnabled } }); await saveConfiguredSettings(); setEcomDraft(null); toast.success("E-commerce catalog setting saved"); } catch (error) { notifyError(error, "Saving e-commerce catalog controls"); } finally { setEcomBusy(false); } }}>Save e-commerce setting</Button></div>
        </section>}

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
          <div>
            <p className="font-medium">Automatically archive zero-stock products</p>
            <p className="text-xs text-muted-foreground">
              Enabled by default. Net company stock of zero or less automatically archives a
              product; positive stock automatically makes it active again. Turn this off to manage
              archive status manually.
            </p>
          </div>
          <Switch
            checked={autoArchiveZeroStock}
            disabled={!allowed || settingsScopeLoading}
            aria-label="Automatically archive zero-stock products"
            onCheckedChange={(enabled) => {
              void (async () => {
                try {
                  const integrations = configuredGlobalSettings.integrations;
                  updateGlobalSettings({
                    integrations: { ...integrations, autoArchiveZeroStock: enabled },
                  });
                  await saveConfiguredSettings();
                } catch (error) {
                  notifyError(error, "Saving automatic catalogue archiving");
                }
              })();
            }}
          />
        </div>

        {!allowed && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            You can view this setup, but changing it needs the catalogue management permission.
          </p>
        )}

        <div className="grid min-w-0 gap-4 xl:grid-cols-3">
          <ListEditor
            kind="category"
            categories={categories}
            allowed={allowed}
            onRename={renameNode}
            onRemove={removeNode}
            title="Categories"
            hint="The main list products are filed under."
            placeholder="Rackets, Strings, Grips…"
          />
          <ListEditor
            kind="group"
            categories={categories}
            allowed={allowed}
            onRename={renameNode}
            onRemove={removeNode}
            title="Groups"
            hint="A second free list, independent of categories."
            placeholder="Yonex, Li-Ning…"
          />
          <ListEditor
            kind="sub"
            categories={categories}
            allowed={allowed}
            onRename={renameNode}
            onRemove={removeNode}
            title="Sub-categories"
            hint="A third free list, independent of the others."
            placeholder="Head heavy, Multifilament…"
          />
        </div>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-medium">Units of measure</h2>
          <p className="text-xs text-muted-foreground">
            Decimal units allow fractional quantities at the till (0.25 kg, 3.5 m). Switch a unit
            off to retire it: old products keep it, new ones can no longer choose it.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Code</Label>
              <Input
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
                placeholder="kg"
                className="h-9 w-28"
                disabled={!allowed || unitBusy}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="Kilogram"
                className="h-9 w-52"
                disabled={!allowed || unitBusy}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                checked={unitDecimal}
                onCheckedChange={setUnitDecimal}
                disabled={!allowed || unitBusy}
                aria-label="Allow decimal quantities"
              />
              <span className="text-sm">Allow decimals</span>
            </div>
            <Button onClick={addUnit} disabled={!allowed || unitBusy}>
              <Plus className="size-4" /> {unitBusy ? "Saving…" : "Add"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <Badge
                key={u.code}
                variant="outline"
                className={isActive(u) ? "gap-2 py-1" : "gap-2 py-1 opacity-60"}
              >
                <span className="numeric font-medium">{u.code}</span>
                <span className="text-muted-foreground">{u.name}</span>
                {u.allowDecimal && <span className="text-[10px] text-accent">decimal</span>}
                {!isActive(u) && (
                  <span className="text-[10px] text-muted-foreground">inactive</span>
                )}
                <Switch
                  checked={isActive(u)}
                  disabled={!allowed}
                  aria-label={`Unit ${u.code} active`}
                  onCheckedChange={(next) => {
                    void setUnitActive(u.id, next).catch(error => notifyError(error, "Could not update unit status"));
                  }}
                />
                <button
                  type="button"
                  className="text-destructive"
                  aria-label={`Delete unit ${u.code}`}
                  disabled={!allowed}
                  onClick={async () => {
                    try {
                      await deleteUnit(u.id, u.code);
                    } catch (error) {
                      notifyError(error, "Could not remove that unit");
                    }
                  }}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
