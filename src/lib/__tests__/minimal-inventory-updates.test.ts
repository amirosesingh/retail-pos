import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({
  updates: {
    state: { status: "ready", version: "1.0.0", available: "1.0.1", percent: 100, error: null },
    supported: true, installing: false, manifestChecking: false, releaseNotes: "Faster startup", check: vi.fn(),
  },
}));
vi.mock("@/lib/app-updates", () => ({ APP_VERSION: "1.0.0", useAppUpdates: () => mocks.updates }));
import { UpdateHeaderButton } from "@/platforms/web/components/pos/UpdateHeaderButton";
import { MinimalUpdatePanel } from "@/platforms/web/components/pos/MinimalUpdatePanel";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";

describe("minimal inventory and native update controls", () => {
  it("shows the Electron update action only for an actionable release", () => {
    mocks.updates.state.status = "ready";
    const html = renderToStaticMarkup(h(UpdateHeaderButton));
    expect(html).toContain("Software update available");
    expect(html).not.toContain('href="/settings/updates"');
    for (const status of ["current", "unavailable"]) {
      mocks.updates.state.status = status;
      expect(renderToStaticMarkup(h(UpdateHeaderButton))).toBe("");
    }
    mocks.updates.state.status = "ready";
    mocks.updates.supported = false;
    expect(renderToStaticMarkup(h(UpdateHeaderButton))).toBe("");
    mocks.updates.supported = true;
    const shell = readFileSync("src/platforms/web/components/pos/AppShell.tsx", "utf8");
    expect(shell).not.toContain("<UpdateHeaderButton />");
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain("<DesktopUpdateBanner />");
  });
  it("keeps one primary update action and puts notes behind disclosure", () => {
    const html = renderToStaticMarkup(h(MinimalUpdatePanel, { updates: mocks.updates as never }));
    expect(html).toContain("Version 1.0.1 is available");
    expect(html).toContain("Installed v1.0.0");
    expect(html).toContain("Update and restart");
    expect(html).toContain("<details>");
  });
  it("adds layout choices only to opted-in tables", () => {
    const content = [h(TableHeader, { key: "head" }, h(TableRow, null, h(TableHead, null, "Product"), h(TableHead, null, "Cost"))), h(TableBody, { key: "body" }, h(TableRow, null, h(TableCell, null, "Item"), h(TableCell, null, "10")))];
    const normal = renderToStaticMarkup(h(Table, { columnControls: true }, ...content));
    const inventory = renderToStaticMarkup(h(Table, { columnControls: true, layoutControls: true }, ...content));
    expect(normal).toContain("Columns");
    expect(inventory).toContain("View");
    expect(inventory).toContain('data-mobile-cards="true"');
    expect(normal).toContain('data-mobile-cards="true"');
  });
  it("keeps review/edit permissions and existing export payload intact", () => {
    const source = readFileSync("src/routes/inventory.tsx", "utf8");
    expect(source).toContain("showMoney && (costReviewCount > 0 || costReviewOnly)");
    expect(source).toContain("productsForExport(catalogProducts, scope, currentStore.id)");
    expect(source).toContain("exportProductsXlsx(products, stores, `products-${currentStore.code}-${scope}`, showMoney)");
    expect(source).toContain('stockFilter === "low" && !isLowStock');
    expect(source).toContain('stockFilter === "out" && branchStock !== 0');
    expect(source).toContain('disabled={!canPrice || branchPriceOnly}');
    for (const path of ["src/routes/all-shops.tsx", "src/routes/dashboard.tsx", "src/platforms/web/components/pos/TerminalWorkspaceHome.tsx"]) {
      expect(readFileSync(path, "utf8")).toContain("inventoryMetrics(");
    }
  });
});
