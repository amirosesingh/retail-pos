import { describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { subscribeOwnedPostgresChanges } from "../owned-postgres-subscription";

function fixture() {
  const channels = new Map<string, { joined: boolean; emit: () => void; filter?: unknown; api: RealtimeChannel }>();
  const removals: (() => void)[] = [];
  const client = {
    channel: vi.fn((topic: string) => {
      const existing = channels.get(topic);
      if (existing) return existing.api;
      const state = { joined: false, emit: (() => undefined) as () => void, filter: undefined as unknown, api: undefined as unknown as RealtimeChannel };
      state.api = {
        on: (_: string, filter: unknown, callback: () => void) => {
          if (state.joined) throw new Error("cannot add postgres_changes callbacks after subscribe()");
          state.filter = filter;
          state.emit = callback;
          return state.api;
        },
        subscribe: () => { state.joined = true; return state.api; },
      } as unknown as RealtimeChannel;
      channels.set(topic, state);
      return state.api;
    }),
    removeChannel: vi.fn((channel: RealtimeChannel) => new Promise<void>(resolve => {
      removals.push(() => {
        for (const [topic, state] of channels) if (state.api === channel) channels.delete(topic);
        resolve();
      });
    })),
  };
  return { client, channels, removals };
}
const filter = { event: "*" as const, schema: "public", table: "settings_scoped", filter: "scope_id=eq.person-a" };

describe("owned Postgres subscriptions", () => {
  it("allows immediate route remount before asynchronous cleanup finishes", () => {
    const { client, channels, removals } = fixture();
    const oldChange = vi.fn();
    const stop = subscribeOwnedPostgresChanges(client, "appearance", filter, oldChange);
    const old = [...channels.values()][0];
    stop();
    const newChange = vi.fn();
    const stopNew = subscribeOwnedPostgresChanges(client, "appearance", filter, newChange);
    expect(channels.size).toBe(2);
    old.emit();
    expect(oldChange).not.toHaveBeenCalled();
    removals[0]();
    expect(channels.size).toBe(1);
    const current = [...channels.values()][0];
    expect(current.filter).toEqual(filter);
    current.emit();
    expect(newChange).toHaveBeenCalledOnce();
    stopNew();
  });
  it("keeps simultaneous subscribers independent and preserves branch filters", () => {
    const { client, channels } = fixture();
    const first = vi.fn(), second = vi.fn();
    const branchFilter = { ...filter, table: "authorization_requests", filter: "store_id=eq.branch-a" };
    const stop = subscribeOwnedPostgresChanges(client, "approvals", branchFilter, first);
    const stopSecond = subscribeOwnedPostgresChanges(client, "approvals", branchFilter, second);
    expect(client.channel).toHaveBeenCalledOnce();
    stop(); stop();
    for (const channel of channels.values()) { expect(channel.filter).toEqual(branchFilter); channel.emit(); }
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(client.removeChannel).not.toHaveBeenCalled();
    stopSecond();
    expect(client.removeChannel).toHaveBeenCalledOnce();
  });
  it("never shares a channel between branch filters", () => {
    const { client } = fixture();
    const a = subscribeOwnedPostgresChanges(client, "approvals", filter, vi.fn());
    const b = subscribeOwnedPostgresChanges(client, "approvals", { ...filter, filter: "scope_id=eq.person-b" }, vi.fn());
    expect(client.channel).toHaveBeenCalledTimes(2);
    a(); b();
  });
  it("does not crash a page if realtime setup fails and cleans partial setup", () => {
    const { client, channels } = fixture();
    const create = client.channel.getMockImplementation()!;
    client.channel.mockImplementation(topic => {
      const channel = create(topic);
      channel.subscribe = () => { throw new Error("connection unavailable"); };
      return channel;
    });
    const changed = vi.fn();
    expect(() => subscribeOwnedPostgresChanges(client, "appearance", filter, changed)).not.toThrow();
    expect(client.removeChannel).toHaveBeenCalledOnce();
    for (const channel of channels.values()) channel.emit();
    expect(changed).not.toHaveBeenCalled();
  });
  it("handles a rejected asynchronous unsubscribe", async () => {
    const { client } = fixture();
    client.removeChannel.mockRejectedValue(new Error("disconnected"));
    const stop = subscribeOwnedPostgresChanges(client, "appearance", filter, vi.fn());
    expect(stop).not.toThrow();
    await Promise.resolve();
  });
});
