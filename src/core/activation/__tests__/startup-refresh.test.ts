import { beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [typeof initial === "function" ? initial() : initial, setter];
  },
  useEffect: vi.fn(),
}));
vi.mock("@/core/activation/connection-health", () => ({
  connectivity: () => "online", lastHealth: () => ({ cloud: true }),
  cloudVerdict: () => "verified", hasProbedCloud: () => true,
  subscribeConnectivity: vi.fn(), checkHealth: vi.fn(),
}));
vi.mock("@/lib/secure-cloud-config", () => ({ cloudKeyStatus: vi.fn(), subscribeCloudKeys: vi.fn() }));
vi.mock("@/core/activation/activation-record", () => ({ isRegistered: vi.fn() }));
vi.mock("@/core/activation/terminal-tokens", () => ({ subscribeTerminalConfig: vi.fn() }));
import { useStartupGate } from "../registration-status";

beforeEach(() => { hooks.setters.length = 0; });
it("blocks stale routing synchronously when Continue requests a registration refresh", () => {
  const gate = useStartupGate();
  expect(gate.probing).toBe(false);
  gate.refresh();
  const probing = hooks.setters[4];
  const tick = hooks.setters[5];
  expect(probing).toHaveBeenCalledWith(true);
  expect(probing.mock.invocationCallOrder[0]).toBeLessThan(tick.mock.invocationCallOrder[0]);
  expect(tick.mock.calls[0][0](0)).toBe(1);
});
