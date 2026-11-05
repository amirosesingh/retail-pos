import { afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ runtime: "electron", config: null as null | { deviceUse: string; locationId: string; locationName: string } }));
vi.mock("@/core/activation/terminal-platform", () => ({ terminalRuntimePlatform: () => f.runtime }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => f.config }));
vi.mock("@/core/local-db/local-db", () => ({ readBranch: () => ({ branchId: "old", branchName: "Old" }) }));
import { activeBranchId, activeBranchName, bindTerminalBranch, requireBranchId } from "../active-branch";
afterEach(() => { vi.unstubAllGlobals(); f.config = null; f.runtime = "electron"; });
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

it("web management ignores a cached native claim and keeps writes on the selected branch", () => {
 const storage = new Map([["terminal_branch_id", "STR1"], ["terminal_branch_name", "Old shop"]]);
 vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
 f.runtime = "web";
 f.config = { deviceUse: "operations", locationId: "STR1", locationName: "Old shop" };
 // These are the branch values used by openShift and saveSale before any write.
 expect(activeBranchId("BET2")).toBe("BET2");
 expect(requireBranchId("BET2")).toBe("BET2");
 expect(activeBranchName("Beta shop")).toBe("Beta shop");
 bindTerminalBranch("BET2", "Beta shop");
 expect(requireBranchId("BET2")).toBe("BET2");
 expect(activeBranchId()).toBe("BET2");
 expect(storage.get("terminal_branch_id")).toBe("BET2");
});
