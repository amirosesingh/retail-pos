import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ path: "/dashboard", allowed: true, hidden: "" }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: fixture.path }), Link: ({ to, children }: { to: string; children: ReactNode }) => h("a", { href: to }, children) }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ isAdmin: false, can: () => fixture.allowed }) }));
vi.mock("@/lib/ui-visibility", () => ({ useVisibility: () => ({ visibleRoute: (path: string) => path !== fixture.hidden }) }));
import { HomeShortcuts } from "@/platforms/web/components/pos/HomeShortcuts";
beforeEach(() => { fixture.path = "/dashboard"; fixture.allowed = true; fixture.hidden = ""; });
it.each(["/dashboard", "/stores", "/all-shops", "/analytics"])("omits current page %s and retains sibling links", path => {
  fixture.path = path;
  const html = renderToStaticMarkup(h(HomeShortcuts));
  expect(html).not.toContain(`href="${path}"`);
  for (const sibling of ["/dashboard", "/stores", "/all-shops", "/analytics"].filter(item => item !== path)) expect(html).toContain(`href="${sibling}"`);
});
it("does not expose links without permission or through a visibility override", () => {
  fixture.allowed = false;
  expect(renderToStaticMarkup(h(HomeShortcuts))).toBe("");
  fixture.allowed = true; fixture.hidden = "/stores";
  expect(renderToStaticMarkup(h(HomeShortcuts))).not.toContain('href="/stores"');
});
