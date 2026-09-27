import { createFileRoute } from "@tanstack/react-router";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { readBranding, useBranding, writeBranding } from "@/lib/branding";
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
      scopeSections={["receiptIdentity"]}
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

  useEffect(() => setTerminal(brand.terminal), [brand.terminal]);

  // Keep the locally stored install name aligned with the receipt company name.
  useEffect(() => {
    const name = (effective.companyName ?? "").trim();
    if (name && name !== readBranding().company) writeBranding({ company: name });
  }, [effective.companyName]);

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
