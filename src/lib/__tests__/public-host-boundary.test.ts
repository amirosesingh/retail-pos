import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ terminal: false, read: vi.fn() }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => state.terminal }));
vi.mock("../public-host-config.functions", () => ({ readPublicHostConfig: state.read }));
vi.mock("../public-flags", () => ({ usePublicFlags: () => ({ ready: false, flags: { member: false, redeem: false } }) }));
import { PublicHostBoundary } from "@/platforms/web/components/pos/PublicHostBoundary";

beforeEach(() => { state.terminal = false; state.read.mockReset(); });

describe("host boundary startup isolation", () => {
  it("does not mount the POS login or its providers before classifying a web host", () => {
    const mount = vi.fn();
    function Till() { mount(); return h("div", null, "POS login"); }
    const html = renderToStaticMarkup(h(PublicHostBoundary, { pathname: "/", children: h(Till) }));
    expect(html).toContain("Loading");
    expect(html).not.toContain("POS login");
    expect(mount).not.toHaveBeenCalled();
  });
  it("leaves Electron and Capacitor startup untouched, with no public-host lookup", () => {
    state.terminal = true;
    expect(renderToStaticMarkup(h(PublicHostBoundary, { pathname: "/", children: h("div", null, "Native POS") }))).toContain("Native POS");
    expect(state.read).not.toHaveBeenCalled();
  });
});
