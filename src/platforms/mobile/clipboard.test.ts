import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock("@capacitor/clipboard", () => ({ Clipboard: native }));
import { copyText, readText } from "./clipboard";
beforeEach(() => vi.resetAllMocks());
it("writes exact confirmation text through the native bridge", async () => {
  await copyText("staff.identifier");
  expect(native.write).toHaveBeenCalledWith({ string: "staff.identifier" });
  expect(native.read).not.toHaveBeenCalled();
});
it("reads text on explicit request", async () => {
  native.read.mockResolvedValue({ type: "text/plain", value: "token-value" });
  expect(await readText()).toBe("token-value");
});
it("rejects nontext clipboard contents", async () => {
  native.read.mockResolvedValue({ type: "image/png", value: "image" });
  await expect(readText()).rejects.toThrow("does not contain text");
});
it("does not report success when the native clipboard fails", async () => {
  native.write.mockRejectedValue(new Error("denied"));
  await expect(copyText("name")).rejects.toThrow("denied");
});
