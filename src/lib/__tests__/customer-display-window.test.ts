import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeCurrentCustomerDisplay,
  closeCustomerDisplay,
  DISPLAY_STORAGE_KEY,
} from "@/lib/customer-display";

describe("customer display window ownership", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks Electron to close only the current secondary window", () => {
    const closeWindow = vi.fn().mockResolvedValue({ ok: true });
    const browserClose = vi.fn();
    vi.stubGlobal("window", { pos: { closeWindow }, opener: null, close: browserClose });

    expect(closeCurrentCustomerDisplay()).toBe(true);
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(browserClose).not.toHaveBeenCalled();
  });

  it("does not navigate a normal same-window browser route", () => {
    vi.stubGlobal("window", { pos: undefined, opener: null, close: vi.fn() });

    expect(closeCurrentCustomerDisplay()).toBe(false);
  });

  it("removes the last customer's display snapshot when the display closes", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("window", {
      localStorage: { setItem: vi.fn(), removeItem },
    });

    closeCustomerDisplay();

    expect(removeItem).toHaveBeenCalledWith(DISPLAY_STORAGE_KEY);
  });
});

// The display receives basket broadcasts; it must never open staff setup or updater UI.
it("renders the customer route outside terminal connection, auth and update gates", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  expect(root).toContain('const customerDisplay = pathname === "/display"');
  expect(root).toContain('{customerDisplay ? <Outlet /> : <>');
  expect(root.indexOf('{customerDisplay ? <Outlet /> : <>')).toBeLessThan(root.indexOf('<NativeBoot>'));
  expect(root).toContain('if (customerDisplay) return;');
});
