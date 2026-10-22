import { describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue({ value: "saved" }), set: vi.fn(), remove: vi.fn(), then: vi.fn() }));
vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: new Proxy({}, { get: (_target, property) => calls[property as keyof typeof calls] }),
}));
import { approvalTokenStore } from "@/platform-config/approval-token-store";
describe("native approval storage", () => {
  it("does not assimilate the native plugin as a promise and forwards storage calls", async () => {
    const store = await approvalTokenStore();
    expect(calls.then).not.toHaveBeenCalled();
    expect(await store.get({ key: "token" })).toEqual({ value: "saved" });
    await store.set({ key: "token", value: "new" });
    await store.remove({ key: "token" });
    expect(calls.get).toHaveBeenCalledWith({ key: "token" });
    expect(calls.set).toHaveBeenCalledWith({ key: "token", value: "new" });
    expect(calls.remove).toHaveBeenCalledWith({ key: "token" });
  });
});
