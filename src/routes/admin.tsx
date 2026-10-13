import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/platforms/web/components/pos/SectionHub";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Business Overview — Retail" },
      {
        name: "description",
        content:
          "Staff accounts, PINs, roles and the permission matrix, plus the full audit trail of register activity.",
      },
      { property: "og:title", content: "Business Overview — Retail" },
      {
        property: "og:description",
        content: "People, permissions and compliance logs for the till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <SectionHub groupId="company" />,
});