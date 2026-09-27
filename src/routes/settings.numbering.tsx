import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import { billPrefix, currentPlatform, terminalNumber } from "@/lib/bill-number";
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
  const tillError = cfg.terminalNo && !/^\d{1,2}$/.test(cfg.terminalNo) ? "One or two digits." : "";

  return (
    <SettingsFrame
      title="Bill numbering"
      description="Every receipt number is branch, till, day and a running number, so two registers can never mint the same bill — even offline."
      scopeSections={["numbering"]}
    >
      <SettingsTabs current="/settings/numbering" />

      <div className="space-y-5">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-xs text-muted-foreground">Next number on this till</p>
          <p className="font-mono text-lg font-semibold">{sample}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Platform code {currentPlatform()} · till {cfg.terminalNo || terminalNumber()} · date in{" "}
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
            <Label className="text-xs text-muted-foreground">Till number</Label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={cfg.terminalNo ?? ""}
              placeholder={terminalNumber()}
              onChange={(e) =>
                patch({ terminalNo: e.target.value.replace(/\D+/g, "").slice(0, 2) })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              {tillError || "Leave blank to take it from this device's activation."}
            </p>
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
