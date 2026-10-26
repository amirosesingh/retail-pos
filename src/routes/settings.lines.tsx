import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { Plus, Trash2 } from "lucide-react";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RECEIPT_LINE_SECTIONS } from "@/lib/receipt-line-sections";
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
      <p className="text-xs text-muted-foreground">Add a text block and choose where it prints. Header and Footer apply to all slips; Sales body sections apply to sale receipts. Each new line prints separately.</p>
      {lines.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No custom lines yet — add policy notes, promotions or opening hours.
        </p>
      )}
      {lines.map((line, i) => (
        <section key={line.id} className="space-y-3 rounded-xl border bg-card p-4">
          <Label>Text block {i + 1}</Label>
          <Textarea
            aria-label={`Receipt text block ${i + 1}`}
            rows={3}
            value={line.text}
            placeholder="Return policy: 7 days with receipt"
            onChange={(e) =>
              setField(
                "customLines",
                lines.map((l) => (l.id === line.id ? { ...l, text: e.target.value } : l)),
              )
            }
          />
          <div className="flex flex-wrap items-center gap-2">
          <ThemedSelect
            ariaLabel={`Text block ${i + 1} section`}
            className="min-w-0 flex-1"
            value={line.placement}
            onChange={(v) =>
              setField(
                "customLines",
                lines.map((l) =>
                  l.id === line.id ? { ...l, placement: v as ReceiptCustomLine["placement"] } : l,
                ),
              )
            }
            options={[...RECEIPT_LINE_SECTIONS]}
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
        </section>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setField("customLines", [
            ...lines,
            { id: crypto.randomUUID(), text: "", placement: "footer" as const },
          ])
        }
      >
        <Plus className="mr-1 size-4" /> Add line
      </Button>
    </div>
  );
}
