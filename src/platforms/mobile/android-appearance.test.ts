import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ setAppearance: native }) }));
import { syncAndroidAppearance } from "./android-appearance";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("tracks effective theme changes without repeating bridge calls and cleans up", () => {
  let dark = false;
  let changed = () => {};
  const disconnect = vi.fn();
  native.mockResolvedValue(undefined);
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => dark }, style: { colorScheme: "" } },
  });
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        changed = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const stop = syncAndroidAppearance();
  expect(native).toHaveBeenLastCalledWith({ dark: false });
  dark = true;
  changed();
  changed();
  expect(native).toHaveBeenCalledTimes(2);
  expect(native).toHaveBeenLastCalledWith({ dark: true });
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
});
it("keeps older APKs usable when the optional appearance bridge is absent", async () => {
  native.mockRejectedValue(new Error("not implemented"));
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => false }, style: { colorScheme: "dark" } },
  });
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const stop = syncAndroidAppearance();
  await Promise.resolve();
  expect(native).toHaveBeenCalledWith({ dark: true });
  stop();
});
