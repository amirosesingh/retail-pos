/**
 * Supplier directory.
 *
 * Suppliers live centrally so every branch receives goods against the same
 * list. Reads go straight to the database; writes go through the offline
 * outbox like every other POS write, so receiving keeps working with no
 * connection.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";
import { commitOps } from "@/core/api/pos-db";
import { routedQuery } from "@/core/api/db-query";

export type Supplier = {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  notes?: string;
  active: boolean;
  createdAt?: string;
};

type Row = Record<string, any>;

const toSupplier = (r: Row): Supplier => ({
  id: r.id,
  name: r.name ?? "",
  contactName: r.contact_name ?? "",
  phone: r.phone ?? "",
  email: r.email ?? "",
  address: r.address ?? "",
  taxNumber: r.tax_number ?? "",
  notes: r.notes ?? "",
  active: r.is_active ?? true,
  createdAt: r.created_at ?? undefined,
});

const toRow = (s: Supplier): Row => ({
  id: s.id,
  name: s.name,
  contact_name: s.contactName || null,
  phone: s.phone || null,
  email: s.email || null,
  address: s.address || null,
  tax_number: s.taxNumber || null,
  notes: s.notes || null,
  is_active: s.active,
});

const CACHE_KEY = "pos.suppliers.v1";

function cache(list: Supplier[]) {
  try {
    writeBusinessValue(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* storage full — the database still holds the list */
  }
}

export function cachedSuppliers(): Supplier[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(readBusinessValue(CACHE_KEY) ?? "[]") as Supplier[];
    return Array.isArray(list) ? list.filter((row) => row && typeof row.id === "string" && typeof row.name === "string") : [];
  } catch {
    return [];
  }
}

/** Central list, newest first. Falls back to the offline cache. */
export async function loadSuppliers(): Promise<Supplier[]> {
  let rows: Row[];
  try {
    rows = [];
    for (let offset=0; ; offset+=1000) {
      const page = await routedQuery("suppliers", {match:{deleted_at:null},orderBy:{column:"name"},limit:1000,offset}) as Row[];
      rows.push(...page);
      if (page.length < 1000) break;
      if (rows.length >= 500000) throw new Error("The supplier directory is too large to load completely.");
    }
  }
  catch { return cachedSuppliers(); }
  const list = rows.map(toSupplier);
  cache(list);
  return list;
}

export async function saveSupplier(s: Supplier) {
  const list = cachedSuppliers();
  await commitOps("Saving supplier", [{ kind: "upsert", table: "suppliers", rows: [toRow(s)] }]);
  cache([...list.filter((x) => x.id !== s.id), s].sort((a, b) => a.name.localeCompare(b.name)));
}

export async function deleteSupplier(id: string) {
  cache(cachedSuppliers().filter((x) => x.id !== id));
  await commitOps("Deleting supplier", [{ kind: "delete", table: "suppliers", match: { id } }]);
}

export const newSupplier = (name = ""): Supplier => ({
  id: crypto.randomUUID(),
  name,
  active: true,
});
