import type { RealtimeChannel } from "@supabase/supabase-js";

type Client = {
  channel(topic: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
};
type Filter = { event: "*"; schema: string; table: string; filter?: string };
type Shared = { listeners: Set<() => void>; stop: () => void };
const subscriptions = new WeakMap<Client, Map<string, Shared>>();

/** Postgres listeners own their channel; fixed broadcast topics must not use this helper. */
export function subscribeOwnedPostgresChanges(
  client: Client,
  topic: string,
  filter: Filter,
  onChange: () => void,
): () => void {
  const callback = () => onChange();
  let owned = subscriptions.get(client);
  if (!owned) { owned = new Map(); subscriptions.set(client, owned); }
  // Never share across clients, topics or authorization filters.
  const key = JSON.stringify([topic, filter.event, filter.schema, filter.table, filter.filter ?? ""]);
  const existing = owned.get(key);
  if (existing) {
    existing.listeners.add(callback);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      existing.listeners.delete(callback);
      if (!existing.listeners.size) existing.stop();
    };
  }
  const listeners = new Set([callback]);
  let active = true;
  let channel: RealtimeChannel | undefined;
  const stop = () => {
    if (!active) return;
    active = false;
    owned.delete(key);
    listeners.clear();
    if (channel) {
      try { void client.removeChannel(channel).catch(() => undefined); }
      catch { /* Connection teardown must not interrupt route cleanup. */ }
    }
  };
  owned.set(key, { listeners, stop });
  try {
    // The SDK returns an existing channel for a repeated topic. Removal is
    // asynchronous, so even an immediate unmount/remount needs a fresh name.
    channel = client.channel(`${topic}:${crypto.randomUUID()}`);
    channel.on("postgres_changes", filter, () => {
      if (active) for (const listener of [...listeners]) listener();
    }).subscribe();
  } catch {
    stop(); // Keep each consumer's local/reconnect/poll fallback working.
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    listeners.delete(callback);
    if (!listeners.size) stop();
  };
}
