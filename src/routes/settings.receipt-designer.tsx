import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ImageUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/pos-auth";
import { RECEIPT_FIELDS, fieldTag, type ReceiptFieldToken } from "@/lib/receipt-template";
import { receiptCssWarnings } from "@/lib/receipt-css";
import type { ReceiptCustomLine } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/receipt-designer")({
  head: () => ({
    meta: [
      { title: "Receipt Designer — Retail" },
      {
        name: "description",
        content:
          "Insert dynamic receipt fields, upload a branch logo and style the printed slip with scoped CSS, with a live sample preview.",
      },
      { property: "og:title", content: "Receipt Designer — Retail" },
      {
        property: "og:description",
        content: "Dynamic fields, logo upload and scoped CSS for printed receipts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt designer"
      description="Content, dynamic fields, logo and styling for every printed slip. The preview uses sample transaction data."
      scopeSections={["receiptIdentity", "receiptLayout"]}
      showPreview
    >
      <SettingsTabs current="/settings/receipt-designer" />
      <Designer />
    </SettingsFrame>
  ),
});

type Target = { kind: "header" } | { kind: "footer" } | { kind: "line"; id: string };

function Designer() {
  const { effective, setField, setGlobal, receipt } = useSettingsCtx();
  const { isAdmin, can } = useAuth();
  const mayEdit = isAdmin || can("can_access_pos_settings");
  const [target, setTarget] = useState<Target>({ kind: "footer" });
  const fileRef = useRef<HTMLInputElement>(null);

  const lines = effective.customLines ?? [];
  const warnings = receiptCssWarnings(effective.css);

  if (!mayEdit) {
    return (
      <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Editing the receipt template, logo and stylesheet needs the settings permission.
      </p>
    );
  }

  const setLines = (next: ReceiptCustomLine[]) => setField("customLines", next);

  /** Append the chosen field's tag to whichever block is selected. */
  const insert = (token: ReceiptFieldToken) => {
    const tag = fieldTag(token);
    if (target.kind === "header")
      return setField("headerText", `${effective.headerText ?? ""}${tag}`);
    if (target.kind === "footer")
      return setField("footerText", `${effective.footerText ?? ""}${tag}`);
    setLines(lines.map((l) => (l.id === target.id ? { ...l, text: `${l.text}${tag}` } : l)));
  };

  const readLogo = (file: File) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type))
      return toast.error("Use a PNG, JPEG, WebP or SVG image");
    if (file.size > 400_000) return toast.error("Logo must be under 400 KB so it prints quickly");
    const reader = new FileReader();
    reader.onload = () => {
      setGlobal({ logo: String(reader.result), showLogo: true });
      toast.success("Logo updated — save settings to keep it");
    };
    reader.onerror = () => toast.error("Could not read that image");
    reader.readAsDataURL(file);
  };

  const targetLabel =
    target.kind === "header"
      ? "Header text"
      : target.kind === "footer"
        ? "Footer text"
        : lines.find((l) => l.id === target.id)?.text || "Custom line";

  return (
    <div className="space-y-6">
      {/* ---------------- logo ---------------- */}
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Logo</h3>
        <p className="text-xs text-muted-foreground">
          Stored on the receipt profile, not on individual sales. Branch overrides keep their own
          header text; the logo is shared across the company profile.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-16 w-32 place-items-center rounded-md border border-dashed border-border bg-muted/40 p-1">
            {receipt.logo ? (
              <img
                src={receipt.logo}
                alt="Current receipt logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-muted-foreground">No logo</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readLogo(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageUp className="mr-2 size-4" /> {receipt.logo ? "Replace logo" : "Upload logo"}
          </Button>
          {receipt.logo && (
            <Button variant="ghost" size="sm" onClick={() => setGlobal({ logo: "" })}>
              Remove
            </Button>
          )}
        </div>
      </section>

      {/* ---------------- content + fields ---------------- */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Content</h3>
        <p className="text-xs text-muted-foreground">
          Pick a block, then click a field to insert it. Fields resolve from the real transaction
          when the slip prints — the preview shows sample values.
        </p>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Header text</Label>
          <Textarea
            rows={2}
            value={effective.headerText ?? ""}
            onFocus={() => setTarget({ kind: "header" })}
            onChange={(e) => setField("headerText", e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Footer text</Label>
          <Textarea
            rows={2}
            value={effective.footerText ?? ""}
            onFocus={() => setTarget({ kind: "footer" })}
            onChange={(e) => setField("footerText", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Extra lines</Label>
          {lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <Input
                value={line.text}
                placeholder="Served by {{cashier}} on {{terminal_name}}"
                onFocus={() => setTarget({ kind: "line", id: line.id })}
                onChange={(e) =>
                  setLines(
                    lines.map((l) => (l.id === line.id ? { ...l, text: e.target.value } : l)),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove line"
                onClick={() => setLines(lines.filter((l) => l.id !== line.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines([
                ...lines,
                { id: `line-${Date.now()}`, text: "", placement: "footer" as const },
              ])
            }
          >
            <Plus className="mr-1 size-4" /> Add line
          </Button>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-medium">
            Available fields — inserting into: <span className="text-primary">{targetLabel}</span>
          </p>
          {["Slip", "People & place", "Money", "Booking"].map((group) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="flex flex-wrap gap-1">
                {RECEIPT_FIELDS.filter((f) => f.group === group).map((f) => (
                  <button
                    key={f.token}
                    type="button"
                    onClick={() => insert(f.token)}
                    className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] hover:bg-muted"
                    title={fieldTag(f.token)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- styling ---------------- */}
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Styling (CSS)</h3>
        <p className="text-xs text-muted-foreground">
          Applies to the printed receipt only. Rules are re-scoped to the slip, so nothing here can
          change the rest of the POS, load remote files or alter the paper width.
        </p>
        <Textarea
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={".b { text-decoration: underline; }\n.muted { font-style: italic; }"}
          value={effective.css ?? ""}
          onChange={(e) => setField("css", e.target.value)}
        />
        {warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-600">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
