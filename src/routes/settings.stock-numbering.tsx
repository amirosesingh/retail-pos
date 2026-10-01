/**
 * Document numbering for inventory records. Supplier invoice numbers are not generated here —
 * those are typed in from the supplier's paperwork.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronRight } from "lucide-react";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { usePos } from "@/lib/pos-store";
import {
  previewStockRef,
  type RefSeries,
  type StockNumberReset,
  type StockNumberingSettings,
} from "@/lib/stock-ref";
import { activeBranchId } from "@/lib/active-branch";

export const Route = createFileRoute("/settings/stock-numbering")({
  head: () => ({
    meta: [
      { title: "Document Numbering — Retail" },
      {
        name: "description",
        content:
          "Choose the prefix, starting number, padding and reset rule for stock counts, receiving, requests and transfers.",
      },
      { property: "og:title", content: "Document Numbering — Retail" },
      {
        property: "og:description",
        content: "Prefix, branch, period and running number rules for every inventory document.",
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
  const branchId = activeBranchId();
  const store = state.stores.find((s) => s.id === branchId) ?? state.stores[0];
  const branchCode = store?.code || "BR";

  return (
    <SettingsFrame
      title="Document numbering"
      description="Every stock count, receiving entry, stock request and transfer gets a separate reference series when it is created."
    >
      <SettingsTabs current="/settings/stock-numbering" />

      <div className="space-y-6">
        <SeriesCard
          title="Stock count references"
          hint="Used by every physical count in Stock Operations."
          series="stock"
          defaultPrefix="SC"
          cfg={it.stockNumbering ?? {}}
          branchCode={branchCode}
          onPatch={(next) =>
            updateSettings({
              integrations: { ...it, stockNumbering: { ...(it.stockNumbering ?? {}), ...next } },
            })
          }
        />

        <SeriesCard
          title="Stock request references"
          hint="Used when one branch asks another branch to supply stock."
          series="request"
          defaultPrefix="SR"
          cfg={it.requestNumbering ?? {}}
          branchCode={branchCode}
          onPatch={(next) =>
            updateSettings({
              integrations: {
                ...it,
                requestNumbering: { ...(it.requestNumbering ?? {}), ...next },
              },
            })
          }
        />

        <SeriesCard
          title="Stock transfer references"
          hint="Used by stock sent from one branch to another, including fulfilment of a request."
          series="transfer"
          defaultPrefix="ST"
          cfg={it.transferNumbering ?? {}}
          branchCode={branchCode}
          onPatch={(next) =>
            updateSettings({
              integrations: {
                ...it,
                transferNumbering: { ...(it.transferNumbering ?? {}), ...next },
              },
            })
          }
        />

        <SeriesCard
          title="Goods received references"
          hint="Our own number for each receiving entry — separate from the supplier's invoice number."
          series="receiving"
          defaultPrefix="GRN"
          cfg={it.receivingNumbering ?? {}}
          branchCode={branchCode}
          onPatch={(next) =>
            updateSettings({
              integrations: {
                ...it,
                receivingNumbering: { ...(it.receivingNumbering ?? {}), ...next },
              },
            })
          }
        />
      </div>
    </SettingsFrame>
  );
}

function SeriesCard({
  title,
  hint,
  series,
  defaultPrefix,
  cfg,
  branchCode,
  onPatch,
}: {
  title: string;
  hint: string;
  series: RefSeries;
  defaultPrefix: string;
  cfg: StockNumberingSettings;
  branchCode: string;
  onPatch: (next: Partial<StockNumberingSettings>) => void;
}) {
  const pad = Math.min(6, Math.max(3, Math.round(cfg.padding ?? 4)));
  const sample = previewStockRef({ ...cfg, padding: pad }, branchCode, series);
  const prefixError =
    cfg.prefix && !/^[A-Za-z0-9]{1,6}$/.test(cfg.prefix)
      ? "Letters and numbers only, up to 6 characters."
      : "";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <span className="hidden font-mono text-xs text-muted-foreground sm:block">{sample}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-xs text-muted-foreground">Next reference on this branch</p>
          <p className="font-mono text-lg font-semibold">{sample}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Branch {branchCode} · running number restarts {cfg.reset ?? "monthly"}.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prefix</Label>
            <Input
              value={cfg.prefix ?? ""}
              placeholder={defaultPrefix}
              onChange={(e) => onPatch({ prefix: e.target.value.toUpperCase() })}
            />
            <p className="text-[11px] text-muted-foreground">
              {prefixError || `Leave blank to use ${defaultPrefix}.`}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Starting number</Label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={String(cfg.startNumber ?? 1)}
              onChange={(e) =>
                onPatch({ startNumber: Number(e.target.value.replace(/\D+/g, "")) || 1 })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Used the first time a period starts — existing runs keep counting.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Running number length</Label>
            <ThemedSelect
              ariaLabel="Running number length"
              value={String(pad)}
              onChange={(value) => onPatch({ padding: Number(value) })}
              options={[3, 4, 5, 6].map((value) => ({
                value: String(value),
                label: `${value} digits`,
              }))}
            />
            <p className="text-[11px] text-muted-foreground">Between 3 and 6 digits.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Start again</Label>
            <ThemedSelect
              value={cfg.reset ?? "monthly"}
              onChange={(v) => onPatch({ reset: v as StockNumberReset })}
              options={[
                { value: "never", label: "Never — one continuous run" },
                { value: "yearly", label: "Every year" },
                { value: "monthly", label: "Every month" },
              ]}
              ariaLabel="Reset rule"
            />
            <p className="text-[11px] text-muted-foreground">
              The period appears in the reference so numbers stay unique.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium">Include the branch code</p>
              <p className="text-[11px] text-muted-foreground">
                Keeps two branches from minting the same reference.
              </p>
            </div>
            <Switch
              checked={cfg.includeBranch !== false}
              onCheckedChange={(on) => onPatch({ includeBranch: on })}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
