import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryDataRead, isTransientReadError } from "../read-retry";
import { __resetSessionEpoch, bumpSessionEpoch } from "../session-epoch";
import { businessReadsReady } from "../business-readiness";

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
    await vi.advanceTimersByTimeAsync(1000);
    await checked;
    expect(read).toHaveBeenCalledTimes(2);
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
  it("waits for profile and cloud session readiness on Web and Android", () => {
    expect(businessReadsReady(false, true, false, "staff")).toBe(false);
    expect(businessReadsReady(true, true, false, null)).toBe(false);
    expect(businessReadsReady(true, true, false, "staff")).toBe(true);
  });
  it("preserves signed-in Electron local reads without cloud authentication", () => {
    expect(businessReadsReady(true, true, true, null)).toBe(true);
    expect(businessReadsReady(true, false, true, null)).toBe(false);
  });
});
