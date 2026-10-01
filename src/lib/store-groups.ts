/**
 * Store groups (clusters).
 *
 * A group is a real record now, not a name typed on each branch: branches keep
 * a reference to `store_groups.id`, so every cross-group rule compares ids.
 * The list is mirrored to localStorage so a till that boots offline still has
 * the picker it had yesterday.
 */
import { useEffect, useState } from "react";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { loadStoreGroupsForCaller, saveStoreGroupForCaller } from "@/lib/store-groups.functions";

export type StoreGroup = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt: string | null;
};

const KEY = "pos.store.groups";
const isBrowser = () => typeof window !== "undefined";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function readStoreGroups(): StoreGroup[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoreGroup[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: StoreGroup[]) {
  if (isBrowser()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* storage blocked — the central copy stays authoritative */
    }
  }
  notify();
}

const byName = (a: StoreGroup, b: StoreGroup) => a.name.localeCompare(b.name);

type Row = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  archived_at: string | null;
};

const toGroup = (r: Row): StoreGroup => ({
  id: r.id,
  code: r.code,
  name: r.name,
  isActive: !!r.is_active,
  archivedAt: r.archived_at,
});

export async function loadStoreGroups(): Promise<StoreGroup[]> {
  const result = await loadStoreGroupsForCaller({ data: await getPosCallerAuth() });
  if (!result.ok) return readStoreGroups();
  const list = (result.rows as Row[]).map(toGroup).sort(byName);
  writeLocal(list);
  return list;
}

/** Only these may be picked when assigning a branch. */
export const selectableGroups = (all: StoreGroup[]) =>
  all.filter((g) => g.isActive && !g.archivedAt).sort(byName);

export const groupName = (all: StoreGroup[], id: string | null | undefined) =>
  (id ? all.find((g) => g.id === id)?.name : "") || (id ?? "");

export function groupCodeFrom(name: string, existing: StoreGroup[]): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10) || "GROUP";
  let code = base;
  let n = 2;
  while (existing.some((g) => g.code.toUpperCase() === code)) code = `${base}${n++}`;
  return code;
}

export async function saveStoreGroup(
  group: Omit<StoreGroup, "archivedAt"> & { archivedAt?: string | null },
): Promise<StoreGroup> {
  const row = {
    id: group.id,
    code: group.code,
    name: group.name.trim(),
    is_active: group.isActive,
    archived_at: group.archivedAt ?? null,
  };
  const result = await saveStoreGroupForCaller({
    data: { ...(await getPosCallerAuth()), group: row },
  });
  if (!result.ok) throw new Error(result.error);
  const saved = toGroup(result.group as Row);
  writeLocal([...readStoreGroups().filter((g) => g.id !== saved.id), saved].sort(byName));
  return saved;
}

/** Groups are never deleted — history keeps its meaning. */
export const archiveStoreGroup = (group: StoreGroup) =>
  saveStoreGroup({ ...group, isActive: false, archivedAt: new Date().toISOString() });

export const restoreStoreGroup = (group: StoreGroup) =>
  saveStoreGroup({ ...group, isActive: true, archivedAt: null });

export function useStoreGroups(): StoreGroup[] {
  const [value, setValue] = useState<StoreGroup[]>(readStoreGroups);
  useEffect(() => {
    const listener = () => setValue(readStoreGroups());
    listeners.add(listener);
    void loadStoreGroups().then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
