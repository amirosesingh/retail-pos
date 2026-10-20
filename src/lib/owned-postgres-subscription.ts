import type { RealtimeChannel } from "@supabase/supabase-js";

type Client = {
  channel(topic: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
};
type Filter = { event: "*"; schema: string; table: string; filter?: string };

/** Postgres listeners own their channel; fixed broadcast topics must not use this helper. */
export function subscribeOwnedPostgresChanges(
  client: Client,
  topic: string,
  filter: Filter,
  onChange: () => void,
): () => void {
  let active = true;
  let channel: RealtimeChannel | undefined;
  const stop = () => {
    if (!active) return;
    active = false;
    if (channel) {
      try { void client.removeChannel(channel).catch(() => undefined); }
      catch { /* Connection teardown must not interrupt route cleanup. */ }
    }
  };
  try {
    // The SDK returns an existing channel for a repeated topic. Removal is
    // asynchronous, so even an immediate unmount/remount needs a fresh name.
    channel = client.channel(`${topic}:${crypto.randomUUID()}`);
    channel.on("postgres_changes", filter, () => { if (active) onChange(); }).subscribe();
  } catch {
    stop(); // Keep each consumer's local/reconnect/poll fallback working.
  }
  return stop;
}
