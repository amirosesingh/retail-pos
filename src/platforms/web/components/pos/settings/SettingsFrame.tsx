/**
 * Shared shell for every settings page.
 *
 * Each area (display, tax, receipt typography, …) is now its own route, so a
 * page opens as a real window instead of an accordion panel that scrolls the
 * rest of the menu past the user. This frame owns the state all of those pages
 * share: save state, confirmed scope loading and live preview. Scope ownership
 * is managed only from Settings inheritance.
 */
import { Link } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, Eye, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { SaveIndicator } from "@/platforms/web/components/pos/settings/SaveIndicator";
import { useEmbeddedSettings } from "@/platforms/web/components/pos/settings/embed";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { defaultPaymentDetails, defaultWhatsApp } from "@/lib/pos-seed";
import {
  PAPER_LABELS,
  paperCss,
  saleReceiptPreview,
  setPreviewReceiptCfg,
  setPrintSettings,
} from "@/lib/pos-print";
import { defaultPaymentQr } from "@/core/types/pos-types";
import type {
  FontStyleSettings,
  ReceiptOverride,
  ReceiptSettings,
  Sale,
} from "@/core/types/pos-types";
import { computeTax } from "@/core/pricing/tax";

type Ctx = {
  effective: ReceiptSettings;
  receipt: ReceiptSettings;
  tax: ReturnType<typeof usePos>["state"]["settings"]["tax"];
  payment: NonNullable<ReturnType<typeof usePos>["state"]["settings"]["payment"]>;
  whatsapp: NonNullable<ReturnType<typeof usePos>["state"]["settings"]["whatsapp"]>;
  updateSettings: ReturnType<typeof usePos>["updateSettings"];
  setField: <K extends keyof ReceiptOverride>(key: K, value: ReceiptOverride[K]) => void;
  setGlobal: (patch: Partial<ReceiptSettings>) => void;
  setFont: (scope: keyof ReceiptSettings["fonts"], patch: Partial<FontStyleSettings>) => void;
  setWhatsApp: (
    patch: Partial<NonNullable<ReturnType<typeof usePos>["state"]["settings"]["whatsapp"]>>,
  ) => void;
  setPaymentQr: (patch: Partial<typeof defaultPaymentQr>) => void;
  paymentQr: typeof defaultPaymentQr;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function useSettingsCtx(): Ctx {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettingsCtx must be used inside <SettingsFrame>");
  return ctx;
}

type Props = {
  title: string;
  description: string;
  children: ReactNode;
  showPreview?: boolean;
  /** Diagnostics pages need the whole window: tables and graphs, no reading column. */
  wide?: boolean;
  /** Device registration may also be managed by supervisors. */
  terminalManagement?: boolean;
  /** Hide the shared save bar on read-only pages and pages with their own save action. */
  showSaveBar?: boolean;
};

export function SettingsFrame({
  title,
  description,
  children,
  showPreview = false,
  wide = false,
  terminalManagement = false,
  showSaveBar = true,
}: Props) {
  const {
    state,
    currentStore,
    updateSettings,
    saveConfiguredSettings,
    settingsScope,
    scopeIds,
    settingsScopeLoading,
  } = usePos();
  const { isAdmin, isSupervisor, can } = useAuth();
  const canSettings =
    isAdmin || can("can_access_pos_settings") || (terminalManagement && isSupervisor);
  // Rendered inside the settings workspace sheet: no app shell, no back link.
  const embedded = useEmbeddedSettings();

  /* ---- Save / discard -------------------------------------------------- */
  // Edits apply live so the preview stays honest, but nothing is considered
  // stored until "Save settings" confirms the database write. The snapshot is
  // what "Discard changes" puts back.
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(state.settings));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const dirty = JSON.stringify(state.settings) !== snapshot;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Changing branch/terminal or enabling an override replaces the effective
  // settings record. That is a new editing baseline, not an unsaved user edit.
  const scopeSignature = JSON.stringify({
    scopeIds,
    locks: settingsScope.locks,
    owners: Object.fromEntries(
      Object.entries(settingsScope.overrides).map(([tier, sections]) => [
        tier,
        Object.keys(sections).sort(),
      ]),
    ),
  });
  const previousScopeSignature = useRef(scopeSignature);
  useEffect(() => {
    if (previousScopeSignature.current === scopeSignature) return;
    previousScopeSignature.current = scopeSignature;
    setSnapshot(JSON.stringify(state.settings));
    setSaveError("");
  }, [scopeSignature, state.settings]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await saveConfiguredSettings();
      setSnapshot(JSON.stringify(state.settings));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      toast.success("Settings saved");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not reach the database";
      setSaveError(message);
      toast.error("Could not save settings", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    updateSettings(JSON.parse(snapshot));
    setSaveError("");
    toast.info("Changes discarded");
  };

  const { tax, receipt } = state.settings;
  const payment = state.settings.payment ?? defaultPaymentDetails;
  const whatsapp = state.settings.whatsapp ?? defaultWhatsApp;
  const paymentQr = payment.paymentQr ?? defaultPaymentQr;

  // `state.settings` has already been resolved by the central scope engine.
  // Receipt pages must not layer a second, branch-only override system on top.
  const effective = receipt;

  const setField = <K extends keyof ReceiptOverride>(key: K, value: ReceiptOverride[K]) => {
    updateSettings({ receipt: { ...receipt, [key]: value } as ReceiptSettings });
  };

  const setGlobal = (patch: Partial<ReceiptSettings>) =>
    updateSettings({ receipt: { ...receipt, ...patch } });

  const setFont = (scope: keyof ReceiptSettings["fonts"], patch: Partial<FontStyleSettings>) =>
    setGlobal({ fonts: { ...receipt.fonts, [scope]: { ...receipt.fonts[scope], ...patch } } });

  const setWhatsApp = (patch: Partial<typeof whatsapp>) =>
    updateSettings({ whatsapp: { ...whatsapp, ...patch } });

  const setPaymentQr = (patch: Partial<typeof paymentQr>) =>
    updateSettings({ payment: { ...payment, paymentQr: { ...paymentQr, ...patch } } });

  const sample: Sale = useMemo(() => {
    const lines = [
      {
        productId: "x1",
        name: "Espresso Beans 250g",
        price: 12.5,
        qty: 2,
        taxRate: 0.05,
        discount: 0,
      },
      {
        productId: "x2",
        name: "Butter Croissant",
        price: 3.75,
        qty: 1,
        taxRate: 0.05,
        discount: 0,
      },
    ];
    const subtotal = 28.75;
    const { tax: taxAmount, total } = computeTax(subtotal, tax);
    return {
      id: "preview",
      receiptNo: `${currentStore.code}-000001`,
      storeId: currentStore.id,
      shiftId: "preview",
      lines,
      subtotal,
      discount: 0,
      tax: taxAmount,
      total,
      paid: total,
      change: 0,
      method: "cash",
      memberId: "m1",
      pointsEarned: Math.round(total),
      cashier: "Preview",
      createdAt: new Date().toISOString(),
    };
  }, [tax, currentStore]);

  const previewHtml = useMemo(() => {
    setPreviewReceiptCfg(effective, tax);
    const html = saleReceiptPreview(
      sample,
      {
        id: "m1",
        code: "MB-1001",
        name: "Amara Okafor",
        phone: "555-0142",
        email: "amara@example.com",
        tier: "Gold",
        points: 1840,
        totalSpend: 1840.5,
        joinedAt: "2024-03-11",
      },
      "sale",
    );
    setPrintSettings(receipt, tax);
    return html;
  }, [effective, receipt, tax, sample]);

  if (!canSettings) {
    const denied = (
      <div className={embedded ? "" : "p-6"}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This configuration is managed by an administrator.
        </p>
      </div>
    );
    if (embedded) return denied;
    return <SettingsShell>{denied}</SettingsShell>;
  }

  const geometry = paperCss(effective.paper);

  const ctx: Ctx = {
    effective,
    receipt,
    tax,
    payment,
    whatsapp,
    updateSettings,
    setField,
    setGlobal,
    setFont,
    setWhatsApp,
    setPaymentQr,
    paymentQr,
  };

  const body = (
    <SettingsCtx.Provider value={ctx}>
      <div
        className={
          embedded
            ? "w-full max-w-full space-y-4"
            : `mx-auto w-full space-y-5 p-6 ${wide ? "max-w-full" : "max-w-4xl"}`
        }
      >
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          {embedded ? (
            <div />
          ) : (
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          )}
          {showPreview && (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="shrink-0">
                  <Eye className="size-4" /> Preview receipt
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-[520px]">
                <SheetHeader>
                  <SheetTitle>Live receipt preview · {PAPER_LABELS[effective.paper]}</SheetTitle>
                </SheetHeader>
                <div className="overflow-auto px-4 pb-6">
                  <div
                    className="mx-auto overflow-hidden rounded-md bg-white p-2"
                    style={{ maxWidth: geometry.width }}
                  >
                    <iframe
                      title="Receipt preview"
                      srcDoc={previewHtml}
                      className="h-[70vh] w-full border-0 bg-white"
                    />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </header>

        <fieldset
          disabled={settingsScopeLoading}
          className="w-full min-w-0 max-w-full space-y-4 rounded-lg border border-border bg-card p-5 disabled:opacity-60"
        >
          {settingsScopeLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading settings for this scope. Editing becomes available when loading succeeds.
            </p>
          )}
          {children}
        </fieldset>

        {/* Nothing is considered stored until this bar confirms it. */}
        {showSaveBar && (
          <div
            className={`sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur ${
              embedded ? "px-1" : "-mx-6 px-6"
            }`}
          >
            <SaveIndicator dirty={dirty} saving={saving} savedAt={savedAt} error={saveError} />
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={discard}>
                <RotateCcw className="size-4" /> Discard changes
              </Button>
              <Button
                size="sm"
                disabled={saving || (!dirty && !saveError)}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsCtx.Provider>
  );

  return embedded ? body : <SettingsShell>{body}</SettingsShell>;
}
