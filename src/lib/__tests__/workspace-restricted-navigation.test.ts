import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionFlag } from "../permissions";
import { pageForRoute, pageEnabled } from "../permission-pages";
import { canSeeNavigationItem, routePermissionForPath } from "@/platforms/web/components/pos/nav-config";
import { shouldOpenRegister } from "../terminal-workspace";
const fixture = vi.hoisted(() => ({ permissions: {} as Record<string, boolean>, hidden: [] as string[], desktop: false }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ isAdmin: false, isSupervisor: false, isWarehouse: false, can: (key: string) => fixture.permissions[key] === true }) }));
vi.mock("@/lib/pos-store", () => ({ usePos: () => ({ currentStore: { id: "branch-a", name: "Branch A" }, state: { sales: [], products: [], settings: { integrations: {} } } }) }));
vi.mock("@/lib/management-device", () => ({ isManagementDevice: () => false }));
vi.mock("@/platform-config/platform", () => ({ isElectron: () => fixture.desktop }));
vi.mock("@tanstack/react-router", () => ({ useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: "/" } }), Link: ({ to, children, search, ...props }: { to: string; children: ReactNode; search?: unknown }) => h("a", { ...props, href: to, "data-search": JSON.stringify(search) }, children) }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children, TooltipTrigger: ({ children }: { children: ReactNode }) => children, TooltipContent: ({ children }: { children: ReactNode }) => h("span", null, children) }));
vi.mock("@/platforms/web/components/pos/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/SellingShortcuts", () => ({ SellingShortcuts: () => null }));
vi.mock("@/lib/use-report-sales", () => ({ useReportSales: () => ({ sales: [], loading: false, error: null }) }));
vi.mock("@/lib/use-viewed-branch-shift", () => ({ useViewedBranchShift: () => ({ shift: null, checked: true, error: false }) }));
vi.mock("@/platforms/web/components/pos/AnimatedMetric", () => ({ AnimatedMetric: ({ value }: { value: number }) => value }));
vi.mock("@/lib/ui-visibility", () => ({ useVisibility: () => ({ visible: (key: string) => !fixture.hidden.includes(key), visibleRoute }) }));
import { TerminalWorkspaceHome } from "@/platforms/web/components/pos/TerminalWorkspaceHome";
import { SidebarNav } from "@/platforms/web/components/pos/SidebarNav";
const can = (flag: PermissionFlag) => fixture.permissions[flag] === true;
const visibleRoute = (path: string) => {
  const page = pageForRoute(path);
  return !fixture.hidden.includes(path) && (!page || pageEnabled(fixture.permissions, page.id));
};
const render = (collapsed = false) => renderToStaticMarkup(h(SidebarNav, {
  collapsed, canSee: item => canSeeNavigationItem(item, can, false, visibleRoute),
}));
beforeEach(() => { fixture.permissions = { can_process_sale: true }; fixture.hidden = []; fixture.desktop = false; });
describe("restricted Home and Selling navigation", () => {
  it.each([false, true])("hides Home without dashboard permission, collapsed=%s", collapsed => {
    const html = render(collapsed);
    expect(html).not.toContain('aria-label="Home"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain('aria-label="Selling"');
    expect(html).toContain('href="/"');
  });
  it("shows Home only when the dashboard action is granted", () => {
    fixture.permissions.can_view_dashboard = true;
    expect(render()).toContain('aria-label="Home"');
    expect(render()).toContain('href="/dashboard"');
    fixture.permissions.can_view_dashboard = false;
    expect(render()).not.toContain('aria-label="Home"');
  });
  it("honours dashboard page visibility even with its action granted", () => {
    fixture.permissions.can_view_dashboard = true;
    fixture.permissions["page:dashboard"] = false;
    expect(render()).not.toContain('aria-label="Home"');
    expect(render()).toContain('aria-label="Selling"');
  });
  it("honours role visibility even when dashboard permission is granted", () => {
    fixture.permissions.can_view_dashboard = true;
    fixture.hidden = ["/dashboard"];
    expect(render()).not.toContain('aria-label="Home"');
  });
  it("does not expose Selling when its page is hidden", () => {
    const page = pageForRoute("/");
    expect(page).toBeDefined();
    fixture.permissions[`page:${page!.id}`] = false;
    expect(render()).not.toContain('aria-label="Selling"');
  });
  it("keeps Windows navigation restrictions and dashboard direct-route permission", () => {
    fixture.desktop = true;
    expect(render()).not.toContain('aria-label="Home"');
    expect(routePermissionForPath("/dashboard")).toBe("can_view_dashboard");
  });
  it("keeps cashier Retail entry distinct from explicit selling and held-bill resume", () => {
    const user = { isAdmin: false, isSupervisor: false, isCashier: true };
    expect(shouldOpenRegister(user)).toBe(false);
    expect(shouldOpenRegister({ ...user, forcedSelling: true })).toBe(true);
    expect(shouldOpenRegister({ ...user, resumeSale: true })).toBe(true);
    expect(shouldOpenRegister({ ...user, bookingFlow: true })).toBe(true);
  });
});

describe("restricted Retail workspace", () => {
  it("removes hidden card containers so low stock follows shift without empty slots", () => {
    fixture.permissions.can_view_inventory = true;
    const html = renderToStaticMarkup(h(TerminalWorkspaceHome));
    const overview = html.split('aria-label="Workspace overview"')[1].split('</section>')[0];
    expect(overview.match(/flex-\[1_1_11rem\]/g)).toHaveLength(2);
    expect(overview.indexOf("Shift")).toBeLessThan(overview.indexOf("Low stock"));
    fixture.hidden = ["workspace.shiftStatus","workspace.lowStock"];
    expect(renderToStaticMarkup(h(TerminalWorkspaceHome))).not.toContain('aria-label="Workspace overview"');
  });
  it("renders the cashier selling link without exposing revenue or reporting actions", () => {
    const html = renderToStaticMarkup(h(TerminalWorkspaceHome));
    expect(html).toContain("Retail workspace");
    expect(html).toContain("Sell now");
    expect(html).toContain('&quot;sell&quot;:true');
    expect(html).not.toContain("Today's revenue");
    expect(html).not.toContain('href="/receipts"');
  });
  it("does not expose a cart shortcut without selling permission", () => {
    fixture.permissions.can_process_sale = false;
    const html = renderToStaticMarkup(h(TerminalWorkspaceHome));
    expect(html).not.toContain("Sell now");
    expect(html).not.toContain("Open Register POS");
    expect(html).not.toContain('&quot;sell&quot;:true');
  });
});
