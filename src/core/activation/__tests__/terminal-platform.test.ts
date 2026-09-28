import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canRuntimeClaimToken,
  terminalRuntimePlatform,
  tokenPlatformForRuntime,
} from "@/core/activation/terminal-platform";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminal activation platform contract", () => {
  it("identifies Electron even when the Capacitor web shim is present", () => {
    vi.stubGlobal("window", {
      Capacitor: { getPlatform: () => "web" },
      pos: {},
    });

    expect(terminalRuntimePlatform()).toBe("electron");
    expect(tokenPlatformForRuntime(terminalRuntimePlatform())).toBe("pc");
  });

  it("identifies an Android native shell as mobile", () => {
    vi.stubGlobal("window", {
      Capacitor: { getPlatform: () => "android" },
    });

    expect(terminalRuntimePlatform()).toBe("android");
    expect(tokenPlatformForRuntime(terminalRuntimePlatform())).toBe("mobile");
  });

  it.each([
    ["pc", "electron", true],
    ["mobile", "android", true],
    ["pc", "android", false],
    ["mobile", "electron", false],
    ["pc", "web", false],
    ["mobile", "web", false],
    ["pc", "ios", false],
    ["mobile", "ios", false],
  ] as const)(
    "%s token on %s has claim result %s",
    (token, runtime, expected) => {
      expect(canRuntimeClaimToken(token, runtime)).toBe(expected);
    },
  );
});
