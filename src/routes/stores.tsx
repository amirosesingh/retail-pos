import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Building2, Layers, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { ConfirmSwitch } from "@/platforms/web/components/pos/ConfirmSwitch";
import { BRANCH_POLICY_COPY, branchPolicy, type BranchPolicyKey } from "@/lib/branch-policy";
import type { BranchPolicy, Store } from "@/core/types/pos-types";
import {
  isActiveLocation,
  locationPath,
  locationTypeLabel,
  rolledUpStock,
  subWarehouses,
} from "@/lib/locations";
import { groupName, selectableGroups, useStoreGroups } from "@/lib/store-groups";

export const Route = createFileRoute("/stores")({
  head: () => ({
    meta: [
      { title: "Manage Locations — Retail" },
      {
        name: "description",
        content:
          "Create stores and warehouses, nest sub-warehouse levels underneath them and choose the level stock is picked from first.",
      },
      { property: "og:title", content: "Manage Locations — Retail" },
      {
        property: "og:description",
        content: "Multi-level location and sub-warehouse builder for multi-branch retail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Locations,
});

/** Everything the drawer edits, kept apart from the saved record. */
type Draft = {
  id: string | null;
  name: string;
  code: string;
  address: string;
  phone: string;
  kind: "store" | "warehouse";
  isCentral: boolean;
  parentId: string;
  buildingName: string;
  floorLabel: string;
  receiptPrefix: string;
  groupId: string;
  wantsSubs: boolean;
  subs: { id: string | null; name: string; primary: boolean }[];
};

const blankDraft = (): Draft => ({
  id: null,
  name: "",
  code: "",
  address: "",
  phone: "",
  kind: "store",
  isCentral: false,
  parentId: "",
  buildingName: "",
  floorLabel: "",
  receiptPrefix: "",
  groupId: "",
  wantsSubs: false,
  subs: [],
});

function Locations() {
  const {
    stores,
    allStores,
    currentStore,
    upsertStore,
    archiveStore,
    setCurrentStore,
    state,
    updateSettings,
  } = usePos();
  const { can } = useAuth();
  const groups = useStoreGroups();
  const pickableGroups = useMemo(() => selectableGroups(groups), [groups]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const roots = useMemo(
    () => allStores.filter((s) => s.locationType !== "sub_warehouse"),
    [allStores],
  );

  if (!can("can_manage_locations")) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <p className="mt-2 font-semibold">Permission required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role does not allow location and warehouse management.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  function openFor(store: Store) {
    const subs = subWarehouses(allStores, store.id);
    setDraft({
      id: store.id,
      name: store.name,
      code: store.code,
      address: store.address ?? "",
      phone: store.phone ?? "",
      kind:
        store.locationType === "central_warehouse" || store.locationType === "main_building"
          ? "warehouse"
          : "store",
      isCentral: !!store.isCentral,
      parentId: store.parentId ?? "",
      buildingName: store.buildingName ?? "",
      floorLabel: store.floorLabel ?? "",
      receiptPrefix: store.receiptPrefix ?? "",
      groupId: store.groupId ?? "",
      wantsSubs: subs.length > 0,
      subs: subs.map((s) => ({ id: s.id, name: s.name, primary: !!s.isPrimarySub })),
    });
  }

  async function setPolicy(store: Store, key: BranchPolicyKey, value: boolean) {
    const current = branchPolicy(state.settings, store.id);
    const next: BranchPolicy = { ...current, [key]: value };
    updateSettings({
      integrations: {
        ...state.settings.integrations,
        branches: { ...(state.settings.integrations.branches ?? {}), [store.id]: next },
      },
    });
    // The private catalogue switch also lives on the branch record, because
    // that is what the central database checks before showing an item.
    if (key === "privateCatalogue") await upsertStore({ ...store, privateCatalogue: value });
    toast.success(
      `${BRANCH_POLICY_COPY[key].label} ${value ? "turned on" : "turned off"} for ${store.name}`,
    );
  }

  /** Saves the parent, then creates or renames each level underneath it. */
  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return toast.error("Location name is required");
    const isNew = !draft.id;
    const id = draft.id ?? crypto.randomUUID();
    const code =
      draft.code.trim().toUpperCase() ||
      `${
        name
          .replace(/[^a-zA-Z]/g, "")
          .slice(0, 3)
          .toUpperCase() || "STR"
      }${stores.length + 1}`;
    const existing = allStores.find((s) => s.id === id);

    if (draft.isCentral)
      for (const other of allStores.filter((x) => x.isCentral && x.id !== id))
        await upsertStore({ ...other, isCentral: false });

    await upsertStore({
      ...(existing ?? { id, active: true }),
      id,
      code,
      name,
      address: draft.address.trim() || "Address pending",
      phone: draft.phone.trim() || "—",
      locationType:
        draft.kind === "warehouse"
          ? draft.isCentral
            ? "central_warehouse"
            : "main_building"
          : "store",
      parentId: draft.parentId || null,
      isCentral: draft.kind === "warehouse" && draft.isCentral,
      buildingName: draft.buildingName.trim(),
      floorLabel: draft.floorLabel.trim(),
      receiptPrefix: draft.receiptPrefix.trim().toUpperCase(),
      groupId: draft.groupId.trim() || undefined,
      active: existing ? existing.active !== false : true,
    } as Store);

    if (draft.kind === "warehouse" && draft.wantsSubs) {
      const wanted = draft.subs.filter((s) => s.name.trim());
      const primaryIdx = Math.max(
        0,
        wanted.findIndex((s) => s.primary),
      );
      for (const [i, sub] of wanted.entries()) {
        const subId = sub.id ?? crypto.randomUUID();
        const prior = allStores.find((s) => s.id === subId);
        await upsertStore({
          ...(prior ?? { id: subId, active: true }),
          id: subId,
          code: prior?.code || `${code}-L${i + 1}`,
          name: sub.name.trim(),
          address: prior?.address ?? draft.address.trim() ?? "",
          phone: prior?.phone ?? "—",
          locationType: "sub_warehouse",
          parentId: id,
          isCentral: false,
          isPrimarySub: i === primaryIdx,
          groupId: draft.groupId.trim() || prior?.groupId,
          active: prior ? prior.active !== false : true,
        } as Store);
      }
    }

    toast.success(`${name} ${isNew ? "created" : "saved"}`);
    setDraft(null);
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Manage locations</h1>
            <p className="text-sm text-muted-foreground">
              <span className="numeric">{roots.length}</span> stores and warehouses · every new
              location gets its own stock bucket on all {state.products.length} products.
            </p>
          </div>
          <Button onClick={() => setDraft(blankDraft())}>
            <Plus className="size-4" /> New location
          </Button>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roots.map((s) => {
            const subs = subWarehouses(allStores, s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => openFor(s)}
                className="space-y-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <Building2 className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.code} · {locationTypeLabel(s.locationType)}
                      </p>
                    </div>
                  </div>
                  {!isActiveLocation(s) ? (
                    <Badge variant="secondary">Archived</Badge>
                  ) : (
                    <div className="flex gap-1">
                      {s.isCentral && <Badge variant="outline">Hub</Badge>}
                      {currentStore.id === s.id && <Badge variant="outline">Active</Badge>}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <span className="numeric">{rolledUpStock(state.products, allStores, s.id)}</span>{" "}
                  units on hand
                  {subs.length > 0 && (
                    <>
                      {" · "}
                      <span className="numeric">{subs.length}</span> sub-warehouse
                      {subs.length > 1 ? "s" : ""}
                    </>
                  )}
                </p>
                {subs.length > 0 && (
                  <ul className="space-y-1">
                    {subs.map((sub) => (
                      <li
                        key={sub.id}
                        className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-[11px]"
                      >
                        <span className="flex items-center gap-1">
                          <Layers className="size-3 text-muted-foreground" /> {sub.name}
                          {sub.isPrimarySub && (
                            <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">
                              Primary
                            </Badge>
                          )}
                        </span>
                        <span className="numeric text-muted-foreground">
                          {rolledUpStock(state.products, allStores, sub.id)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Sheet open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {draft && (
            <>
              <SheetHeader>
                <SheetTitle>{draft.id ? draft.name || "Edit location" : "New location"}</SheetTitle>
                <SheetDescription>
                  {draft.id
                    ? locationPath(allStores, draft.id)
                    : "Stores sell to customers. Warehouses hold stock and can be split into levels."}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 pb-24">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Location name">
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Riverside Mall"
                    />
                  </Field>
                  <Field label="Code">
                    <Input
                      className="numeric"
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                      placeholder="RVS"
                    />
                  </Field>
                  <Field label="Address">
                    <Input
                      value={draft.address}
                      onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      className="numeric"
                      value={draft.phone}
                      onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    />
                  </Field>
                </div>

                <Field label="Location type">
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { v: "store", t: "Store", h: "Sells to customers" },
                        { v: "warehouse", t: "Warehouse", h: "Holds and issues stock" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            kind: opt.v,
                            wantsSubs: opt.v === "warehouse" && draft.wantsSubs,
                          })
                        }
                        className={`rounded-md border p-3 text-left text-sm ${
                          draft.kind === opt.v
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background"
                        }`}
                      >
                        <p className="font-medium">{opt.t}</p>
                        <p className="text-[11px] text-muted-foreground">{opt.h}</p>
                      </button>
                    ))}
                  </div>
                </Field>

                {draft.kind === "warehouse" && (
                  <div className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-3">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={draft.isCentral}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, isCentral: checked === true })
                        }
                      />
                      Central hub — all inbound stock is received here first
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={draft.wantsSubs}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            wantsSubs: checked === true,
                            subs:
                              checked === true && draft.subs.length === 0
                                ? [
                                    { id: null, name: "Warehouse 1 — Ground Floor", primary: true },
                                    { id: null, name: "Warehouse 2 — Upper Floor", primary: false },
                                  ]
                                : draft.subs,
                          })
                        }
                      />
                      Create sub-warehouses for this location?
                    </label>

                    {draft.wantsSubs && (
                      <div className="space-y-2">
                        {draft.subs.map((sub, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              className="h-9"
                              value={sub.name}
                              placeholder={`Warehouse ${i + 1}`}
                              onChange={(e) => {
                                const subs = [...draft.subs];
                                subs[i] = { ...sub, name: e.target.value };
                                setDraft({ ...draft, subs });
                              }}
                            />
                            <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                              <input
                                type="radio"
                                name="primary-sub"
                                checked={sub.primary}
                                onChange={() =>
                                  setDraft({
                                    ...draft,
                                    subs: draft.subs.map((x, j) => ({ ...x, primary: j === i })),
                                  })
                                }
                              />
                              Primary
                            </label>
                          </div>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              subs: [
                                ...draft.subs,
                                {
                                  id: null,
                                  name: `Warehouse ${draft.subs.length + 1}`,
                                  primary: draft.subs.length === 0,
                                },
                              ],
                            })
                          }
                        >
                          <Plus className="size-3" /> Add level
                        </Button>
                        <p className="text-[10px] text-muted-foreground">
                          Stock is picked from the primary level first; any shortfall is topped up
                          from the next level automatically.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Parent location">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={draft.parentId}
                      onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                    >
                      <option value="">None (top level)</option>
                      {roots
                        .filter((x) => x.id !== draft.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Group / cluster">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={draft.groupId}
                      aria-label="Group or cluster"
                      onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}
                    >
                      <option value="">No group</option>
                      {pickableGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                      {draft.groupId && !pickableGroups.some((g) => g.id === draft.groupId) && (
                        <option value={draft.groupId}>
                          {groupName(groups, draft.groupId)} (not selectable)
                        </option>
                      )}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Groups are created in Settings → Groups &amp; clusters. Moves between two
                      different groups always need approval.
                    </p>
                  </Field>
                  <Field label="Building name">
                    <Input
                      className="h-9"
                      value={draft.buildingName}
                      placeholder="Riverside Tower"
                      onChange={(e) => setDraft({ ...draft, buildingName: e.target.value })}
                    />
                  </Field>
                  <Field label="Floor / room">
                    <Input
                      className="h-9"
                      value={draft.floorLabel}
                      placeholder="2nd Floor Vault"
                      onChange={(e) => setDraft({ ...draft, floorLabel: e.target.value })}
                    />
                  </Field>
                  <Field label="Receipt number prefix">
                    <Input
                      className="numeric h-9"
                      value={draft.receiptPrefix}
                      placeholder={draft.code}
                      onChange={(e) =>
                        setDraft({ ...draft, receiptPrefix: e.target.value.toUpperCase() })
                      }
                    />
                  </Field>
                </div>

                {draft.id && (
                  <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Branch independence
                    </p>
                    {(
                      [
                        "privateStock",
                        "privateCatalogue",
                        "allowTransfers",
                        "syncInventory",
                        "syncOther",
                      ] as BranchPolicyKey[]
                    ).map((key) => {
                      const store = allStores.find((x) => x.id === draft.id);
                      if (!store) return null;
                      const copy = BRANCH_POLICY_COPY[key];
                      return (
                        <ConfirmSwitch
                          key={key}
                          label={copy.label}
                          hint={copy.hint}
                          subject={store.name}
                          onWarning={copy.onWarning}
                          offWarning={copy.offWarning}
                          checked={branchPolicy(state.settings, store.id)[key]}
                          onConfirmedChange={(v) => {
                            void setPolicy(store, key, v).catch((error) =>
                              notifyError(error, "Saving branch policy"),
                            );
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="flex-1"
                    onClick={() =>
                      void save().catch((error) => notifyError(error, "Saving location"))
                    }
                  >
                    {draft.id ? "Save location" : "Create location"}
                  </Button>
                  {draft.id && (
                    <>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          setCurrentStore(draft.id!);
                          toast.success(`Now viewing ${draft.name}`);
                        }}
                      >
                        View this store
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          const store = allStores.find((x) => x.id === draft.id);
                          if (!store) return;
                          const archiving = isActiveLocation(store);
                          try {
                            const refusal = await archiveStore(store.id, archiving);
                            if (refusal)
                              return toast.error(`${store.name} cannot be archived`, {
                                description: refusal,
                              });
                            toast.success(`${store.name} ${archiving ? "archived" : "restored"}`);
                            setDraft(null);
                          } catch (error) {
                            notifyError(error, "Updating location");
                          }
                        }}
                      >
                        {isActiveLocation(
                          allStores.find((x) => x.id === draft.id) ?? ({} as Store),
                        ) ? (
                          <Archive className="size-4 text-destructive" />
                        ) : (
                          <ArchiveRestore className="size-4 text-success" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
