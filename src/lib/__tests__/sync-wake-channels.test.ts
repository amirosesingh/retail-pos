import { describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSyncWakeChannels } from "../sync-wake-channels";

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
    const test = setup();
    await test.wake.replace("branch", null, true);
    test.channels[0].change({payload: {table: "products"}});
    test.channels[0].change({payload: {table: "products; DROP TABLE"}});
    test.channels[0].change({payload: {table: {amount: 123}}});
    expect(test.change).toHaveBeenCalledExactlyOnceWith("products");
    test.channels[0].status("SUBSCRIBED");
    expect(test.reconnect).toHaveBeenCalledOnce();
  });
});
