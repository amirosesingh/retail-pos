import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ theme: vi.fn(), bars: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({ setAppearance: native.theme }),
  SystemBars: { setStyle: native.bars },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT" },
}));
import { syncIosAppearance } from "../appearance";

describe("iPhone native appearance", () => {
  let dark: boolean;
  let scheme: string;
  let changed: () => void;
  const disconnect = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    dark = false;
    scheme = "light";
    native.theme.mockResolvedValue(undefined);
    native.bars.mockResolvedValue(undefined);
    vi.stubGlobal("document", {
      documentElement: {
        classList: { contains: () => dark },
        style: {
          get colorScheme() {
            return scheme;
          },
        },
      },
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
  });
  afterEach(() => vi.unstubAllGlobals());
  it("updates icon contrast when the operator changes theme", () => {
    const stop = syncIosAppearance();
    expect(native.bars).toHaveBeenLastCalledWith({ style: "LIGHT" });
    dark = true;
    changed();
    expect(native.theme).toHaveBeenLastCalledWith({ dark: true });
    expect(native.bars).toHaveBeenLastCalledWith({ style: "DARK" });
    changed();
    expect(native.bars).toHaveBeenCalledTimes(2);
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("honours a palette that forces dark native controls", () => {
    scheme = "dark";
    syncIosAppearance();
    expect(native.theme).toHaveBeenCalledWith({ dark: true });
  });
  it("continues on an earlier IPA without the optional native theme method", async () => {
    native.theme.mockRejectedValue(new Error("not implemented"));
    const stop = syncIosAppearance();
    await Promise.resolve();
    expect(native.bars).toHaveBeenCalledOnce();
    stop();
  });
});
