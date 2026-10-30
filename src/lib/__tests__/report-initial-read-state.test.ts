import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/query-core";
import type { Sale } from "@/core/types/pos-types";

const fixture = vi.hoisted(() => ({
  client: null as unknown as import("@tanstack/query-core").QueryClient,
  auth: { ready: true, user: { staffId: "person-a" } as { staffId: string } | null },
  states: [] as unknown[], cursor: 0, effectCursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[],
  refresh: null as null | (() => void), load: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => fixture.client }));
vi.mock("../pos-auth", () => ({ useAuth: () => fixture.auth }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.states[index], (next: unknown) => {
      fixture.states[index] = typeof next === "function" ? next(fixture.states[index]) : next;
    }];
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states)) fixture.states[index] = { current: initial };
    return fixture.states[index];
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const index = fixture.effectCursor++;
    const old = fixture.effects[index];
    if (old && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    fixture.pending.push(() => {
      old?.cleanup?.();
      fixture.effects[index] = { deps, cleanup: fn() || undefined };
    });
  },
}));
vi.mock("@/core/api/pos-db", () => ({ loadSalesPage: (...args: unknown[]) => fixture.load(...args), rowToSale: (value: unknown) => value }));
vi.mock("../management-device", () => ({ isManagementDevice: () => false }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => "online" }));
vi.mock("../sync-engine", () => ({ subscribeSalesChange: () => () => {} }));
vi.mock("../background-refresh", () => ({ subscribeBackgroundRefresh: (callback: () => void) => {
  fixture.refresh = callback; return () => { fixture.refresh = null; };
} }));

import { useReportSales } from "../use-report-sales";

const sale = { id: "recent", storeId: "a", createdAt: "2026-10-30T10:00:00Z", total: 50 } as Sale;
const full = { ...sale, id: "older", total: 100 };
const page = { rows: [sale, full], hasMore: false, cursor: null };
const defaults = { branch: "a", from: "2026-10-30", to: "2026-10-30", enabled: true, seed: [sale] };
function render(patch: Partial<typeof defaults> = {}, flush = true) {
  const options = { ...defaults, ...patch };
  fixture.cursor = 0; fixture.effectCursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Execute the real hook with a deterministic dispatcher, separating render from effects.
  const result = useReportSales(options.seed, [options.branch], options.from, options.to, options.enabled);
  if (flush) fixture.pending.splice(0).forEach(effect => effect());
  return result;
}
async function complete(patch: Partial<typeof defaults> = {}) {
  render(patch);
  await vi.waitFor(() => expect(render(patch).loading).toBe(false));
}
function remount() {
  fixture.effects.forEach(effect => effect.cleanup?.());
  fixture.states = []; fixture.effects = []; fixture.pending = [];
}
beforeEach(() => {
  fixture.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fixture.auth = { ready: true, user: { staffId: "person-a" } };
  fixture.states = []; fixture.effects = []; fixture.pending = [];
  fixture.refresh = null; fixture.load.mockReset().mockResolvedValue(page);
});
afterEach(() => { fixture.effects.forEach(effect => effect.cleanup?.()); fixture.client.clear(); });

describe("complete report readiness before the first effect", () => {
  it("does not label recent seeds complete before an uncached authoritative read starts", () => {
    const first = render({}, false);
    expect(first.sales).toEqual([sale]);
    expect(first.loading).toBe(true);
    expect(first.refreshing).toBe(false);
    expect(first.error).toBe("");
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it("finishes once with the complete rows without adding a second read", async () => {
    await complete();
    const result = render();
    expect(result.sales).toEqual([sale, full]);
    expect(result.loading).toBe(false);
    expect(fixture.load).toHaveBeenCalledOnce();
  });

  it("reuses a fresh cache on the first remount render without a loading flash or new backend read", async () => {
    await complete(); remount();
    const first = render({}, false);
    expect(first.loading).toBe(false);
    expect(first.sales).toEqual([sale, full]);
    render();
    await vi.waitFor(() => expect(render().refreshing).toBe(false));
    expect(fixture.load).toHaveBeenCalledOnce();
  });

  it("uses the current range's fresh cache immediately when revisiting it in the same mounted hook", async () => {
    await complete();
    const branchB = { ...sale, id: "b", storeId: "b" };
    fixture.load.mockResolvedValueOnce({ rows: [branchB], hasMore: false, cursor: null });
    await complete({ branch: "b", seed: [] });
    const returning = render({}, false);
    expect(returning.loading).toBe(false);
    expect(returning.sales).toEqual([sale, full]);
    expect(fixture.load).toHaveBeenCalledTimes(2);
  });

  it("recognizes a confirmed empty range as complete rather than reopening its loader", async () => {
    fixture.load.mockResolvedValueOnce({ rows: [], hasMore: false, cursor: null });
    await complete({ seed: [] }); remount();
    expect(render({ seed: [] }, false)).toEqual({ sales: [], loading: false, refreshing: false, error: "" });
    expect(fixture.load).toHaveBeenCalledOnce();
  });

  it.each([{ branch: "b", seed: [{ ...sale, storeId: "b" }] }, { from: "2026-10-29" }])(
    "treats the next uncached branch/date scope as incomplete before its effect: %j", async patch => {
      await complete();
      const changed = render(patch, false);
      expect(changed.loading).toBe(true);
      expect(changed.error).toBe("");
      expect(changed.sales.some(row => row.id === full.id)).toBe(false);
      expect(fixture.load).toHaveBeenCalledOnce();
    },
  );

  it("shows a keyed error after failure rather than an indefinite initial loader", async () => {
    fixture.load.mockRejectedValueOnce(new Error("Unavailable for A"));
    render();
    await vi.waitFor(() => expect(render().error).toBe("Unavailable for A"));
    expect(render().loading).toBe(false);
    const next = render({ branch: "b", seed: [] }, false);
    expect(next.loading).toBe(true);
    expect(next.error).toBe("");
  });

  it("preserves a completed same-scope snapshot during a background refresh", async () => {
    await complete();
    fixture.load.mockImplementationOnce(() => new Promise(() => {}));
    fixture.refresh?.(); render();
    const next = render();
    expect(next.loading).toBe(false);
    expect(next.refreshing).toBe(true);
    expect(next.sales).toEqual([sale, full]);
    expect(fixture.load).toHaveBeenCalledTimes(2);
  });

  it("does not display the old user's loaded rows or errors while a new identity starts", async () => {
    await complete();
    fixture.auth.user = { staffId: "person-b" };
    const changed = render({ seed: [] }, false);
    expect(changed.loading).toBe(true);
    expect(changed.sales).toEqual([]);
    expect(changed.error).toBe("");
  });

  it("returns an inactive view when disabled or signed out without starting a read", () => {
    expect(render({ enabled: false }, false)).toEqual({ sales: [], loading: false, refreshing: false, error: "" });
    fixture.auth.user = null;
    expect(render({}, false)).toEqual({ sales: [], loading: false, refreshing: false, error: "" });
    expect(fixture.load).not.toHaveBeenCalled();
  });
});
