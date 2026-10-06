import { afterEach, describe, expect, it, vi } from "vitest";

import { closeCurrentCustomerDisplay } from "@/lib/customer-display";

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
});
