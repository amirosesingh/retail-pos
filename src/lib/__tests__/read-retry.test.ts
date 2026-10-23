import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryDataRead, isTransientReadError, withReadDeadline } from "../read-retry";
import { __resetSessionEpoch, bumpSessionEpoch } from "../session-epoch";
import { businessReadsReady, transferReadsReady } from "../business-readiness";

describe("read-only transient recovery", () => {
  beforeEach(() => { __resetSessionEpoch(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());
  it("retries a temporary failure once and returns the complete successful result", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(["row"]);
    const result = retryDataRead(read);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toEqual(["row"]);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("reports a persistent failure after the bounded retry", async () => {
    const failure = new Error("Network error");
    const read = vi.fn().mockRejectedValue(failure);
    const checked = expect(retryDataRead(read)).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1500);
    await checked;
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("allows a connection time to recover without retrying writes", async () => {
    const read = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(["complete"]);
    const result = retryDataRead(read);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toEqual(["complete"]);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not retry deliberate cancellation", async () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    const read = vi.fn().mockRejectedValue(error);
    await expect(retryDataRead(read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledOnce();
  });
  it("releases a stalled composite read and clears its deadline after success", async () => {
    const result = withReadDeadline(() => new Promise(() => {}), 1000);
    const checked = expect(result).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(1000);
    await checked;
    expect(await withReadDeadline(async () => ["staff"], 1000)).toEqual(["staff"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { status: 403, message: "permission denied" },
    { status: 401, message: "JWT expired" },
    { code: "42703", message: "column timeout does not exist" },
    { code: "23505", message: "duplicate key" },
  ])("does not retry authorization, validation or schema errors: $message", async failure => {
    const read = vi.fn().mockRejectedValue(failure);
    await expect(retryDataRead(read)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
  });
  it("does not continue retries after another user signs in", async () => {
    const read = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const checked = expect(retryDataRead(read)).rejects.toThrow("superseded");
    await vi.advanceTimersByTimeAsync(0);
    bumpSessionEpoch();
    await vi.advanceTimersByTimeAsync(300);
    await checked;
    expect(read).toHaveBeenCalledOnce();
  });
  it("discards a successful response belonging to an older sign-in", async () => {
    let finish!: (rows: string[]) => void;
    const request = retryDataRead(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const checked = expect(request).rejects.toThrow("superseded");
    bumpSessionEpoch(); finish(["old user's rows"]);
    await checked;
  });
  it("recognizes database statement timeouts without retrying arbitrary SQL errors", () => {
    expect(isTransientReadError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(true);
    expect(isTransientReadError({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("business read startup ordering", () => {
  it("waits for the current user's initial snapshot before loading transfers", () => {
    expect(transferReadsReady(true, "loading", "user-a", null, "store-a")).toBe(false);
    expect(transferReadsReady(true, "ready", "user-a", "user-b", "store-a")).toBe(false);
    expect(transferReadsReady(true, "ready", "user-a", "user-a", null)).toBe(false);
    expect(transferReadsReady(false, "ready", "user-a", "user-a", "store-a")).toBe(false);
    expect(transferReadsReady(true, "ready", "user-a", "user-a", "store-a")).toBe(true);
  });
  it("waits for profile and cloud session readiness on Web and Android", () => {
    expect(businessReadsReady(false, true, false, "staff", true)).toBe(false);
    expect(businessReadsReady(true, true, false, null, true)).toBe(false);
    expect(businessReadsReady(true, true, false, "staff", false)).toBe(false);
    expect(businessReadsReady(true, true, false, "staff", true)).toBe(true);
  });
  it("preserves signed-in Electron local reads without cloud authentication", () => {
    expect(businessReadsReady(true, true, true, null, false)).toBe(true);
    expect(businessReadsReady(true, false, true, null, false)).toBe(false);
  });
});
