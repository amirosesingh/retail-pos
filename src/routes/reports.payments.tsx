import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reports/payments")({
  beforeLoad: () => {
    throw redirect({ to: "/reports/sales", search: { view: "payments" }, replace: true });
  },
  head: () => ({
    meta: [
      { title: "Cashier Payments Report — Retail" },
      {
        name: "description",
        content:
          "Every payment transaction taken by each cashier with the full tender breakdown: cash, card machine, wallet, transfer and points.",
      },
      { property: "og:title", content: "Cashier Payments Report — Retail" },
      {
        property: "og:description",
        content: "Payments per cashier with tender and card-machine breakdown.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
