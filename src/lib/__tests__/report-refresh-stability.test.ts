import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effectCursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  focus: null as null | (() => void),
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
vi.mock("../sync-engine", () => ({ subscribeSalesChange: () => () => {} }));
vi.mock("../data-progress", () => ({
  beginDataTask: () => ({ report: vi.fn(), finish: vi.fn() }),
}));
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
  harness.focus = null;
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
  vi.unstubAllGlobals();
});
async function loaded() {
  load.mockResolvedValueOnce(page);
  render();
  await Promise.resolve();
  await Promise.resolve();
  expect(render().sales).toHaveLength(1);
}
describe("report refresh stability", () => {
  it("retains existing rows during a same-range refresh", async () => {
    await loaded();
    load.mockImplementationOnce(() => new Promise(() => {}));
    harness.focus?.();
    render();
    const refreshing = render();
    expect(refreshing.loading).toBe(true);
    expect(refreshing.sales).toEqual([sale]);
  });
  it("does not show a previous branch or date range while a new query loads", async () => {
    await loaded();
    load.mockImplementation(() => new Promise(() => {}));
    expect(render("branch-b").sales).toEqual([]);
    expect(render("branch-a", "2026-10-11").sales).toEqual([]);
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
