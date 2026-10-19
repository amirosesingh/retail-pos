import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ changed: () => {}, reads: [] as Array<(value: unknown) => void> }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => true }));
vi.mock("@/lib/connection-profile", () => ({ hydrateConnectionProfile: async () => {}, isConnectionProfileHydrated: () => true, subscribeProfileHydrated: () => () => {} }));
vi.mock("@/lib/secure-cloud-config", () => ({ cloudKeyStatus: () => new Promise(resolve => state.reads.push(resolve)), subscribeCloudKeys: (fn: () => void) => { state.changed = fn; return () => {}; } }));
vi.mock("@/lib/external-supabase-config", () => ({ hasTerminalSupabaseOverride: () => false }));
vi.mock("@/lib/backend-config", () => ({ backendUrl: async () => "https://pos.example.com" }));
import { subscribeConfigReady } from "../platform-config-ready";

it("ignores stale vault checks and callbacks after unsubscribe", async () => {
  const callback = vi.fn();
  const stop = subscribeConfigReady(callback);
  await vi.waitFor(() => expect(state.reads).toHaveLength(1));
  state.changed();
  await vi.waitFor(() => expect(state.reads).toHaveLength(2));
  state.reads[1]({ configured: true, url: "https://tenant.example.com" });
  await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
  expect(callback.mock.calls[0][0]).toMatchObject({ state: "ready" });
  state.reads[0]({ configured: false, url: "" });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(callback).toHaveBeenCalledOnce();
  state.changed();
  await vi.waitFor(() => expect(state.reads).toHaveLength(3));
  stop();
  state.reads[2]({ configured: false, url: "" });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(callback).toHaveBeenCalledOnce();
});
