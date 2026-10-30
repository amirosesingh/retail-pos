import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSyncWakeChannels } from "../sync-wake-channels";
afterEach(() => vi.useRealTimers());

function setup() {
  const channels: Array<{topic: string; status: (status: string, error?: Error) => void; change: (message: {payload: {table: unknown}}) => void}> = [];
  const client = {
    channel: vi.fn((topic: string) => {
      const saved = {topic, status: (_status: string, _error?: Error) => {}, change: (_message: {payload: {table: unknown}}) => {}};
      const channel = {
        on: (_event: string, _filter: unknown, callback: typeof saved.change) => {saved.change = callback; return channel;},
        subscribe: (callback: typeof saved.status) => {saved.status = callback; return channel;},
      };
      channels.push(saved);
      return channel as unknown as RealtimeChannel;
    }),
    removeChannel: vi.fn(async (_channel: RealtimeChannel) => "ok"),
  };
  const change = vi.fn(), reconnect = vi.fn();
  return {channels, client, change, reconnect, wake: createSyncWakeChannels(client, change, reconnect)};
}

describe("private sync wake channels", () => {
  it("does not join private topics when the verified identity disappears during preparation", async () => {
    const test = setup();
    const prepare = vi.fn(async () => false);
    const wake = createSyncWakeChannels(test.client, test.change, test.reconnect, prepare);
    await wake.replace("branch", "terminal", true);
    expect(prepare).toHaveBeenCalledOnce();
    expect(test.client.channel).not.toHaveBeenCalled();
  });
  it("does not subscribe without authentication or branch", async () => {
    const test = setup();
    await test.wake.replace("branch", "terminal", false);
    await test.wake.replace(null, "terminal", true);
    expect(test.client.channel).not.toHaveBeenCalled();
  });
  it("stops a permission-denied channel but preserves network reconnects", async () => {
    const test = setup();
    await test.wake.replace("branch", "terminal", true);
    test.channels[0].status("CHANNEL_ERROR", new Error("Unauthorized: no permissions"));
    expect(test.client.removeChannel).toHaveBeenCalledTimes(1);
    test.channels[1].status("CHANNEL_ERROR", new Error("Network disconnected"));
    test.channels[2].status("TIMED_OUT");
    expect(test.client.removeChannel).toHaveBeenCalledTimes(1);
    await test.wake.replace("branch", "terminal", true);
    expect(test.client.channel).toHaveBeenCalledTimes(6);
  });
  it("accepts table-name hints and catches up after reconnect", async () => {
    vi.useFakeTimers();
    const test = setup();
    await test.wake.replace("branch", null, true);
    test.channels[0].change({payload: {table: "products"}});
    test.channels[0].change({payload: {table: "products; DROP TABLE"}});
    test.channels[0].change({payload: {table: {amount: 123}}});
    expect(test.change).toHaveBeenCalledExactlyOnceWith("products");
    test.channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledOnce();
  });
  it("catches up once for a group join and once for each actual group reconnection", async () => {
    vi.useFakeTimers();
    const test = setup();
    await test.wake.replace("branch", "terminal", true);
    for (const channel of test.channels) channel.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledTimes(1);
    for (const channel of test.channels) channel.status("TIMED_OUT");
    for (const channel of test.channels) channel.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledTimes(2);
    test.channels[1].status("CHANNEL_ERROR", new Error("Network disconnected"));
    test.channels[1].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledTimes(3);
    test.channels[1].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledTimes(3);
  });
  it("ignores late callbacks from a replaced scope or a stopped session", async () => {
    vi.useFakeTimers();
    const test = setup();
    await test.wake.replace("branch-a", "terminal", true);
    const old = [...test.channels];
    await test.wake.replace("branch-b", "terminal", true);
    for (const channel of old) {
      channel.status("SUBSCRIBED");
      channel.change({payload: {table: "products"}});
    }
    expect(test.reconnect).not.toHaveBeenCalled();
    expect(test.change).not.toHaveBeenCalled();
    test.channels[3].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledOnce();
    await test.wake.stop();
    test.channels[3].status("SUBSCRIBED");
    test.channels[3].change({payload: {table: "products"}});
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledOnce();
    expect(test.change).not.toHaveBeenCalled();
  });
  it("retains catch-up for a late initial topic join and cancels queued work on stop", async () => {
    vi.useFakeTimers();
    const test = setup();
    await test.wake.replace("branch", "terminal", true);
    test.channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.reconnect).toHaveBeenCalledTimes(1);
    test.channels[1].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(test.reconnect).toHaveBeenCalledTimes(2);
    test.channels[2].status("SUBSCRIBED");
    await test.wake.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.reconnect).toHaveBeenCalledTimes(2);
  });
  it("does not defer catch-up indefinitely while a socket keeps flapping", async () => {
    vi.useFakeTimers();
    const test = setup();
    await test.wake.replace("branch", null, true);
    test.channels[0].status("SUBSCRIBED");
    for (let i = 0; i < 9; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
      test.channels[0].status("TIMED_OUT");
      test.channels[0].status("SUBSCRIBED");
    }
    expect(test.reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(test.reconnect).toHaveBeenCalledOnce();
    await test.wake.stop();
  });
});
