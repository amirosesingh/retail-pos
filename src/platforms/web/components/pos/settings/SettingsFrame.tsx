import { formatTime as systemTime } from "@/lib/time-zone";
/**
 * Shared shell for every settings page.
 *
 * Each area (display, tax, receipt typography, …) is now its own route, so a
 * page opens as a real window instead of an accordion panel that scrolls the
 * rest of the menu past the user. This frame owns the state all of those pages
 * share: save state, confirmed scope loading and live preview. Scope ownership
 * is managed only from Settings inheritance.
 */
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, Eye, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { SaveIndicator } from "@/platforms/web/components/pos/settings/SaveIndicator";
import { ReceiptPreviewFrame } from "@/platforms/web/components/pos/settings/ReceiptPreviewFrame";
import { useEmbeddedSettings } from "@/platforms/web/components/pos/settings/embed";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePos, PosSettingsDraftProvider } from "@/lib/pos-store";
import { mergePatch } from "@/lib/settings-sections";
import { settingsDraftPatch } from "@/lib/settings-draft";
import { receiptQrError } from "@/lib/receipt-qr";
import { useAuth } from "@/lib/pos-auth";
import type { PermissionFlag } from "@/lib/permissions";
import { defaultPaymentDetails, defaultReceiptSettings, defaultWhatsApp } from "@/lib/pos-seed";
import {
  PAPER_LABELS,
  paperCss,
  saleReceiptPreview,
  bookingSlipPreview,
  jobTagPreview,
  setPreviewReceiptCfg,
  setServiceTerms,
  setPrintSettings,
} from "@/lib/pos-print";
import { defaultPaymentQr, bookingRulesOf } from "@/core/types/pos-types";
import type {
  FontStyleSettings,
  ReceiptOverride,
  ReceiptSettings,
  Sale,
  Booking,
  AppSettings,
} from "@/core/types/pos-types";
import { computeTax } from "@/core/pricing/tax";
import { setSharedPrinterPrefs } from "@/lib/receipt-printer";
import { SettingsCtx } from "./settings-context";
export { useSettingsCtx } from "./settings-context";

import { RECEIPT_DOCUMENTS, type ReceiptDocumentKind } from "@/lib/receipt-documents";

export type SettingsContextValue = {
  previewDocument: ReceiptDocumentKind;
  setPreviewDocument: (kind: ReceiptDocumentKind) => void;
  effective: ReceiptSettings;
  receipt: ReceiptSettings;
  savedReceipt: ReceiptSettings;
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

type Props = {
  title: string;
  description: string;
  children: ReactNode;
  showPreview?: boolean;
  /** Business identity cannot be published without a real company name. */
  requireCompanyName?: boolean;
  /** Diagnostics pages need the whole window: tables and graphs, no reading column. */
  wide?: boolean;
  /** Device registration may also be managed by supervisors. */
  terminalManagement?: boolean;
  /** Match the page-level permission already enforced by AppShell. */
  permission?: PermissionFlag;
  /** Hide the shared save bar on read-only pages and pages with their own save action. */
  showSaveBar?: boolean;
  /**
   * Connection recovery must remain usable before the scoped settings tables
   * can be read. Only pages whose controls do not write scoped settings should
   * opt out of the loading interlock.
   */
  allowWhileScopeLoading?: boolean;
};

export function SettingsFrame({
  title,
  description,
  children,
  showPreview = false,
  requireCompanyName = false,
  terminalManagement = false,
  permission,
  showSaveBar = true,
  allowWhileScopeLoading = false,
}: Props) {
  const router = useRouter();
  const {
    state: persistedState,
    currentStore,
    updateSettings,
    commitSettingsDraft,
    settingsScope,
    scopeIds,
    settingsScopeLoading,
    loadPhase,
    retryLoad,
  } = usePos();
  const { isAdmin, can } = useAuth();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const state = { ...persistedState, settings: draft ?? persistedState.settings };
  const requiredPermission =
    permission ?? (terminalManagement ? "can_manage_terminals" : "can_access_pos_settings");
  const canSettings = isAdmin || can(requiredPermission);
  // Rendered inside the settings workspace sheet: no app shell, no back link.
  const embedded = useEmbeddedSettings();
  const [inlinePreview, setInlinePreview] = useState(false);
  useEffect(() => {
    if (!showPreview || embedded) return;
    const viewport = window.matchMedia("(min-width: 1024px)");
    const update = () => setInlinePreview(viewport.matches);
    update();
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, [showPreview, embedded]);

  /* ---- Save / discard -------------------------------------------------- */
  // Edits apply live so the preview stays honest, but nothing is considered
  // stored until "Save settings" confirms the database write. The snapshot is
  // what "Discard changes" puts back.
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(state.settings));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const settingsJson = JSON.stringify(state.settings);
  const settingsJsonRef = useRef(settingsJson);
  // A remote refresh in this same scope is a new clean baseline. A local edit
  // must retain the old baseline so Discard can still restore what was loaded.
  const localSettingsEdit = useRef(false);
  const dirty = settingsJson !== snapshot;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useBlocker({
    disabled: !showSaveBar || !canSettings,
    enableBeforeUnload: false,
    shouldBlockFn: () => dirtyRef.current && !window.confirm("Leave this page and discard unsaved settings? Save settings first to keep your changes."),
  });

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
  const saveScopeRef = useRef(JSON.stringify(scopeIds));
  saveScopeRef.current = JSON.stringify(scopeIds);
  useEffect(() => {
    if (previousScopeSignature.current === scopeSignature) return;
    previousScopeSignature.current = scopeSignature;
    localSettingsEdit.current = false;
    setDraft(null);
    setSnapshot(JSON.stringify(persistedState.settings));
    setSaveError("");
    setSavedAt(null);
  }, [scopeSignature, persistedState.settings]);

  useEffect(() => {
    settingsJsonRef.current = settingsJson;
    if (localSettingsEdit.current) return;
    setSnapshot(settingsJson);
    setSaveError("");
  }, [settingsJson]);

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
    const edited = settingsDraftPatch(JSON.parse(snapshot), state.settings);
    if (edited.receipt?.qr && state.settings.receipt.qr.enabled) {
      const error = receiptQrError(state.settings.receipt.qr.value);
      if (error) { setSaveError(error); toast.error(error); return; }
    }
    if (
      requireCompanyName &&
      !(
        typeof state.settings.receipt.companyName === "string" &&
        state.settings.receipt.companyName.trim()
      )
    ) {
      const message = "Enter the company name before saving business identity.";
      setSaveError(message);
      toast.error(message);
      return;
    }
    setSaving(true);
    setSaveError("");
    const submittedSettings = settingsJsonRef.current;
    const submittedScope = saveScopeRef.current;
    try {
      await commitSettingsDraft(settingsDraftPatch(JSON.parse(snapshot), JSON.parse(submittedSettings)));
      // The acknowledgment belongs to the branch/terminal that submitted it.
      // Do not discard another scope's newer draft after navigation.
      if (saveScopeRef.current !== submittedScope) return;
      // An input may change while the database request is in flight. Only the
      // exact submitted state becomes clean; later edits remain visibly dirty.
      if (settingsJsonRef.current === submittedSettings) {
        localSettingsEdit.current = false;
        setDraft(null);
        setSnapshot(submittedSettings);
      } else {
        localSettingsEdit.current = true;
      }
      setSavedAt(systemTime(new Date(), { hour: "2-digit", minute: "2-digit" }));
      toast.success("Settings saved");
    } catch (e) {
      if (saveScopeRef.current !== submittedScope) return;
      const message = e instanceof Error ? e.message : "Could not reach the database";
      setSaveError(message);
      toast.error("Could not save settings", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    localSettingsEdit.current = false;
    setDraft(null);
    setSnapshot(JSON.stringify(persistedState.settings));
    setSaveError("");
    toast.info("Changes discarded");
  };

  const { tax, receipt } = state.settings;
  const payment = state.settings.payment ?? defaultPaymentDetails;
  const whatsapp = state.settings.whatsapp ?? defaultWhatsApp;
  const paymentQr = payment.paymentQr ?? defaultPaymentQr;

  // `state.settings` has already been resolved by the central scope engine.
  // Receipt pages must not layer a second, branch-only override system on top.
  const effective = useMemo(
    () => ({
      ...receipt,
      ...Object.fromEntries(
        (
          [
            "companyName",
            "taxNumber",
            "regNumber",
            "phone",
            "website",
            "headerText",
            "footerText",
            "logo",
          ] as const
        ).map((key) => [key, typeof receipt[key] === "string" ? receipt[key] : ""]),
      ),
      fonts: Object.fromEntries(
        (["header", "body", "footer"] as const).map((key) => [
          key,
          { ...defaultReceiptSettings.fonts[key], ...(receipt.fonts?.[key] ?? {}) },
        ]),
      ) as ReceiptSettings["fonts"],
      customLines: Array.isArray(receipt.customLines)
        ? receipt.customLines.filter((line) => line && typeof line.text === "string")
        : [],
      qr: {
        ...defaultReceiptSettings.qr,
        ...receipt.qr,
        value: typeof receipt.qr?.value === "string" ? receipt.qr.value : "",
      },
      bookingSlip: {
        ...defaultReceiptSettings.bookingSlip,
        ...receipt.bookingSlip,
        terms: typeof receipt.bookingSlip?.terms === "string" ? receipt.bookingSlip.terms : "",
      },
    }),
    [receipt],
  );

  const editSettings: typeof updateSettings = (patch) => {
    localSettingsEdit.current = true;
    if (showSaveBar) setDraft(current => mergePatch(current ?? persistedState.settings, patch));
    else updateSettings(patch);
  };

  const setField = <K extends keyof ReceiptOverride>(key: K, value: ReceiptOverride[K]) => {
    editSettings({ receipt: { ...receipt, [key]: value } as ReceiptSettings });
  };

  const setGlobal = (patch: Partial<ReceiptSettings>) =>
    editSettings({ receipt: { ...receipt, ...patch } });

  const setFont = (scope: keyof ReceiptSettings["fonts"], patch: Partial<FontStyleSettings>) =>
    setGlobal({ fonts: { ...receipt.fonts, [scope]: { ...receipt.fonts[scope], ...patch } } });

  const setWhatsApp = (patch: Partial<typeof whatsapp>) =>
    editSettings({ whatsapp: { ...whatsapp, ...patch } });

  const setPaymentQr = (patch: Partial<typeof paymentQr>) =>
    editSettings({ payment: { ...payment, paymentQr: { ...paymentQr, ...patch } } });

  const [previewDocument, setPreviewDocument] = useState<ReceiptDocumentKind>("sale");
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
    setSharedPrinterPrefs(state.settings.integrations.receiptPrinter);
    setPreviewReceiptCfg(effective, tax);
    setServiceTerms(bookingRulesOf(state.settings.integrations.bookingRules).serviceTerms);
    try {
    const saleHtml = saleReceiptPreview(
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
    const bookingSubtotal = sample.subtotal + (previewDocument.startsWith("racket") ? 8 : 0);
    const bookingTax = computeTax(bookingSubtotal, tax);
    const booking: Booking = { ...sample, ref: "BK-000001", subtotal: bookingSubtotal, total: bookingTax.total, tax: bookingTax.tax, paid: 10, payments: [], dueDate: "2026-11-01", memberId: null, customerName: "Sample customer", customerPhone: "555-0142", note: "Customer collection note", status: "active", ...(previewDocument.startsWith("racket") ? { serviceName: "Racket restringing", serviceFee: 8, job: { racketModel: "Sample racket", stringType: "Sample string", tensionMain: 24, tensionCross: 25, tensionUnit: "lb" as const, jobNotes: "Sample stringing instructions", promisedAt: "2026-11-01T10:00:00Z" }, jobStatus: "received" as const } : {}) };
    const html = previewDocument === "sale" ? saleHtml : previewDocument === "racket-staff" ? jobTagPreview(booking) : bookingSlipPreview(booking, null, null);
    return html;
    } finally {
      setPrintSettings(persistedState.settings.receipt, persistedState.settings.tax, persistedState.settings.integrations.rounding);
      setServiceTerms(bookingRulesOf(persistedState.settings.integrations.bookingRules).serviceTerms);
      setSharedPrinterPrefs(persistedState.settings.integrations.receiptPrinter);
    }
  }, [effective, tax, sample, previewDocument, state.settings.integrations.receiptPrinter, state.settings.integrations.bookingRules, persistedState.settings]);

  if (!canSettings) {
    const denied = (
      <div className={embedded ? "" : "p-6"}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground page-description">
          This configuration is managed by an administrator.
        </p>
      </div>
    );
    if (embedded) return denied;
    return <SettingsShell>{denied}</SettingsShell>;
  }

  const geometry = paperCss(effective.paper);

  const ctx: SettingsContextValue = {
    previewDocument, setPreviewDocument,
    effective,
    receipt,
    savedReceipt: persistedState.settings.receipt,
    tax,
    payment,
    whatsapp,
    updateSettings: editSettings,
    setField,
    setGlobal,
    setFont,
    setWhatsApp,
    setPaymentQr,
    paymentQr,
  };

  const body = (
    <SettingsCtx.Provider value={ctx}>
      <PosSettingsDraftProvider settings={state.settings} onChange={editSettings}>
      <div
        className={
          embedded
            ? "w-full max-w-full space-y-4"
            : "pos-page-container"
        }
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          {embedded ? (
            <div />
          ) : (
            <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-0.5 shrink-0"
                aria-label="Back to previous page"
                onClick={() => {
                  if (window.history.length > 1) router.history.back();
                  else void router.navigate({ to: "/settings" });
                }}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="min-w-0 space-y-1">
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground page-description">{description}</p>
              </div>
            </div>
          )}
          {showPreview && (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="shrink-0" disabled={settingsScopeLoading}>
                  <Eye className="size-4" /> Preview receipt
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-[520px]">
                <SheetHeader>
                  <SheetTitle>Live receipt preview · {PAPER_LABELS[effective.paper]}</SheetTitle>
                  <SheetDescription>Sample receipt. Updates as you edit; no sale is created or printed.</SheetDescription>
                </SheetHeader>
                <div className="overflow-auto px-4 pb-6">
                  <div
                    className="mx-auto overflow-hidden rounded-md bg-white"
                    style={{ maxWidth: geometry.width }}
                  >
                    <ReceiptPreviewFrame title="Receipt preview" html={previewHtml} paperWidth={geometry.width} />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </header>

        <div className={showPreview && !embedded ? "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]" : "min-w-0"}>
        <fieldset
          disabled={settingsScopeLoading && !allowWhileScopeLoading}
          className="settings-form w-full min-w-0 max-w-full space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm disabled:opacity-60 sm:p-5"
        >
          {settingsScopeLoading && !allowWhileScopeLoading ? (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-primary/5 p-3 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none text-primary" />
              Loading settings for this scope. Editing becomes available when loading succeeds.
            </p>
          ) : children}
        </fieldset>
        {settingsScopeLoading && (loadPhase === "failed" || loadPhase === "stalled") && <Button type="button" variant="outline" size="sm" onClick={retryLoad}>Retry loading settings</Button>}
        {showPreview && !embedded && inlinePreview && !settingsScopeLoading && (
          <aside aria-label="Live receipt preview" className="sticky top-3 hidden min-w-0 rounded-2xl border bg-muted/30 p-3 lg:block">
            <h2 className="text-sm font-semibold">Live receipt preview</h2>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">{PAPER_LABELS[effective.paper]} · {RECEIPT_DOCUMENTS.find(item => item.value === previewDocument)?.label}. Updates as you edit.</p>
            <div className="mx-auto overflow-hidden rounded-lg bg-white ring-1 ring-border" style={{ maxWidth: geometry.width }}>
              <ReceiptPreviewFrame title="Live receipt preview" html={previewHtml} paperWidth={geometry.width} />
            </div>
          </aside>
        )}
        </div>

        {/* Nothing is considered stored until this bar confirms it. */}
        {showSaveBar && !settingsScopeLoading && (
          <div
            className={`sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur ${
              embedded ? "px-1" : "-mx-4 px-4 sm:-mx-6 sm:px-6"
            }`}
          >
            <SaveIndicator dirty={dirty} saving={saving} savedAt={savedAt} error={saveError} />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={discard}>
                <RotateCcw className="size-4" /> Discard changes
              </Button>
              <Button
                size="sm"
                disabled={saving || settingsScopeLoading || (!dirty && !saveError)}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </div>
        )}
      </div>
      </PosSettingsDraftProvider>
    </SettingsCtx.Provider>
  );

  return embedded ? body : <SettingsShell>{body}</SettingsShell>;
}
