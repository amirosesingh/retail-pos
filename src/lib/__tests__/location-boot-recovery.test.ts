import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ stores: [] as { id: string; name: string }[], storesLoaded: false, locationLoadError: null as string | null, loadPhase: "loading", retryLoad: vi.fn(), isAdmin: true, pathname: "/inventory" }));
vi.mock("../pos-store", () => ({ usePos: () => state }));
vi.mock("../pos-auth", () => ({ useAuth: () => ({ isAdmin: state.isAdmin }) }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: state.pathname }), Link: ({ children, to }: { children: ReactNode; to: string }) => h("a", { href: to }, children) }));
vi.mock("@/components/shared/TillLoader", () => ({ TillLoader: ({ message }: { message: string }) => h("p", { role: "status" }, message) }));
vi.mock("@/lib/locations", () => ({ activeLocations: (stores: unknown[]) => stores }));
import { LocationBootGuard } from "@/platforms/web/components/pos/LocationBootGuard";
describe("location boot recovery", () => {
  beforeEach(() => Object.assign(state, { stores: [], storesLoaded: false, locationLoadError: null, loadPhase: "loading", isAdmin: true, pathname: "/inventory" }));
  const render = () => renderToStaticMarkup(h(LocationBootGuard, null, h("span", null, "Protected inventory")));
  it("keeps protected content hidden while the first location read is loading", () => {
    const html = render();
    expect(html).toContain("Loading locations");
    expect(html).not.toContain("Protected inventory");
  });
  it("offers recovery for a stalled read without fabricating a location or rendering protected content", () => {
    state.loadPhase = "stalled";
    const html = render();
    expect(html).toContain("Locations are taking longer");
    expect(html).toContain("Try again");
    expect(html).toContain("Check database connection");
    expect(html).not.toContain("Protected inventory");
    expect(html).not.toContain("No active location");
  });
  it("shows failed reads distinctly and limits administrator connection controls", () => {
    state.loadPhase = "failed"; state.locationLoadError = "The data service did not respond"; state.isAdmin = false;
    const html = render();
    expect(html).toContain("Could not load locations");
    expect(html).toContain("The data service did not respond");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Check database connection");
    expect(html).not.toContain("Protected inventory");
  });
  it("renders the existing content only after an active location exists", () => {
    state.stores = [{ id: "branch-a", name: "Branch A" }]; state.storesLoaded = true; state.loadPhase = "ready";
    expect(render()).toContain("Protected inventory");
  });
});
