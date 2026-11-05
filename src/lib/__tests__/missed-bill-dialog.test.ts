import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ isAdmin: true, staff: [{ staffId: "C1", name: "Cashier", storeId: "branch-a" }] }));
vi.mock("../pos-auth", () => ({ useAuth: () => auth }));
vi.mock("../pos-store", () => ({ money: (amount: number) => amount.toFixed(2), usePos: () => ({
  currentStore: { id: "branch-a", name: "Branch A" }, state: { products: [], stores: [{ id: "branch-a", groupId: "sports" }], transfers: [], shifts: [], settings: { integrations: {} } },
}) }));
vi.mock("../missed-bill-client", () => ({ addMissedBill: vi.fn(), listMissedBillCashiers: vi.fn() }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: vi.fn() }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => h("div", null, children),
  DialogContent: ({ children }: { children: ReactNode }) => h("section", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => h("header", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => h("h2", null, children),
}));
vi.mock("@/platforms/web/components/pos/ThemedSelect", () => ({ ThemedSelect: ({ ariaLabel, options }: { ariaLabel: string; options: { value: string; label: string }[] }) => h("select", { "aria-label": ariaLabel }, options.map(option => h("option", { key: option.value, value: option.value }, option.label))) }));
import { AddMissedBillDialog } from "@/platforms/web/components/pos/AddMissedBillDialog";
import { pageDataScope } from "../page-data-cache";
const renderDialog = (cashiers?: { userId: string; name: string }[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (cashiers) client.setQueryData(["missed-bill-cashiers", ...pageDataScope(undefined), "branch-a"], cashiers);
  try { return renderToStaticMarkup(h(QueryClientProvider, { client, children: h(AddMissedBillDialog, { onSaved: vi.fn() }) })); }
  finally { client.clear(); }
};
describe("Add missed bill dialog", () => {
  it("shows historical attribution, required stock choice and original payment controls", () => {
    auth.isAdmin = true;
    const html = renderDialog();
    for (const label of ["Add missed bill", "Original cashier", "Original shift reference", "Stock handling", "Line discount", "Line tax", "already received", "Reason for late entry", "online", "Unit cost"])
      expect(html.toLowerCase()).toContain(label.toLowerCase());
    expect(html).toContain("Deduct stock once");
    expect(html).toContain("Stock already corrected");
    expect(html).toContain("Original date/time");
    expect(html).toContain("does not charge the customer");
  });
  it("does not expose historical correction creation to a cashier", () => {
    auth.isAdmin = false;
    try { expect(renderDialog()).toBe(""); }
    finally { auth.isAdmin = true; }
  });
  it("uses authoritative cached cashier options even with no legacy local staff records", () => {
    const original = auth.staff;
    auth.staff = [];
    try {
      const html = renderDialog([{ userId: "real-cashier", name: "Actual cashier" }]);
      expect(html).toContain("Actual cashier");
      expect(html).toContain("real-cashier");
    } finally { auth.staff = original; }
  });
});
