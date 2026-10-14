import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reports/items")({
  beforeLoad: () => {
    throw redirect({ to: "/reports/sales", search: { view: "items" }, replace: true });
  },
  head: () => ({
    meta: [
      { title: "Item Sales History — Retail" },
      {
        name: "description",
        content:
          "Line-by-line history of every item sold: date, time, cashier, price, cost price, margin and profit for any date range.",
      },
      { property: "og:title", content: "Item Sales History — Retail" },
      {
        property: "og:description",
        content: "Every sold line with cost price, margin and profit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
