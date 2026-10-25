import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, setState: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (value: unknown) => [value, mocks.setState],
  useEffect: (callback: () => (() => void) | void) => mocks.effects.push(callback),
}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => "/" }));
vi.mock("@/components/shared/TillLoader", () => ({ TillLoader: () => "Checking local SQL" }));
vi.mock("@/lib/live-mode", () => ({ isOnlineOnly: () => false }));
vi.mock("@/platform-config/features", () => ({ hasFeature: () => true }));
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn() } }));
import { NativeBoot } from "@/platforms/windows/components/DatabaseBoot";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
afterEach(() => { vi.unstubAllGlobals(); mocks.effects.length = 0; mocks.setState.mockClear(); });
it.each(["local", "online"])("does not let a previous online override bypass SQL validation; resolves to %s only after the current attempt", async target => {
  const values = new Map([["pos.startup.online-only", "1"]]);
  const pending = { state: "enabled_validating", enabled: true, configured: true, connected: false, tradingReady: false };
  let emit!: (state: typeof pending) => void;
  const off = vi.fn();
  vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) },
    pos: { database: { getState: async () => pending, subscribe: (cb: typeof emit) => { emit = cb; return off; } } } });
  expect(renderToStaticMarkup(h(NativeBoot, null, "Sales"))).toContain("Checking local SQL");
  const cleanup = mocks.effects[0]();
  await Promise.resolve();
  expect(mocks.setState).not.toHaveBeenCalled();
  emit(target === "local" ? {...pending, state:"enabled_ready", connected:true, tradingReady:true}
    : {...pending, state:"enabled_error"});
  expect(mocks.setState).toHaveBeenCalledWith(true);
  expect(effectiveDatabaseMode()).toBe(target);
  cleanup?.(); expect(off).toHaveBeenCalledOnce();
});
