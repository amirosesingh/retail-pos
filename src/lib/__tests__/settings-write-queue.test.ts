import { describe, expect, it, vi } from "vitest";
import { SettingsWriteQueue, settingsWriteGroup } from "../settings-write-queue";

describe("scoped settings writes", () => {
  it("coalesces only complete supported setting sections without mixing unrelated edits", () => {
    expect(settingsWriteGroup({ payment: { note: "new" } })).toBe("payment");
    expect(settingsWriteGroup({ integrations: { paymentAccounts: [] } })).toBe("paymentAccounts");
    expect(settingsWriteGroup({ integrations: { serviceTypes: [], bookingRules: {} } })).toBe("booking");
    expect(settingsWriteGroup({ receipt: { bookingSlip: { terms: "terms" } } })).toBe("bookingSlip");
    expect(settingsWriteGroup({ whatsapp: { greeting: "hello" } })).toBe("whatsapp");
    expect(settingsWriteGroup({ integrations: { serviceTypes: [], autoArchiveZeroStock: true } })).toBeUndefined();
    expect(settingsWriteGroup({ payment: {}, tax: {} })).toBeUndefined();
  });
  it("retains the in-flight payment save and only the latest waiting snapshot", async () => {
    const queue = new SettingsWriteQueue();
    const writes: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    queue.enqueueLatest("GLOBAL", "payment", async () => { await gate; writes.push(0); });
    await Promise.resolve();
    for (let index = 1; index <= 30; index++) queue.enqueueLatest("GLOBAL", "payment", async () => { writes.push(index); });
    release();
    await queue.flush();
    expect(writes).toEqual([0, 30]);
    expect(queue.pending).toBe(false);
  });
  it("does not replace another section or an intervening ordinary write", async () => {
    const queue = new SettingsWriteQueue();
    const writes: string[] = [];
    queue.enqueueLatest("GLOBAL", "payment", async () => { writes.push("bank"); });
    queue.enqueueLatest("GLOBAL", "paymentAccounts", async () => { writes.push("accounts"); });
    queue.enqueue("GLOBAL", async () => { writes.push("tax"); });
    queue.enqueueLatest("GLOBAL", "paymentAccounts", async () => { writes.push("latest accounts"); });
    await queue.flush();
    expect(writes).toEqual(["bank", "accounts", "tax", "latest accounts"]);
  });
  it("retains a refused latest payment snapshot for retry", async () => {
    const queue = new SettingsWriteQueue();
    const refused = vi.fn().mockRejectedValue(new Error("refused"));
    queue.enqueueLatest("GLOBAL", "payment", refused);
    await expect(queue.flush()).rejects.toThrow("refused");
    expect(queue.pending).toBe(true);
    refused.mockResolvedValue(undefined);
    await queue.flush();
    expect(queue.pending).toBe(false);
  });
  it("serializes rapid writes to the same scope", async () => {
    const queue = new SettingsWriteQueue();
    const writes: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    queue.enqueue("BRANCH:1:printer", async () => { await gate; writes.push(1); });
    queue.enqueue("BRANCH:1:printer", async () => { writes.push(2); });
    expect(queue.pending).toBe(true);
    release();
    await queue.flush();
    expect(writes).toEqual([1, 2]);
    expect(queue.pending).toBe(false);
  });
  it("retries a failed write without redirecting it to global settings", async () => {
    const queue = new SettingsWriteQueue();
    const saveBranch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    queue.enqueue("BRANCH:1:printer", saveBranch);
    await queue.flush();
    expect(saveBranch).toHaveBeenCalledTimes(2);
    expect(queue.pending).toBe(false);
  });
  it("keeps failures visible when the retry is refused", async () => {
    const queue = new SettingsWriteQueue();
    queue.enqueue("BRANCH:1:printer", async () => { throw new Error("refused"); });
    await expect(queue.flush()).rejects.toThrow("refused");
    expect(queue.pending).toBe(true);
  });
});
