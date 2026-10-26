import { usePos } from "@/lib/pos-store";
import { useSettingsCtx } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { useEffect, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  getPrinterPrefs,
  drawerPulseBytes,
  listPrinters,
  printBridge,
  rawPulse,
  setPrinterPrefs,
  type PrinterPrefs,
} from "@/lib/receipt-printer";
import { toast } from "sonner";
import { printTestReceipt } from "@/lib/pos-print";

/** Terminal-local receipt printer choice used for silent printing and the
 *  raw cash-drawer pulse. Only meaningful inside the Windows desktop shell. */
export function ReceiptPrinterSettings() {
  const { state } = usePos();
  const { updateSettings } = useSettingsCtx();
  return <PrinterControls shared={state.settings.integrations.receiptPrinter}
    onSave={(next) => updateSettings({ integrations: { ...state.settings.integrations, receiptPrinter: next } })}
    paper={state.settings.receipt.paper}
    onPaperChange={(paper) => updateSettings({ receipt: { ...state.settings.receipt, paper } })} />;
}

/** Recovery can repair/test device hardware before business settings are available. */
export function RecoveryPrinterSettings() {
  const [shared, setShared] = useState(getPrinterPrefs);
  return <PrinterControls shared={shared} onSave={(next) => {
    setPrinterPrefs(next);
    setShared(next);
  }} />;
}

type Paper = "30mm" | "58mm" | "80mm" | "a4" | "letter";
function PrinterControls({ shared, onSave, paper, onPaperChange }: {
  shared: PrinterPrefs | undefined;
  onSave: (prefs: PrinterPrefs) => void;
  paper?: Paper;
  onPaperChange?: (paper: Paper) => void;
}) {
  const [prefs, setPrefs] = useState<PrinterPrefs>({
    deviceName: "",
    share: "",
    drawerPin: 2,
    printMode: "dialog",
    encoding: "cp437",
    lineEnding: "lf",
    margins: { top: 4, right: 4, bottom: 4, left: 4 },
    printWidth: { "58mm": 48, "80mm": 72 },
    printOffset: 0,
  });
  const [printers, setPrinters] = useState<{ name: string; displayName: string }[]>([]);
  const [testing, setTesting] = useState(false);
  const desktop = typeof window !== "undefined" && !!printBridge();

  useEffect(() => {
    setPrefs(getPrinterPrefs(shared));
  }, [shared]);
  useEffect(() => {
    void listPrinters().then(setPrinters).catch(() => toast.error("Could not load printers. Refresh printers to retry."));
  }, []);

  const update = (next: PrinterPrefs) => {
    setPrefs(next);
    onSave(next);
  };

  const margins = prefs.margins ?? { top: 4, right: 4, bottom: 4, left: 4 };
  const setMargin = (side: keyof typeof margins, raw: string) => {
    const n = Number(raw);
    update({
      ...prefs,
      margins: { ...margins, [side]: Number.isFinite(n) ? Math.min(30, Math.max(0, n)) : 0 },
    });
  };

  const testDrawer = async () => {
    setTesting(true);
    try {
      const res = await rawPulse(drawerPulseBytes());
      if (!res.handled) {
        toast.info("Drawer kicks only work in the Windows desktop till");
      } else if (res.ok) {
        toast.success("Drawer pulse sent");
      } else {
        toast.error("Drawer did not open", { description: res.error });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Printer className="size-4 text-primary" /> Receipt printer
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {desktop
          ? "Receipts print straight to this printer with no Windows dialog, and the cash drawer opens through the same device."
          : "Printer selection applies to the Windows desktop till. In a browser the standard print dialog is always used."}
      </p>

      <div className="mt-4 space-y-1">
        <Label className="text-xs text-muted-foreground">Printer</Label>
        <ThemedSelect
          value={prefs.deviceName || "__default__"}
          onChange={(v: string) => update({ ...prefs, deviceName: v === "__default__" ? "" : v })}
          options={[
            { value: "__default__", label: "System default printer" },
            ...(prefs.deviceName && !printers.some((printer) => printer.name === prefs.deviceName)
              ? [{ value: prefs.deviceName, label: `${prefs.deviceName} (saved)` }]
              : []),
            ...printers.map((p) => ({ value: p.name, label: p.displayName || p.name })),
          ]}
        />
      </div>

      {onPaperChange && <div className="mt-4 space-y-1">
        <Label className="text-xs text-muted-foreground">Receipt paper width</Label>
        <ThemedSelect
          value={paper ?? "80mm"}
          ariaLabel="Receipt paper width"
          onChange={(value: string) => {
            if (!["30mm", "58mm", "80mm", "a4", "letter"].includes(value)) return;
            onPaperChange(value as Paper);
          }}
          options={[
            { value: "30mm", label: "30 mm roll" },
            { value: "58mm", label: "58 mm roll" },
            { value: "80mm", label: "80 mm roll" },
            { value: "a4", label: "A4 sheet" },
            { value: "letter", label: "Letter sheet" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Select the paper installed in the printer. This saved size controls receipt previews,
          Direct, Dialog and Thermal printing. For driver printing, select the same paper in Windows printer preferences.
        </p>
      </div>}

      <div className="mt-4 space-y-1">
        <Label className="text-xs text-muted-foreground">Receipt print mode</Label>
        <ThemedSelect
          value={prefs.printMode ?? "dialog"}
          onChange={(v: string) =>
            update({
              ...prefs,
              printMode: v === "thermal" ? "thermal" : v === "direct" ? "direct" : "dialog",
            })
          }
          options={[
            { value: "dialog", label: "Windows print dialog (normal)" },
            { value: "direct", label: "Direct to printer (no dialog)" },
            { value: "thermal", label: "Thermal text (ESC/POS)" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          The print dialog uses the normal Windows printing route — pick the printer and press
          Print, exactly like any other document. Choose “Direct to printer” once printing works to
          skip the dialog at the till. “Thermal text” sends raw ESC/POS commands instead, which only
          some printers accept.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Character encoding</Label>
          <ThemedSelect
            value={prefs.encoding ?? "cp437"}
            onChange={(v: string) =>
              update({ ...prefs, encoding: v as NonNullable<PrinterPrefs["encoding"]> })
            }
            options={[
              { value: "cp437", label: "CP437 (default thermal)" },
              { value: "cp850", label: "CP850 (Latin-1)" },
              { value: "cp858", label: "CP858 (Latin-1 + €)" },
              { value: "ascii", label: "Plain ASCII" },
              { value: "utf8", label: "UTF-8" },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Applies to thermal (ESC/POS) printing. If accents or currency symbols come out as
            garbled characters, try CP850, CP858 or UTF-8.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Line endings</Label>
          <ThemedSelect
            value={prefs.lineEnding ?? "lf"}
            onChange={(v: string) => update({ ...prefs, lineEnding: v === "crlf" ? "crlf" : "lf" })}
            options={[
              { value: "lf", label: "LF (standard)" },
              { value: "crlf", label: "CRLF (Windows-style)" },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Switch to CRLF if the slip prints as one long line or lines overlap.
          </p>
        </div>
      </div>

      <details className="mt-4 rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Paper margins</summary>
        <div className="mt-4 space-y-2">
          <Label className="text-xs text-muted-foreground">Print margins (mm)</Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <div key={side} className="space-y-1">
                <Label className="text-[11px] capitalize text-muted-foreground">{side}</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={margins[side]}
                  onChange={(e) => setMargin(side, e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Content uses the selected paper width minus these margins. Applies to receipts, reports and slips.
            Increase the right margin if words are cut off at the edge, then use “Test receipt” to
            check the alignment.
          </p>
        </div>

      </details>

      <div className="mt-4 space-y-1">
        <Label className="text-xs text-muted-foreground">Drawer connector pin</Label>
        <ThemedSelect
          value={String(prefs.drawerPin ?? 2)}
          onChange={(v: string) => update({ ...prefs, drawerPin: v === "5" ? 5 : 2 })}
          options={[
            { value: "2", label: "Pin 2 (standard)" },
            { value: "5", label: "Pin 5 (alternative wiring)" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Most RJ11 drawers answer on pin 2. Switch to pin 5 if the drawer stays shut.
        </p>
      </div>

      <div className="mt-4 space-y-1">
        <Label className="text-xs text-muted-foreground">Drawer share name (optional)</Label>
        <Input
          value={prefs.share}
          onChange={(e) => update({ ...prefs, share: e.target.value })}
          placeholder="e.g. ThermalPrinter or \\\\localhost\\ThermalPrinter"
          className="h-9 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Only needed as a backup route. The pulse is normally written straight to the printer above
          through the Windows raw spooler, so no share is required.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void listPrinters().then((list) => {
              setPrinters(list);
              toast.success(
                list.length ? `${list.length} printer(s) found` : "No printers reported",
              );
            }).catch(() => toast.error("Could not refresh printers. Check the printer connection and retry."))
          }
        >
          <RefreshCw className="size-3.5" /> Refresh printers
        </Button>
        <Button variant="outline" size="sm" disabled={testing} onClick={() => void testDrawer()}>
          <Printer className="size-3.5" /> {testing ? "Sending…" : "Test drawer kick"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => printTestReceipt()}>
          <Printer className="size-3.5" /> Test receipt
        </Button>
      </div>
    </section>
  );
}
