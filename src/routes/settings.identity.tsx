import { createFileRoute } from "@tanstack/react-router";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ImageUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { readBranding, useBranding, writeBranding } from "@/lib/branding";
import { prepareReceiptLogo } from "@/lib/receipt-logo";
import type { ReceiptOverride, ReceiptSettings } from "@/core/types/pos-types";

const IDENTITY_FIELDS: { key: keyof ReceiptOverride; label: string; placeholder: string }[] = [
  { key: "companyName", label: "Company name", placeholder: "RETAIL" },
  { key: "taxNumber", label: "Tax / VAT number", placeholder: "88-2201194" },
  { key: "regNumber", label: "Registration number", placeholder: "REG-000123" },
  { key: "phone", label: "Phone", placeholder: "555-0100" },
  { key: "website", label: "Website", placeholder: "www.example.com" },
];

export const Route = createFileRoute("/settings/identity")({
  head: () => ({
    meta: [
      { title: "Business Identity — Retail" },
      {
        name: "description",
        content:
          "Company name, tax and registration numbers, contact details, receipt header and thank-you footer, per branch or globally.",
      },
      { property: "og:title", content: "Business Identity — Retail" },
      { property: "og:description", content: "Company details printed on every receipt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Business identity"
      description="Company details printed at the top and bottom of every slip."
      showPreview
    >
      <IdentityForm />
    </SettingsFrame>
  ),
});

function IdentityForm() {
  const { effective, setField } = useSettingsCtx();
  const brand = useBranding();
  const [terminal, setTerminal] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => setTerminal(brand.terminal), [brand.terminal]);

  // Keep the locally stored install name aligned with the receipt company name.
  useEffect(() => {
    const name = (effective.companyName ?? "").trim();
    if (name && name !== readBranding().company) writeBranding({ company: name });
  }, [effective.companyName]);

  const pickLogo = async (file: File | null) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      setField("logo", await prepareReceiptLogo(file));
      toast.success("Business logo ready — save settings to publish it");
    } catch (error) {
      toast.error("Could not use that logo", { description: (error as Error).message });
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Terminal name (this machine only)</Label>
        <Input
          value={terminal}
          onChange={(e) => setTerminal(e.target.value)}
          onBlur={() => writeBranding({ terminal: terminal.trim() || "POS Terminal 01" })}
          placeholder="POS Terminal 01"
        />
      </div>
      <section className="space-y-3 rounded-md border border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">Business logo</h2>
          <p className="text-xs text-muted-foreground">
            Upload the logo here once. Receipt designer controls its position and size; Receipt
            elements controls whether it prints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-36 place-items-center rounded-md border border-dashed border-border bg-muted/40 p-2">
            {effective.logo ? (
              <img
                src={effective.logo}
                alt="Current business logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-muted-foreground">No logo uploaded</span>
            )}
          </div>
          <input
            ref={logoInput}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(event) => void pickLogo(event.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={logoBusy}
            onClick={() => logoInput.current?.click()}
          >
            <ImageUp className="size-4" />
            {logoBusy ? "Preparing…" : effective.logo ? "Replace PNG" : "Upload PNG"}
          </Button>
          {effective.logo ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setField("logo", "")}>
              <Trash2 className="size-4" /> Remove
            </Button>
          ) : null}
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        {IDENTITY_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <Input
              placeholder={f.placeholder}
              value={(effective[f.key as keyof ReceiptSettings] as string) ?? ""}
              onChange={(e) => setField(f.key, e.target.value as never)}
            />
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Header text (address / extra info)</Label>
        <Textarea
          rows={2}
          value={effective.headerText}
          onChange={(e) => setField("headerText", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Footer / thank-you note</Label>
        <Textarea
          rows={2}
          value={effective.footerText}
          onChange={(e) => setField("footerText", e.target.value)}
        />
      </div>
    </div>
  );
}
