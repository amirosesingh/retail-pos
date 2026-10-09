import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import { billPrefix, currentPlatform, terminalNumber, configuredTillNumber, saveTillNumber } from "@/lib/bill-number";
import { activeBranchId } from "@/lib/active-branch";

export const Route = createFileRoute("/settings/numbering")({
  head: () => ({
    meta: [
      { title: "Bill Numbering — Retail" },
      {
        name: "description",
        content:
          "Choose how receipt numbers are built: branch code, till number, running length and daily reset.",
      },
      { property: "og:title", content: "Bill Numbering — Retail" },
      {
        property: "og:description",
        content: "Branch, till, date and sequence rules for every receipt number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NumberingPage,
});

function NumberingPage() {
  const { state, updateSettings } = usePos();
  const it = state.settings.integrations;
  const cfg = it.billNumbering ?? {};
  const [till, setTill] = useState(() => configuredTillNumber() || cfg.terminalNo || terminalNumber());
  const [savingTill, setSavingTill] = useState(false);
  const branchId = activeBranchId();
  const store = state.stores.find((s) => s.id === branchId) ?? state.stores[0];
  const branchCode = store?.receiptPrefix?.trim() || store?.code || "R";

  const patch = (next: Partial<typeof cfg>) =>
    updateSettings({ integrations: { ...it, billNumbering: { ...cfg, ...next } } });

  const pad = Math.min(6, Math.max(3, Math.round(cfg.padding ?? 4)));
  const sample = `${billPrefix(branchCode, new Date(), { ...cfg, timeZone: it.timeZone || undefined })}-${"1".padStart(pad, "0")}`;
  const codeError =
    cfg.branchCode && !/^[A-Za-z0-9]{1,8}$/.test(cfg.branchCode)
      ? "Letters and numbers only, up to 8 characters."
      : "";
  const tillError = !/^\d{1,2}$/.test(till) || Number(till) < 1 ? "Enter 01 to 99." : "";

  return (
    <SettingsFrame
      title="Bill numbering"
      description="Receipt numbers contain branch, platform, till, date and sequence. Assign each device a different till number within its branch and platform."
    >
      <SettingsTabs current="/settings/numbering" />

      <div className="space-y-5">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-xs text-muted-foreground">Next number on this till</p>
          <p className="font-mono text-lg font-semibold">{sample}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Platform code {currentPlatform()} · till {configuredTillNumber() || cfg.terminalNo || terminalNumber()} · date in{" "}
            {it.timeZone || "this device's time zone"}.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Branch code</Label>
            <Input
              value={cfg.branchCode ?? ""}
              placeholder={branchCode}
              onChange={(e) => patch({ branchCode: e.target.value.toUpperCase() })}
            />
            <p className="text-[11px] text-muted-foreground">
              {codeError || "Leave blank to use the branch's own code."}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Till number on this device</Label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={till}
              placeholder={terminalNumber()}
              onChange={(e) =>
                setTill(e.target.value.replace(/\D+/g, "").slice(0, 2))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              {tillError || "Use a different number on each till, for example 01 and 02. Applies to new bills; existing receipts keep their numbers."}
            </p>
            <Button disabled={savingTill || !!tillError} onClick={async () => {
              setSavingTill(true);
              try { await saveTillNumber(till); setTill(till.padStart(2, "0")); toast.success("Till number saved on this device"); }
              catch (error) { toast.error(error instanceof Error ? error.message : "Could not save till number"); }
              finally { setSavingTill(false); }
            }}>{savingTill ? "Saving…" : "Save till number"}</Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Running number length</Label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={String(pad)}
              onChange={(e) => patch({ padding: Number(e.target.value.replace(/\D+/g, "")) || 4 })}
            />
            <p className="text-[11px] text-muted-foreground">Between 3 and 6 digits.</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Start again each day</p>
              <p className="text-[11px] text-muted-foreground">
                Off keeps one continuous run for this till.
              </p>
            </div>
            <Switch
              checked={cfg.resetDaily !== false}
              onCheckedChange={(on) => patch({ resetDaily: on })}
            />
          </div>
        </div>
      </div>
    </SettingsFrame>
  );
}
