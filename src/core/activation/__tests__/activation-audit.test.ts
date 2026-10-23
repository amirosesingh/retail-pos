import { expect, it, vi } from "vitest";
const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-log", () => ({ logger: { log } }));
vi.mock("@/platform-config/platform", () => ({ isAndroid: () => true, isIOS: () => false }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => false, isMobileShell: () => true }));
import { recordActivationAttempt } from "../terminal-activation-log";

it("retains activation attempts in the journal without anonymous cloud audit inserts", async () => {
  const from = vi.fn();
  await recordActivationAttempt({ from }, { outcome: "succeeded", terminalId: "terminal-1", branchId: "branch-1" });
  expect(from).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith("security", "Terminal activation succeeded", "Terminal activation",
    expect.objectContaining({ terminalId: "terminal-1", branchId: "branch-1", devicePlatform: "android" }));
});
