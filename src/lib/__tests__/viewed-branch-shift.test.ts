import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ store: "b", data: null as unknown, success: false, error: false, options: null as unknown as { queryFn: () => unknown; queryKey: unknown[]; enabled: boolean } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => { state.options = options as typeof state.options; return { data: state.data, isSuccess: state.success, isError: state.error, refetch: vi.fn() }; } }));
vi.mock("@/core/api/pos-db", () => ({ loadActiveShift: vi.fn() }));
vi.mock("@/lib/pos-store", () => ({ money: (v: number) => `RM ${v}`, usePos: () => ({ currentStore: { id: state.store, name: `Shop ${state.store}` }, activeShift: { storeId: "a", openedAt: "2026-10-19T01:00:00Z", openingFloat: 123 }, shiftChecked: true }) }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ user: { staffId: "admin" } }) }));
vi.mock("@/lib/active-branch", () => ({ activeBranchId: () => "a" }));
vi.mock("@/lib/session-epoch", () => ({ sessionEpoch: () => 7 }));
vi.mock("@/lib/shift-hours", () => ({ shiftDuration: () => "1 hour" }));
vi.mock("@/lib/sync-engine", () => ({ subscribeDataChange: vi.fn() }));
import { BranchShiftBanner } from "@/platforms/web/components/pos/BranchShiftBanner";
import { loadActiveShift } from "@/core/api/pos-db";
const render = () => renderToString(createElement(BranchShiftBanner));
beforeEach(() => { state.store = "b"; state.data = null; state.success = false; state.error = false; vi.clearAllMocks(); });
it("reads the selected branch without displaying the terminal branch shift", () => {
 state.data = { storeId: "b", openedAt: "2026-10-19T02:00:00Z", openingFloat: 456 }; state.success = true;
 const html = render(); expect(html).toContain("Shop b"); expect(html).toContain("RM 456"); expect(html).not.toContain("RM 123");
 state.options.queryFn(); expect(loadActiveShift).toHaveBeenCalledWith("b");
 expect(state.options.queryKey).toEqual(["viewed-branch-shift", 7, "admin", "b"]);
});
it("does not claim a selected shop is closed while loading or disconnected", () => {
 expect(render()).toContain("Checking the open shift"); state.error = true;
 const html = render(); expect(html).toContain("Shift status unavailable"); expect(html).not.toContain("No shift open"); expect(html).not.toContain("RM 123");
});
it("reuses the trading shift on the terminal branch without a duplicate query", () => {
 state.store = "a"; expect(render()).toContain("RM 123"); expect(state.options.enabled).toBe(false);
});
it("rejects a stale shift belonging to a different branch", () => {
 state.data = { storeId: "a", openedAt: "2026-10-19T02:00:00Z", openingFloat: 999 };
 expect(render()).not.toContain("RM 999");
});

