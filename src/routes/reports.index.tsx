import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/platforms/web/components/pos/SectionHub";

export const Route = createFileRoute("/reports/")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics Centre — Retail" },
      {
        name: "description",
        content:
          "Sales summaries, coupon usage, register activity and catalog change history for every terminal and branch.",
      },
      { property: "og:title", content: "Reports & Analytics Centre — Retail" },
      {
        property: "og:description",
        content: "Every till event, coupon and catalog edit with full timestamps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <SectionHub groupId="reports" />,
});
