import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/platforms/web/components/pos/SectionHub";

export const Route = createFileRoute("/sales")({
  head: () => ({
    meta: [
      { title: "Sales — Retail" },
      {
        name: "description",
        content:
          "Register, live dashboard, shift management, bookings, customer display and bill history in one place.",
      },
      { property: "og:title", content: "Sales — Retail" },
      {
        property: "og:description",
        content: "Everything the counter needs during a trading day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <SectionHub groupId="register" />,
});