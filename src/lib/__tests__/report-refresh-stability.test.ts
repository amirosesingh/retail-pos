import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effectCursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  focus: null as null | (() => void), salesChange: null as null | (() => void),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [
      harness.values[index],
      (next: unknown) => {
        harness.values[index] = typeof next === "function" ? next(harness.values[index]) : next;
      },
    ];
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = { current: initial };
    return harness.values[index];
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const index = harness.effectCursor++;
    const old = harness.effects[index];
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    harness.pending.push(() => {
      old?.cleanup?.();
      const cleanup = fn();
      harness.effects[index] = { deps, cleanup: cleanup || undefined };
    });
  },
}));
const load = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/pos-db", () => ({ loadSalesPage: (...args: unknown[]) => load(...args) }));
vi.mock("../sync-engine", () => ({ subscribeSalesChange: (fn: () => void) => { harness.salesChange = fn; return () => {}; } }));
vi.mock("../data-progress", () => ({
  beginDataTask: () => ({ report: vi.fn(), finish: vi.fn() }),
}));
vi.mock("../background-refresh", () => ({ subscribeBackgroundRefresh: (fn: () => void) => {
  harness.focus = fn;
  return () => { harness.focus = null; };
} }));
import { useReportSales } from "../use-report-sales";
const sale = {
  id: "sale-1",
  storeId: "branch-a",
  createdAt: "2026-10-12T12:00:00",
  total: 71,
} as Sale;
const page = { rows: [sale], hasMore: false, cursor: null };
function render(branch = "branch-a", from = "2026-10-12", to = from) {
  harness.cursor = 0;
  harness.effectCursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Deterministic hook dispatcher for refresh regression tests.
  const result = useReportSales([], [branch], from, to);
  const effects = harness.pending.splice(0);
  effects.forEach((fn) => fn());
  return result;
}
beforeEach(() => {
  harness.values = [];
  harness.effects = [];
  harness.pending = [];
  harness.focus = null; harness.salesChange = null;
  load.mockReset();
  vi.stubGlobal("window", {
    addEventListener: (name: string, fn: () => void) => {
      if (name === "focus") harness.focus = fn;
    },
    removeEventListener: () => {},
  });
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals(); vi.useRealTimers();
});
async function loaded() {
  load.mockResolvedValueOnce(page);
  render();
  await Promise.resolve();
  await Promise.resolve();
  expect(render().sales).toHaveLength(1);
}
describe("report refresh stability", () => {
  it("refreshes again for later live changes after the first batch", async () => {
    vi.useFakeTimers();
    await loaded();
    load.mockResolvedValue(page);
    harness.salesChange?.();
    harness.salesChange?.();
    await vi.advanceTimersByTimeAsync(100);
    render();
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    harness.salesChange?.();
    await vi.advanceTimersByTimeAsync(100);
    render();
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("retains existing rows during a same-range refresh", async () => {
    await loaded();
    load.mockImplementationOnce(() => new Promise(() => {}));
    harness.focus?.();
    render();
    const refreshing = render();
    expect(refreshing.loading).toBe(false);
    expect(refreshing.refreshing).toBe(true);
    expect(refreshing.sales).toEqual([sale]);
  });
  it("does not show a previous branch or date range while a new query loads", async () => {
    await loaded();
    load.mockImplementation(() => new Promise(() => {}));
    expect(render("branch-b").sales).toEqual([]);
    expect(render("branch-a", "2026-10-11").sales).toEqual([]);
  });
  it("finishes a slow read before applying one queued live refresh", async () => {
    let finish!: (value: typeof page) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render();
    harness.focus?.(); harness.focus?.();
    render();
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValue(page);
    finish(page); await Promise.resolve(); await Promise.resolve();
    render(); await Promise.resolve(); await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(render().sales).toEqual([sale]);
  });
  it("ignores an old branch response that arrives after switching branches", async () => {
    let finish!: (value: typeof page) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render();
    const other = { ...sale, id: "sale-b", storeId: "branch-b" };
    load.mockResolvedValueOnce({ ...page, rows: [other] });
    render("branch-b"); await Promise.resolve(); await Promise.resolve();
    finish(page); await Promise.resolve(); await Promise.resolve();
    expect(render("branch-b").sales).toEqual([other]);
  });
  it("keeps the last valid rows and reports an unsuccessful refresh", async () => {
    await loaded();
    load.mockRejectedValueOnce(new Error("Connection interrupted"));
    harness.focus?.();
    render();
    await Promise.resolve();
    await Promise.resolve();
    const result = render();
    expect(result.sales).toEqual([sale]);
    expect(result.error).toBe("Connection interrupted");
    expect(result.loading).toBe(false);
  });
});
