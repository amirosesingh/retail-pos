import { subscribeDataChange } from "./sync-engine";
/**
 * Catalogue metadata — categories, sub-categories and units of measure.
 *
 * Both lists live on the POS database (`product_categories`, `uom_units`)
 * alongside the rest of the catalogue, and are mirrored to device storage so a
 * till that boots offline still shows the pickers it had yesterday.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";
import { useEffect, useState } from "react";
import type { CatalogKind, ProductCategory, UomUnit } from "@/core/types/pos-types";
import { tombstone } from "./tombstones";
import { routedQuery } from "@/core/api/db-query";
import { commitOps } from "@/core/api/pos-db";

const CAT_KEY = "pos.catalog.categories";
const UOM_KEY = "pos.catalog.units";
const isBrowser = () => typeof window !== "undefined";

export const DEFAULT_UNITS: UomUnit[] = [
  { id: "pcs", code: "pcs", name: "Pieces", allowDecimal: false, sort: 1 },
  { id: "box", code: "box", name: "Box", allowDecimal: false, sort: 2 },
  { id: "pack", code: "pack", name: "Pack", allowDecimal: false, sort: 3 },
  { id: "set", code: "set", name: "Set", allowDecimal: false, sort: 4 },
  { id: "kg", code: "kg", name: "Kilogram", allowDecimal: true, sort: 5 },
  { id: "g", code: "g", name: "Gram", allowDecimal: true, sort: 6 },
  { id: "l", code: "l", name: "Litre", allowDecimal: true, sort: 7 },
  { id: "m", code: "m", name: "Metre", allowDecimal: true, sort: 8 },
];

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readLocal<T extends { id: string; name: string }>(key: string, fallback: T[]): T[] {
  if (!isBrowser()) return fallback;
  try {
    const raw = readBusinessValue(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter((row): row is T => !!row && typeof row === "object" &&
      typeof row.id === "string" && typeof row.name === "string" &&
      (key !== UOM_KEY || typeof row.code === "string"));
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    writeBusinessValue(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — the cloud copy is still authoritative */
  }
  notify();
}

export const readCategories = () => readLocal<ProductCategory>(CAT_KEY, []);
export const readUnits = () => {
  const stored = readLocal<UomUnit>(UOM_KEY, []);
  return stored.length ? stored : DEFAULT_UNITS;
};

export async function loadCatalogMeta() {
  const [cats, units] = await Promise.all([
    routedQuery("product_categories", { match: { deleted_at: null }, orderBy: { column: "sort" }, limit: 2000 }),
    routedQuery("uom_units", { match: { deleted_at: null }, orderBy: { column: "sort" }, limit: 2000 }),
  ]);
  if (cats) {
    writeLocal(
      CAT_KEY,
      cats.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        kind: ((r as { kind?: string }).kind as CatalogKind) ?? "category",
        parentId: (r.parent_id as string | null) ?? null,
        sort: Number(r.sort ?? 0),
        active: (r as { is_active?: boolean }).is_active !== false,
      })),
    );
  }
  if (units.length) {
    writeLocal(
      UOM_KEY,
      units.map((r) => ({
        id: r.id as string,
        code: r.code as string,
        name: r.name as string,
        allowDecimal: !!r.allow_decimal,
        sort: Number(r.sort ?? 0),
        active: (r as { is_active?: boolean }).is_active !== false,
      })),
    );
  }
}

export async function saveCategory(cat: Omit<ProductCategory, "id"> & { id?: string }) {
  const id = cat.id ?? crypto.randomUUID();
  const row = {
    id,
    name: cat.name,
    kind: cat.kind ?? "category",
    parent_id: cat.parentId ?? null,
    sort: cat.sort ?? 0,
    is_active: cat.active !== false,
  };
  await commitOps("Saving product category", [{ kind: "upsert", table: "product_categories", rows: [row] }]);
  const saved: ProductCategory = {
    id,
    name: cat.name,
    kind: cat.kind ?? "category",
    parentId: cat.parentId ?? null,
    sort: cat.sort ?? 0,
    active: cat.active !== false,
  };
  const list = readCategories().filter((c) => c.id !== saved.id);
  writeLocal(CAT_KEY, [...list, saved].sort((a, b) => a.sort - b.sort));
  return saved;
}

export async function deleteCategory(id: string) {
  await commitOps("Archiving product category", [{ kind: "update", table: "product_categories", values: tombstone(), match: { id } }]);
  writeLocal(
    CAT_KEY,
    readCategories().filter((c) => c.id !== id && c.parentId !== id),
  );
}

export async function saveUnit(unit: Omit<UomUnit, "id"> & { id?: string }) {
  const id = unit.id?.includes("-") ? unit.id : crypto.randomUUID();
  const row = {
    id,
    code: unit.code.trim().toLowerCase(),
    name: unit.name,
    allow_decimal: unit.allowDecimal,
    sort: unit.sort ?? 0,
    is_active: unit.active !== false,
  };
  await commitOps("Saving unit of measure", [{ kind: "upsert", table: "uom_units", rows: [row] }]);
  const saved: UomUnit = {
    id,
    code: row.code,
    name: unit.name,
    allowDecimal: unit.allowDecimal,
    sort: unit.sort ?? 0,
    active: unit.active !== false,
  };
  const list = readUnits().filter((u) => u.code !== saved.code);
  writeLocal(UOM_KEY, [...list, saved].sort((a, b) => a.sort - b.sort));
  return saved;
}

export async function deleteUnit(id: string, code: string) {
  await commitOps("Archiving unit of measure", [{ kind: "update", table: "uom_units", values: tombstone(), match: id.includes("-") ? { id } : { code } }]);
  writeLocal(
    UOM_KEY,
    readUnits().filter((u) => u.code !== code),
  );
}

function useCatalogStore<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const listener = () => setValue(read());
    listeners.add(listener);
    const reload = () => loadCatalogMeta().then(listener).catch(() => { /* Keep validated cached metadata while offline. */ });
    void reload();
    const off = subscribeDataChange(change => {
      if (["product_categories", "uom_units"].includes(change.table)) void reload();
    });
    return () => {
      off();
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export const useCategories = () => useCatalogStore(readCategories);
export const useUnits = () => useCatalogStore(readUnits);

const byOrder = (a: ProductCategory, b: ProductCategory) =>
  a.sort - b.sort || a.name.localeCompare(b.name);

/** One of the three independent lists, in display order. */
export const listOf = (all: ProductCategory[], kind: CatalogKind) =>
  all.filter((c) => (c.kind ?? "category") === kind).sort(byOrder);

export const topCategories = (all: ProductCategory[]) => listOf(all, "category");
export const groupList = (all: ProductCategory[]) => listOf(all, "group");
export const subCategoryList = (all: ProductCategory[]) => listOf(all, "sub");

/** Moves an entry up or down within its own list by swapping sort positions. */
export async function reorderCategory(all: ProductCategory[], id: string, dir: -1 | 1) {
  const node = all.find((c) => c.id === id);
  if (!node) return;
  const siblings = listOf(all, node.kind ?? "category");
  const index = siblings.findIndex((c) => c.id === id);
  const swap = siblings[index + dir];
  if (!swap) return;
  await saveCategory({ ...node, sort: swap.sort });
  await saveCategory({ ...swap, sort: node.sort });
}

/**
 * Retiring an entry keeps every old record readable — only new choices lose it.
 * A value already on the record being edited stays offered, so an old product
 * does not silently change unit or category the moment someone opens it.
 */
export async function setCategoryActive(id: string, active: boolean) {
  const cat = readCategories().find((c) => c.id === id);
  if (!cat) return;
  await saveCategory({ ...cat, active });
}

export async function setUnitActive(id: string, active: boolean) {
  const unit = readUnits().find((u) => u.id === id);
  if (!unit) return;
  await saveUnit({ ...unit, active });
}

export const isActive = (entry: { active?: boolean }) => entry.active !== false;

/** Active entries, plus whatever the record already carries. */
export function selectableCategories(all: ProductCategory[], keep?: string | null) {
  return all.filter((c) => isActive(c) || c.id === keep);
}

export function selectableUnits(all: UomUnit[], keep?: string | null) {
  return all.filter((u) => isActive(u) || u.code === keep || u.id === keep);
}

export const unitLabel = (units: UomUnit[], code: string | undefined) =>
  units.find((u) => u.code === code)?.code ?? code ?? "";

export const unitAllowsDecimal = (units: UomUnit[], code: string | undefined) =>
  !!units.find((u) => u.code === code)?.allowDecimal;
