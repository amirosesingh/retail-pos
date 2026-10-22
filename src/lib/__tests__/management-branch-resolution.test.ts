import { afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ config: null as null | { deviceUse: string; locationId: string; locationName: string } }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => f.config }));
vi.mock("@/core/local-db/local-db", () => ({ readBranch: () => ({ branchId: "old", branchName: "Old" }) }));
import { activeBranchId, activeBranchName, bindTerminalBranch, requireBranchId } from "../active-branch";
afterEach(() => { vi.unstubAllGlobals(); f.config = null; });
it("management uses only the selected branch, never a previous terminal binding", () => {
 const storage = new Map([["terminal_branch_id", "old"], ["terminal_branch_name", "Old"]]);
 vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key), removeItem: (key: string) => storage.delete(key) } });
 f.config = { deviceUse: "management", locationId: "", locationName: "All branches — management" };
 expect(activeBranchId("new")).toBe("new");
 expect(activeBranchName("New")).toBe("New");
 expect(() => requireBranchId()).toThrow("pick a branch");
 expect(bindTerminalBranch("old", "Old")).toBeNull();
 expect(storage.size).toBe(0);
});
it("operations continues to enforce the registered branch over the selected branch", () => {
 f.config = { deviceUse: "operations", locationId: "registered", locationName: "Registered" };
 expect(activeBranchId("other")).toBe("registered");
 expect(activeBranchName("Other")).toBe("Registered");
});
