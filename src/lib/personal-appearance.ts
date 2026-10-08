import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "./pos-auth";
import { readCredentials } from "./pos-credentials";
import { supabaseConfig } from "./external-supabase-config";
import { DEFAULT_PERSONAL_APPEARANCE, personalAppearanceSchema, type PersonalAppearance } from "./personal-appearance-schema";
import { sessionEpoch, isCurrentEpoch } from "./session-epoch";
import { hasStaffSession } from "@/core/api/sync-relay";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { readLocalSetting, writeLocalSetting } from "@/core/local-db/local-db";

type Entry = { profile: PersonalAppearance; pending: boolean; revision: number };
const empty: Entry = { profile: DEFAULT_PERSONAL_APPEARANCE, pending: false, revision: 0 };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const saving = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const deviceWrites = new Map<string, Promise<unknown>>();
export const appearanceCacheKey = (project: string, owner: string) => `ui.personal-appearance.v1:${encodeURIComponent(project)}:${encodeURIComponent(owner)}`;

function read(key: string): Entry {
  if (!key || typeof window === "undefined") return empty;
  if (entries.has(key)) return entries.get(key)!;
  let entry = empty;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Entry | null;
    const parsed = personalAppearanceSchema.safeParse(saved?.profile);
    if (parsed.success) entry = { profile: parsed.data, pending: saved?.pending === true, revision: 0 };
  } catch { /* Display preferences can fall back safely when browser storage is unavailable. */ }
  entries.set(key, entry);
  return entry;
}
function publish(key: string, entry: Entry) {
  entries.set(key, entry);
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* In-memory preferences still work. */ }
  const write = (deviceWrites.get(key) ?? Promise.resolve()).catch(() => undefined)
    .then(() => writeLocalSetting(key, JSON.stringify(entry)));
  deviceWrites.set(key, write);
  void write.finally(() => { if (deviceWrites.get(key) === write) deviceWrites.delete(key); });
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

async function flush(key: string, owner: string, epoch: number): Promise<void> {
  if (!read(key).pending || !isCurrentEpoch(epoch)) return;
  const previous = saving.get(key);
  if (previous) { await previous; return flush(key, owner, epoch); }
  const operation = (async () => {
    const entry = read(key);
    try {
      const credentials = await readCredentials();
      if (!isCurrentEpoch(epoch)) return;
      const { savePersonalAppearance } = await import("./personal-appearance.functions");
      await savePersonalAppearance({ data: { ...credentials, owner, profile: entry.profile } });
      if (read(key).revision === entry.revision) publish(key, { ...entry, pending: false });
    } catch { /* Retain only this user's appearance changes; retry on edit or reconnect. */ }
  })();
  saving.set(key, operation);
  await operation;
  saving.delete(key);
}

export function usePersonalAppearance() {
  const { user, can } = useAuth();
  const owner = user?.staffId ?? "";
  const key = owner ? appearanceCacheKey(supabaseConfig().url, owner) : "";
  const entry = useSyncExternalStore(subscribe, () => read(key), () => empty);
  const editable = !!owner && can("can_customize_display");
  const update = useCallback((patch: Partial<PersonalAppearance>) => {
    if (!key || !editable) return;
    const current = read(key);
    const profile = personalAppearanceSchema.parse({ ...current.profile, ...patch });
    publish(key, { profile, pending: true, revision: current.revision + 1 });
    const old = timers.get(key);
    if (old) clearTimeout(old);
    const epoch = sessionEpoch();
    timers.set(key, setTimeout(() => { timers.delete(key); void flush(key, owner, epoch); }, 400));
  }, [key, owner, editable]);
  return { profile: entry.profile, pending: entry.pending, editable, update, key, owner };
}

/** Load once on sign-in and on reconnection; no idle polling or business refresh. */
export function usePersonalAppearanceSync(key: string, owner: string) {
  useEffect(() => {
    if (!key || !owner) return;
    let cancelled = false;
    const epoch = sessionEpoch();
    const refresh = async () => {
      if (read(key).pending) return flush(key, owner, epoch);
      const revision = read(key).revision;
      try {
        const credentials = await readCredentials();
        if (cancelled || !isCurrentEpoch(epoch)) return;
        const { loadPersonalAppearance } = await import("./personal-appearance.functions");
        const result = await loadPersonalAppearance({ data: { ...credentials, owner } });
        if (!cancelled && isCurrentEpoch(epoch) && result.owner === owner && result.profile && read(key).revision === revision && !read(key).pending)
          publish(key, { profile: result.profile, pending: false, revision });
      } catch { /* The per-user device copy remains usable offline. */ }
    };
    void (async () => {
      const revision = read(key).revision;
      const raw = await readLocalSetting(key);
      if (!cancelled && isCurrentEpoch(epoch) && raw && !read(key).pending && read(key).revision === revision) {
        try {
          const local = JSON.parse(raw) as Entry;
          const parsed = personalAppearanceSchema.safeParse(local.profile);
          if (parsed.success) publish(key, { profile: parsed.data, pending: local.pending === true, revision });
        } catch { /* Invalid preferences never replace this user's safe defaults. */ }
      }
      if (!cancelled) await refresh();
    })();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    const channel = hasStaffSession() ? supabaseExternal.channel(`appearance:${owner}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings_scoped", filter: `scope_id=eq.${owner}` }, () => { void refresh(); })
      .subscribe() : null;
    return () => {
      cancelled = true;
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      if (channel) void supabaseExternal.removeChannel(channel);
    };
  }, [key, owner]);
}
