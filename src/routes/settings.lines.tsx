import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { Plus, Trash2 } from "lucide-react";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReceiptCustomLine } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/lines")({
  head: () => ({
    meta: [
      { title: "Receipt Extra Lines — Retail" },
      {
        name: "description",
        content:
          "Add policy notes, promotions or opening hours above the footer or below the header of every printed receipt.",
      },
      { property: "og:title", content: "Receipt Extra Lines — Retail" },
      { property: "og:description", content: "Custom note lines printed on receipts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt extra lines"
      description="Policy notes, promotions or opening hours printed with each slip."
      showPreview
    >
      <SettingsTabs current="/settings/lines" />

      <LinesForm />
    </SettingsFrame>
  ),
});

function LinesForm() {
  const { effective, setField } = useSettingsCtx();
  const lines = effective.customLines ?? [];
  return (
    <div className="space-y-3">
      {lines.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No custom lines yet — add policy notes, promotions or opening hours.
        </p>
      )}
      {lines.map((line, i) => (
        <div key={line.id} className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[180px] flex-1"
            value={line.text}
            placeholder="Return policy: 7 days with receipt"
            onChange={(e) =>
              setField(
                "customLines",
                lines.map((l) => (l.id === line.id ? { ...l, text: e.target.value } : l)),
              )
            }
          />
          <ThemedSelect
            ariaLabel="Line placement"
            className="w-40 shrink-0"
            value={line.placement}
            onChange={(v) =>
              setField(
                "customLines",
                lines.map((l) =>
                  l.id === line.id ? { ...l, placement: v as ReceiptCustomLine["placement"] } : l,
                ),
              )
            }
            options={[
              { value: "header", label: "Below header" },
              { value: "footer", label: "Above footer" },
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move up"
            disabled={i === 0}
            onClick={() => {
              const next = [...lines];
              [next[i - 1], next[i]] = [next[i], next[i - 1]];
              setField("customLines", next);
            }}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove line"
            onClick={() =>
              setField(
                "customLines",
                lines.filter((l) => l.id !== line.id),
              )
            }
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setField("customLines", [
            ...lines,
            { id: `line-${Date.now()}`, text: "", placement: "footer" as const },
          ])
        }
      >
        <Plus className="mr-1 size-4" /> Add line
      </Button>
    </div>
  );
}
