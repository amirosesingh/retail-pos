import { createElement as h, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

it("retains shell ownership across module reloads and independently loaded route wrappers", async () => {
  const first = await import("../app-shell-context");
  vi.resetModules();
  const reloaded = await import("../app-shell-context");
  expect(reloaded.AppShellContext).toBe(first.AppShellContext);
  function RouteWrapper() {
    return h("span", null, useContext(first.AppShellContext) ? "page content" : "duplicate navigation");
  }
  const html = renderToStaticMarkup(h(reloaded.AppShellContext.Provider, { value: true }, h(RouteWrapper)));
  expect(html).toContain("page content");
  expect(html).not.toContain("duplicate navigation");
});
