import { afterEach, expect, it, vi } from "vitest";
import { noteConnectivityIssue, clearConnectivityIssue } from "../session-expiry";

const toast = vi.hoisted(() => ({ warning: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps the warning cooldown across recovery and suppresses stale queued warnings", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  vi.stubGlobal("window", {});
  noteConnectivityIssue();
  await vi.dynamicImportSettled();
  expect(toast.warning).toHaveBeenCalledOnce();
  clearConnectivityIssue();
  await vi.dynamicImportSettled();
  expect(toast.dismiss).toHaveBeenCalledWith("pos-connectivity");
  vi.advanceTimersByTime(1000);
  noteConnectivityIssue();
  await vi.dynamicImportSettled();
  expect(toast.warning).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(14000);
  noteConnectivityIssue();
  await vi.dynamicImportSettled();
  expect(toast.warning).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60000);
  noteConnectivityIssue();
  clearConnectivityIssue();
  await vi.dynamicImportSettled();
  expect(toast.warning).toHaveBeenCalledTimes(2);
  expect(toast.dismiss).toHaveBeenCalledTimes(2);
});
