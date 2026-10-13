import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/platforms/web/components/pos/SectionHub";

export const Route = createFileRoute("/marketing")({
  head: () => ({ meta: [{ title: "Marketing — Retail" }] }),
  component: () => <SectionHub groupId="marketing" />,
});
