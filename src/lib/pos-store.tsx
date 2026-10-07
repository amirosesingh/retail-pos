import { SettingsWriteQueue } from "./settings-write-queue";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { defaultSettings, defaultTradingHours, emptyState } from "./pos-seed";
import { describeDeleteBlock, type BlockedDelete } from "./product-delete";
import type {
  AppSettings,
  Booking,
  BookingPayment,
  BookingPaymentTiming,
  CartLine,
  IntakeCharge,
  JobStatus,
  Member,
  PaymentMethod,
  PosState,
  Product,
  Promotion,
  RacketJob,
  Sale,
  Shift,
  Store,
  StockAdjustmentReason,
  StringOrigin,
  TaxSettings,
  Transfer,
  TransferItem,
  TransferKind,
  TransferStatus,
} from "@/core/types/pos-types";
import { subscribeDataChange, subscribeSalesChange, subscribeSettingsChange } from "./sync-engine";
import { bookingBalance, lineDiscountTotal, r2, type DiscountType } from "@/core/types/pos-types";
import { logger } from "./audit-log";
import { receiptSequence } from "./report-data-safety";
import { toast } from "sonner";
import {
  db,
  dbError,
  isDuplicateBillNumber,
  loadActiveShift,
  loadCloudState,
  loadLocationDirectory,
  loadPrimaryState,
  loadLocalSales,
  loadCloudMember,
  loadCloudProducts,
  loadCloudPromotion,
  loadCloudSettings,
  loadSalesPage,
  openShiftOnServer,
  stableChildId,
} from "@/core/api/pos-db";
import { recordActivity } from "./activity-events";
import { notifyError } from "./notify";
import type { CloudSlice, CommitTarget } from "@/core/api/pos-db";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
import { platformName } from "@/platform-config/platform";
import { APP_RESUME_EVENT } from "@/core/activation/connection-health";
import { useAuth } from "@/lib/pos-auth";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { reserveBillNumber } from "./bill-number";
import { loadCashierToken, loadSessionToken } from "./pos-credentials";
import { beginAutoLockOperation } from "./auto-lock";
import { markStartupStage } from "./startup-timing";
import {
  activeBranchId,
  bindTerminalBranch,
  requireBranchId,
  setKnownBranches,
} from "./active-branch";
import { isShiftOverdue, localTerminalId } from "./shift-hours";
import { beginShiftSession, endShiftSessions } from "./shift-sessions";
import { setPublicHosts } from "./coupon-hosts";
import { branchDisplayName } from "./human-readable";
import { activeLocations, archiveBlockers, canonicalLocations } from "./locations";
import { branchPolicy } from "./branch-policy";
import { setActiveBranchSyncPolicy } from "./sync-policy";
import { setPosFormats, setPosTimeZone } from "./time-zone";
import {
  approveTransferInDb,
  dispatchTransferInDb,
  receiveTransferInDb,
  closeRequestInDb,
  verifyTransferInDb,
  saveTransfer,
  setTransferStatus,
  type LineQty,
  type RpcResult,
} from "./stock-transfers";
import { computeTax } from "@/core/pricing/tax";
import { commitBooking, deleteBookingRow, loadBookings, saveBookingQuietly } from "./bookings-db";
import { trackTransition } from "./status-history";
import {
  cancelBookingAuthoritative,
  collectBookingPayment,
  refundBookingPayment,
  readBookingBalance,
} from "./booking-collection";
import {
  clearSectionOverride,
  emptyBranchSettings,
  emptyScopeIds,
  loadBranchSettings,
  resolveScopedSettings,
  saveSectionOverride,
  setSectionLock,
  SETTING_TIERS,
  TIER_LABELS,
  type BranchSettingsState,
  type ScopeIds,
  type SettingSource,
  type SettingTier,
} from "./branch-settings";
import {
  SECTION_BY_ID,
  getPath,
  mergePatch,
  patchPaths,
  sectionAllowsTier,
  sectionOfPath,
  setPath,
  type SettingsSectionId,
} from "./settings-sections";
import { localDb } from "@/core/local-db/local-db";
import {
  batches,
  DEFAULT_BATCH_SIZE,
  importFailureReason,
  isSystemicImportFailure,
  persistBatchWithIsolation,
  type ImportProductsOptions,
  type ImportProductsResult,
  type ImportRow,
} from "./product-import";
import { productCodes } from "./product-lookup";
import { applyZeroStockLifecycle, applyZeroStockLifecycleToProducts } from "./product-lifecycle";
import { nextSku, readSkuSettings } from "./sku";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "./branch-id";

const LEGACY_STATE_KEY = "pos-state-v2";

export const stockAt = (product: Product, storeId: string) =>
  canonicalStockMap(product.stockByStore)[canonicalBranchId(storeId)] ?? 0;

/** Units held back at a store by still-open bookings. */
export const reservedAt = (bookings: Booking[], productId: string, storeId: string) =>
  bookings
    .filter((b) => b.status === "active" && sameBranchId(b.storeId, storeId))
    .reduce(
      (a, b) =>
        a +
        b.lines
          .filter((l) => l.productId === productId && !l.credit)
          .reduce((x, l) => x + l.qty, 0),
      0,
    );

/** Stock a cashier may actually sell right now: on hand minus booked units. */
export const availableAt = (product: Product, storeId: string, bookings: Booking[] = []) =>
  stockAt(product, storeId) - reservedAt(bookings, product.id, storeId);

const bump = (p: Product, storeId: string, delta: number, lifecycle = false): Product => {
  const canonicalId = canonicalBranchId(storeId);
  const current = canonicalStockMap(p.stockByStore);
  const hadStock = Object.values(current).some((qty) => qty > 0);
  const stockByStore = { ...current, [canonicalId]: (current[canonicalId] ?? 0) + delta };
  if (!lifecycle) return { ...p, stockByStore };
  const hasStock = Object.values(stockByStore).some((qty) => qty > 0);
  return {
    ...p,
    stockByStore,
    archived: hadStock === hasStock ? p.archived : !hasStock,
  };
};

type NewTransfer = {
  kind: TransferKind;
  fromStoreId: string;
  toStoreId: string;
  items: { productId: string; qty: number }[];
  note: string;
  createdBy: string;
  /** the request this transfer fulfils, when it was raised from one */
  sourceRequestId?: string;
  /** hold the note as "requested" until somebody authorises it */
  needsApproval?: boolean;
};

export type NewBooking = {
  storeId: string;
  shiftId: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** what the booking is for, and what the job costs */
  serviceTypeId?: string;
  serviceName?: string;
  serviceFee?: number;
  /** up front, part deposit, or on collection */
  paymentTiming?: BookingPaymentTiming;
  /** deposit collected at the counter right now */
  deposit: number;
  depositMethod: PaymentMethod;
  dueDate: string;
  memberId: string | null;
  customerName: string;
  customerPhone: string;
  note: string;
  cashier: string;
  /** racket stringing job card, when the booking is a string job */
  job?: RacketJob;
  /** quick job tag used when no customer is attached yet */
  tagId?: string;
  /** who dropped the racket off ("Dropped off by Coach Alex") */
  intakeNote?: string;
  stringOrigin?: StringOrigin;
  stringProductId?: string;
  gripProductId?: string;
  /** priced breakdown: labour, string, grip, add-ons */
  charges?: IntakeCharge[];
  /** customer accepted the service & high-tension liability terms */
  liabilityAccepted?: boolean;
  /** stringer assigned at intake */
  technician?: string;
};

/** Racket stringing job card captured with the booking. */
export type NewBookingJob = RacketJob;

/** Apply a stock delta for every line of a transfer at one store. */
const bumpItems = (
  products: Product[],
  items: { productId: string; qty: number }[],
  storeId: string,
  sign: 1 | -1,
  lifecycle = false,
) =>
  products.map((p) => {
    const item = items.find((i) => i.productId === p.id);
    return item ? bump(p, storeId, sign * item.qty, lifecycle) : p;
  });

/** Where the first read of the shop's data has got to. */
export type LoadPhase = "loading" | "ready" | "stalled" | "failed";

type Ctx = {
  ready: boolean;
  /**
   * Honest launch state. `stalled` means the first read is taking longer than
   * expected — it never means the data arrived. `failed` means the read
   * genuinely came back with an error.
   */
  loadPhase: LoadPhase;
  /** true only once the location list has actually been answered for */
  storesLoaded: boolean;
  /** run the first read again after a stall or failure */
  retryLoad: () => void;
  state: PosState;
  stores: Store[];
  /** every location including archived ones — for the setup screen only */
  allStores: Store[];
  currentStore: Store;
  setCurrentStore: (id: string) => void;
  upsertStore: (store: Store) => Promise<CommitTarget>;
  /** archive (never delete) a location; returns why it was refused, if it was */
  archiveStore: (id: string, archived: boolean) => Promise<string | null>;
  /** Remove a location already deleted by the protected central transaction. */
  forgetDeletedStore: (id: string) => void;
  openShift: (cashier: string, openingFloat: number) => Promise<CommitTarget>;
  closeShift: (
    countedCash: number,
    note: string,
    extras?: Partial<
      Pick<
        Shift,
        | "countedCard"
        | "countedDigital"
        | "expectedCash"
        | "expectedCard"
        | "expectedDigital"
        | "varianceCash"
        | "varianceCard"
        | "varianceDigital"
        | "varianceTotal"
      >
    >,
  ) => Promise<Shift | null>;
  activeShift: Shift | null;
  /** Set when the last open-shift read failed; the till keeps trading. */
  shiftReadError: string | null;
  /** False until the first open-shift read has answered. */
  shiftChecked: boolean;
  recordSale: (
    sale: Omit<Sale, "id" | "receiptNo" | "createdAt"> & { receiptNo?: string },
    memberSnapshot?: Member | null,
  ) => Promise<Sale>;
  refundSale: (
    saleId: string,
    grantToken?: string | null,
    loadedSale?: Sale,
  ) => Promise<boolean>;
  changeSalePayment: (saleId: string, method: PaymentMethod, reason?: string) => Promise<boolean>;
  createBooking: (input: NewBooking) => Promise<Booking>;
  setBookingJobStatus: (
    id: string,
    status: JobStatus,
    who: string,
    incidentNote?: string,
  ) => Promise<Booking | null>;
  /** Edit the technical specs of an existing racket job before payment. */
  updateBookingSpecs: (id: string, job: RacketJob) => Booking | null;
  addBookingPayment: (
    id: string,
    amount: number,
    method: PaymentMethod,
    cashier: string,
    clientPaymentId?: string,
  ) => Promise<Booking | null>;
  collectBooking: (
    id: string,
    amount: number,
    method: PaymentMethod,
    clientPaymentId?: string,
  ) => Promise<{ booking: Booking; sale: Sale } | null>;
  cancelBooking: (
    id: string,
    reason: string,
    terminal?: string | null,
    moneyAction?: "refunded" | "retained" | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Hand money back on a booking; the server caps it at what was taken. */
  refundBooking: (
    id: string,
    amount: number,
    method: PaymentMethod,
    reason: string,
  ) => Promise<{ ok: true; booking: Booking } | { ok: false; error: string }>;

  deleteBooking: (id: string, reason: string) => Promise<void>;
  upsertProduct: (product: Product) => Promise<CommitTarget>;
  upsertProductPriceOverride: (
    productId: string,
    price: number,
    ecomPrice?: number,
  ) => Promise<CommitTarget>;
  /** Save a whole spreadsheet of products in batches, accounting for every row. */
  importProducts: (
    rows: ImportRow[],
    options?: ImportProductsOptions,
  ) => Promise<ImportProductsResult>;

  removeProduct: (id: string) => Promise<BlockedDelete[]>;
  removeProducts: (ids: string[]) => Promise<BlockedDelete[]>;
  patchProducts: (ids: string[], patch: Partial<Product>) => Promise<CommitTarget>;
  archiveProducts: (ids: string[]) => Promise<CommitTarget>;
  restoreProducts: (ids: string[]) => Promise<CommitTarget>;
  mergeProducts: (masterId: string, duplicateIds: string[]) => Promise<BlockedDelete[]>;
  adjustStock: (id: string, delta: number, storeId?: string) => Promise<CommitTarget | null>;
  moveStock: (
    id: string,
    qty: number,
    fromStoreId: string,
    toStoreId: string,
  ) => Promise<CommitTarget | null>;
  /** Re-read the given products from the database into local state. */
  syncProducts: (ids: string[]) => Promise<void>;
  applyStockCount: (
    entries: { productId: string; counted: number }[],
    reason: StockAdjustmentReason,
    note?: string,
    storeId?: string,
    draftId?: string | null,
    postedBy?: string | null,
  ) => Promise<CommitTarget | null>;
  upsertMember: (member: Member) => Promise<CommitTarget>;
  removeMember: (id: string) => Promise<void>;
  upsertPromotion: (promotion: Promotion) => Promise<CommitTarget>;
  removePromotion: (id: string) => Promise<void>;
  togglePromotion: (id: string, active: boolean) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Write directly to the company-wide record, bypassing inherited scopes. */
  updateGlobalSettings: (patch: Partial<AppSettings>) => void;
  saveConfiguredSettings: () => Promise<void>;
  /** Which settings blocks each tier overrides, and which are locked globally. */
  settingsScope: BranchSettingsState;
  /** The persisted global record before cluster/store/terminal overrides are resolved. */
  configuredGlobalSettings: AppSettings;
  /** The cluster, branch and selected terminal ids used for configuration. */
  scopeIds: ScopeIds;
  settingsScopeLoading: boolean;
  settingsTerminalId: string;
  setSettingsTerminalId: (id: string) => void;
  /** Start (or stop) overriding one block at one tier. */
  setSectionScope: (
    section: SettingsSectionId,
    on: boolean,
    tier?: SettingTier,
    scopeId?: string,
  ) => Promise<void>;
  /** Where the value at a dotted settings path is coming from right now. */
  sourceOfPath: (path: string) => SettingSource;
  /** Lock a block so no branch can override it. */
  setSectionLocked: (section: SettingsSectionId, locked: boolean) => Promise<void>;
  createTransfer: (input: NewTransfer) => Promise<Transfer>;
  /** authorise the note, optionally cutting quantities back */
  approveTransfer: (id: string, lines?: LineQty[]) => Promise<RpcResult>;
  /** send what is actually on the shelf — this closes the request */
  dispatchTransfer: (id: string, lines?: LineQty[]) => Promise<RpcResult>;
  /** the box arrived — no stock moves yet */
  receiveTransfer: (id: string) => Promise<RpcResult>;
  /** the count that puts stock on the destination shelf */
  verifyTransfer: (id: string, lines: LineQty[], reason?: string) => Promise<RpcResult>;
  rejectTransfer: (id: string, reason: string) => Promise<RpcResult>;
  reset: () => void;
};

/**
 * One context object per browser session, not per module evaluation. A hot
 * reload (or any second copy of this module in the graph) would otherwise mint
 * a fresh context, so the provider and the consumer would look at different
 * objects and the till would blank with "usePos must be used inside
 * PosProvider" even though the provider is mounted.
 */
const contextRegistry = globalThis as typeof globalThis & {
  __posContext?: React.Context<Ctx | null>;
};
const PosContext = (contextRegistry.__posContext ??= createContext<Ctx | null>(null));

/** Merge a cloud (or cached snapshot) slice into local state. */
function mergeCloudSettings(cloudSettings: CloudSlice["settings"]): PosState["settings"] {
  return {
    tax: { ...defaultSettings.tax, ...cloudSettings?.tax },
    receipt: { ...defaultSettings.receipt, ...cloudSettings?.receipt },
    payment: { ...defaultSettings.payment, ...cloudSettings?.payment },
    whatsapp: { ...defaultSettings.whatsapp, ...cloudSettings?.whatsapp },
    integrations: { ...defaultSettings.integrations, ...cloudSettings?.integrations },
    visibility: { ...defaultSettings.visibility, ...cloudSettings?.visibility },
  };
}

function applyCloud(s: PosState, cloud: CloudSlice, pendingSales?: Set<string>): PosState {
  const cloudShifts = cloud.shifts ?? [];
  const cloudProducts = cloud.products ?? [];
  const cloudMembers = cloud.members ?? [];
  const cloudSales = cloud.sales ?? [];
  const cloudPromotions = cloud.promotions ?? [];
  const cloudStores = cloud.stores ?? [];
  const cloudSettings = cloud.settings ?? ({} as CloudSlice["settings"]);
  const settings = mergeCloudSettings(cloudSettings);
  return {
    ...s,
    // Older installations may not have the database lifecycle trigger yet.
    // Keep stale zero-stock rows out of the active catalogue immediately; the
    // trigger/backfill remains responsible for persisting the same state.
    products: applyZeroStockLifecycleToProducts(
      cloudProducts,
      settings.integrations.autoArchiveZeroStock !== false,
    ),
    members: cloudMembers,
    sales: (() => {
      if (!pendingSales?.size) return cloudSales;
      const incoming = new Set(cloudSales.map((sale) => sale.id));
      const preserved = s.sales.filter(
        (sale) => pendingSales.has(sale.id) && !incoming.has(sale.id),
      );
      return [...preserved, ...cloudSales]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 500);
    })(),
    // Shifts are central now so every terminal agrees on what is open.
    shifts: cloudShifts.length ? cloudShifts : s.shifts,
    promotions: cloudPromotions.length ? cloudPromotions : s.promotions,
    // This is an authoritative snapshot, including an authoritative empty
    // directory. Keeping the old array when the answer is empty resurrects
    // deleted branches after reconnect or restart.
    stores: canonicalLocations(cloudStores),
    // A registered till never drifts to another branch: if the terminal is
    // bound and that branch exists centrally, it wins over anything saved.
    currentStoreId: (() => {
      const bound = activeBranchId(null);
      if (bound && cloudStores.some((x) => x.id === bound)) return bound;
      if (!cloudStores.length) return s.currentStoreId;
      return cloudStores.find((x) => x.id === s.currentStoreId)?.id ?? cloudStores[0].id;
    })(),
    settings,
    // Keep the bill counter ahead of every receipt already in the cloud.
    counter: cloudSales.reduce(
      (max, sale) => Math.max(max, receiptSequence(sale.receiptNo)),
      s.counter,
    ),
  };
}

function applyLocationDirectory(s: PosState, stores: Store[]): PosState {
  const canonical = canonicalLocations(stores);
  const bound = activeBranchId(null);
  return {
    ...s,
    stores: canonical,
    currentStoreId:
      bound && canonical.some((store) => store.id === bound)
        ? bound
        : canonical.some((store) => store.id === s.currentStoreId)
          ? s.currentStoreId
          : (canonical[0]?.id ?? s.currentStoreId),
  };
}

/** Replace one branch's receipt window without hiding unsynced local sales. */
function applySalesSnapshot(
  current: PosState,
  rows: Sale[],
  active: string | null | undefined,
  pendingSales: Set<string>,
  confirmPending: boolean,
): PosState {
  const ids = new Set(rows.map((sale) => sale.id));
  if (confirmPending) for (const id of ids) pendingSales.delete(id);
  const pending = current.sales.filter((sale) => pendingSales.has(sale.id) && !ids.has(sale.id));
  const otherBranches = current.sales.filter(
    (sale) => sale.storeId !== active && !ids.has(sale.id),
  );
  const sales = [...pending, ...rows, ...otherBranches]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500);
  return {
    ...current,
    sales,
    counter: rows.reduce(
      (max, sale) => Math.max(max, receiptSequence(sale.receiptNo)),
      current.counter,
    ),
  };
}

export function PosProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PosState>(emptyState);
  const [ready, setReady] = useState(false);
  // Loading, ready, stalled or failed — never "the clock ran out, call it ready".
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  // Whether the location list has actually been answered for, so an empty list
  // can be told apart from a list that has not arrived yet.
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const retryLoad = useCallback(() => {
    setStoresLoaded(false);
    setLoadPhase("loading");
    setReloadTick((v) => v + 1);
  }, []);
  const { authUserId, terminalUser, user, can, isAdmin, ready: authReady } = useAuth();
  // Nothing is fetched from the cloud until a cashier or supervisor session
  // exists — visitors never receive catalogue, member or sales data.
  const signedIn = Boolean(authUserId || terminalUser);
  const missingCompanyNameNotice = useRef(false);
  useEffect(() => {
    if (!signedIn || !isAdmin || !ready || loadPhase !== "ready") return;
    if (state.settings.receipt.companyName?.trim()) {
      missingCompanyNameNotice.current = false;
      return;
    }
    if (missingCompanyNameNotice.current) return;
    missingCompanyNameNotice.current = true;
    toast.warning("Company name is missing", {
      description: "Enter the business name in Settings → Business identity. Other POS work can continue.",
      duration: 10000,
    });
  }, [signedIn, isAdmin, ready, loadPhase, state.settings.receipt.companyName]);
  // Latest snapshot for audit logging without re-creating every callback.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Protect a locally committed receipt until a later local/cloud snapshot has
  // actually observed it. Focus and Realtime refreshes may race the sync push.
  const pendingSalesRef = useRef(new Set<string>());
  // Who is acting right now — stamped on transfer approvals and receipts.
  const actorRef = useRef("Manager");
  actorRef.current = terminalUser?.name || user?.email || "Manager";
  const actorStaffIdRef = useRef<string | null>(null);
  actorStaffIdRef.current = user?.staffId ?? terminalUser?.userCode ?? null;
  const actorRoleRef = useRef<string | null>(null);
  actorRoleRef.current = user?.role ?? terminalUser?.role ?? null;
  // Scoped business/terminal overrides and global locks.
  const [scope, setScope] = useState<BranchSettingsState>(emptyBranchSettings);
  const settingsWrites = useRef(new SettingsWriteQueue());
  const trackSettingsWrite = (key: string, save: () => Promise<unknown>) =>
    settingsWrites.current.enqueue(key, save);
  const saveConfiguredSettings = () => settingsWrites.current.flush();
  const [settingsTerminalId, setSettingsTerminalId] = useState("");
  const loadedScopeKey = useRef("");
  const [confirmedScopeKey, setConfirmedScopeKey] = useState("");
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // Which cluster, branch and terminal the settings editor is resolving.
  const scopeIds = useMemo<ScopeIds>(() => {
    const store = state.stores.find((s) => s.id === state.currentStoreId);
    return {
      CLUSTER: store?.groupId ?? "",
      BRANCH: state.currentStoreId ?? "",
      TERMINAL: settingsTerminalId || readTerminalConfig()?.tokenId || "",
    };
  }, [state.stores, state.currentStoreId, settingsTerminalId]);
  const scopeIdsRef = useRef<ScopeIds>(emptyScopeIds);
  scopeIdsRef.current = scopeIds;
  const whoRef = useRef("Manager");
  whoRef.current = actorRef.current;
  // Lets earlier callbacks reach the settings writer defined further down.
  const updateSettingsRef = useRef<((patch: Partial<AppSettings>) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A read that is taking too long is reported as exactly that. It is never
    // turned into "the data arrived", which would show an empty, healthy-looking
    // shop built out of nothing.
    const watchdog = window.setTimeout(() => {
      if (!cancelled) setLoadPhase((p) => (p === "loading" ? "stalled" : p));
    }, 15000);
    void (async () => {
      // Anonymous visitors get nothing: no products, members or sales.
      if (!signedIn) {
        if (authReady && !cancelled) {
          setReady(true);
          setLoadPhase("ready");
        }
        return;
      }
      if (
        typeof navigator !== "undefined" &&
        !navigator.onLine &&
        effectiveDatabaseMode() === "online"
      ) {
        if (!cancelled) {
          setReady(true);
          setLoadPhase("ready");
        }
        return;
      }
      try {
        // The PIN/session proofs live in encrypted device storage. Load them
        // before branch discovery decides whether the protected relay exists.
        await Promise.all([loadCashierToken(), loadSessionToken()]);
        // Resolve the small location directory whenever the central service is
        // reachable, including on a local-first Electron till. Business data
        // still comes from SQL Server, but a newly registered/created branch
        // must not stay invisible until a later full local snapshot refresh.
        const canLoadCloudDirectory = typeof navigator === "undefined" || navigator.onLine;
        const locationTask = canLoadCloudDirectory ? loadLocationDirectory() : null;
        const cloudTask = loadPrimaryState(undefined, locationTask ?? undefined);
        const directory = locationTask ? await locationTask : null;
        if (cancelled) return;
        if (directory?.ok) {
          markStartupStage("location");
          setState((s) => applyLocationDirectory(s, directory.stores));
          setStoresLoaded(true);
          setReady(true);
          setLoadPhase("ready");
          markStartupStage("essential-pos-ready");
        }
        const loaded = await cloudTask;
        if (cancelled) return;
        // A cloud-only client cannot proceed without an authoritative branch
        // answer. An Electron till may continue from its durable SQL snapshot
        // while the relay/server is temporarily unavailable.
        if (
          directory &&
          !directory.ok &&
          !loaded.stores.length &&
          effectiveDatabaseMode() === "online"
        )
          throw directory.error;
        const cloud = directory?.ok ? { ...loaded, stores: directory.stores } : loaded;
        setState((s) => applyCloud(s, cloud, pendingSalesRef.current));
        markStartupStage("remaining-data-ready");
        // The locations question now has a real answer, empty or not.
        setStoresLoaded(true);
        setLoadPhase("ready");
        // No backfill here on purpose: an empty branch list means the operator
        // deleted them, and re-creating them would undo that.
        // Bookings and racket job cards are secondary: the till is usable
        // without them, so they arrive after the first screen is up.
        void loadBookings()
          .then((cloudBookings) => {
            if (cancelled || !cloudBookings.length) return;
            setState((s: PosState) => {
              const seen = new Set(cloudBookings.map((b) => b.id));
              return {
                ...s,
                bookings: [...cloudBookings, ...s.bookings.filter((b) => !seen.has(b.id))],
              };
            });
          })
          .catch(() => {
            /* offline or not permitted — the local list still works */
          });
      } catch (e) {
        void localDb()?.logConnection?.("renderer.bootstrap.failed", {
          scope: "initial-data",
          code: String((e as { code?: unknown })?.code ?? "ELOAD"),
          message: e instanceof Error ? e.message : String(e),
        });
        dbError("Loading data", e);
        if (!cancelled) setLoadPhase("failed");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, [signedIn, authReady, reloadTick]);

  useEffect(() => {
    if (!ready) return;
    if (effectiveDatabaseMode() === "online") return;
    // Business rows already live in SQL Server. Older builds also rewrote the
    // complete POS state into the encrypted config file on every state change;
    // large catalogues made that file multi-megabyte and launch/save needlessly
    // expensive. Remove that obsolete snapshot once and keep SQL authoritative.
    const pending = localDb()?.setSetting?.(LEGACY_STATE_KEY, null);
    if (pending) void pending.catch(() => undefined);
  }, [ready]);

  // Overrides follow the cluster, branch and selected terminal in context.
  useEffect(() => {
    if (!signedIn || !state.currentStoreId) return;
    let cancelled = false;
    const scopeKey = JSON.stringify(scopeIds);
    if (loadedScopeKey.current !== scopeKey) {
      loadedScopeKey.current = scopeKey;
      setConfirmedScopeKey("");
      setScope(emptyBranchSettings);
    }
    let running = false;
    const refreshScope = async () => {
      if (running || settingsWrites.current.pending) return;
      running = true;
      const revision = settingsWrites.current.revision;
      try {
        const next = await loadBranchSettings(scopeIds, true);
        if (
          !cancelled &&
          !settingsWrites.current.pending &&
          revision === settingsWrites.current.revision
        ) {
          setScope(next);
          setConfirmedScopeKey(scopeKey);
        }
      } catch {
        /* Preserve confirmed scope on a failed refresh. */
      } finally {
        running = false;
      }
    };
    void refreshScope();
    const interval = window.setInterval(() => void refreshScope(), 60_000);
    const off = subscribeSettingsChange(() => void refreshScope());
    const onFocus = () => void refreshScope();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      off();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [signedIn, state.currentStoreId, scopeIds]);

  // The directory may not have loaded yet (a cashier signs in with a PIN and
  // has no central-database account of their own). The terminal's own
  // activation claim still knows the branch, so use it rather than showing a
  // placeholder that reads "No branch yet" and locks the register.
  const currentStore = useMemo(() => {
    const found = state.stores.find((s) => s.id === state.currentStoreId) ?? state.stores[0];
    if (found) return found;
    const terminal = readTerminalConfig();
    const boundId = (terminal?.locationId ?? "").trim() || state.currentStoreId.trim();
    return {
      id: boundId,
      code: "",
      name: (terminal?.locationName ?? "").trim() || (boundId ? "This branch" : "No branch yet"),
      address: "",
      phone: "",
    };
  }, [state.stores, state.currentStoreId]);

  // Let the shared branch resolver fall back to the only branch that exists.
  useEffect(() => {
    setKnownBranches(state.stores.map((s) => s.id));
  }, [state.stores]);

  // Take the branch identity from the central directory and mirror it locally,
  // so a branch renamed centrally reaches this till on the next load. Nothing
  // is written while the branch is unknown — an existing local copy stands.
  useEffect(() => {
    if (!state.stores.length) return;
    const id = activeBranchId(state.currentStoreId);
    if (!id) return;
    const match = state.stores.find((s) => s.id === id);
    if (!match) return;
    bindTerminalBranch(match.id, match.name);
    void import("@/core/local-db/local-db")
      .then(({ readBranch, writeBranch }) => {
        const local = readBranch();
        if (local.branchId === match.id && local.branchName === match.name) return;
        writeBranch({ branchId: match.id, branchName: match.name });
      })
      .catch(() => {
        /* branch mirroring is best-effort */
      });
  }, [state.stores, state.currentStoreId]);

  // Publish the branch's sync switches to the outbox drainer and the region
  // clock to every formatter, so both follow the saved settings.
  useEffect(() => {
    setActiveBranchSyncPolicy(branchPolicy(state.settings, state.currentStoreId));
  }, [state.settings, state.currentStoreId]);

  // Public member / redeem domains are admin-configured, never hardcoded.
  useEffect(() => {
    setPublicHosts(
      state.settings.integrations.memberDomain,
      state.settings.integrations.redeemDomain,
    );
  }, [state.settings.integrations.memberDomain, state.settings.integrations.redeemDomain]);

  useEffect(() => {
    setPosTimeZone(state.settings.integrations.timeZone);
    setPosFormats(state.settings.integrations.dateFormat, state.settings.integrations.timeFormat);
  }, [
    state.settings.integrations.timeZone,
    state.settings.integrations.dateFormat,
    state.settings.integrations.timeFormat,
  ]);

  // Authoritative open shift for this branch, straight from the database.
  // Falls back to the cached list when the terminal is offline. Purely
  // status-driven: a shift opened days ago stays active until it is closed.
  const [dbShift, setDbShift] = useState<Shift | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);
  const [shiftReadError, setShiftReadError] = useState<string | null>(null);
  // A shift opened on this till a moment ago is trusted even if the next read
  // has not caught up yet — a slow replica must never re-lock the register.
  const justOpenedRef = useRef<{ shift: Shift; at: number } | null>(null);

  const refreshActiveShift = useCallback(async () => {
    // The terminal's registered branch wins, so the read always matches the
    // branch the shift was opened against.
    const storeId =
      activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
    try {
      const found = await loadActiveShift(storeId);
      const fresh = justOpenedRef.current;
      // A shift opened on this till stays open until it is closed here. A read
      // that cannot see it yet (replica lag, offline queue) must never re-lock
      // the register, however long ago it was opened.
      if (!found && fresh && fresh.shift.storeId === storeId) {
        setShiftReadError(null);
        setDbShift(fresh.shift);
        return;
      }
      setShiftReadError(null);
      setDbShift(found);
      // Only a real close ends a shift. An empty read never rewrites the
      // cached shift to CLOSED — the database row stays OPEN, and marking it
      // closed locally is what used to lock a trading till after a sign-out.
      if (found) {
        const row = found;
        setState((s) => ({
          ...s,
          shifts: s.shifts.some((x) => x.id === row.id)
            ? s.shifts.map((x) => (x.id === row.id ? row : x))
            : [row, ...s.shifts],
        }));
      }
    } catch (e) {
      // Offline, refused or unreachable: never downgrade a trading till to
      // "locked" — keep the last known open shift and say we are reconnecting.
      setShiftReadError((e as Error).message || "Could not reach the central database");
      setDbShift(
        (prev) =>
          (prev && prev.storeId === storeId && !prev.closedAt ? prev : null) ??
          justOpenedRef.current?.shift ??
          stateRef.current.shifts.find(
            (s) => s.storeId === storeId && s.status !== "CLOSED" && !s.closedAt,
          ) ??
          null,
      );
    } finally {
      setShiftChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      // Signing out never closes the shift: keep the last known open shift so
      // the next cashier walks straight back into it while the re-read runs.
      setShiftChecked(false);
      return;
    }
    void refreshActiveShift();
  }, [signedIn, currentStore.id, refreshActiveShift]);

  // A registered till trades in its own branch — pin the view to it as soon as
  // that branch exists in the directory, before any shift read runs.
  useEffect(() => {
    // Persist the terminal's branch first, so every later read has one source.
    bindTerminalBranch();
    const bound = activeBranchId(null);
    if (!bound) return;
    // The branch is pinned even before the directory arrives — a registered
    // till knows its own branch, and waiting for the store list is what left
    // the register on "No branch yet".
    setState((s) => (s.currentStoreId === bound ? s : { ...s, currentStoreId: bound }));
  }, [state.stores, signedIn]);

  // Web, Android and iOS hold nothing locally, so returning to the app must re-read the
  // catalogue, members, prices and shift from the backend.
  useEffect(() => {
    if (effectiveDatabaseMode() !== "online" || !signedIn) return;
    let cancelled = false;
    let loading = false;
    let resumeTimer: number | undefined;
    const resume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      // Focus, visibility and the native app-state event often arrive together.
      // One foreground transition needs one snapshot, not three full reads.
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        resumeTimer = undefined;
        if (loading || cancelled) return;
        loading = true;
        void loadCloudState()
          .then((cloud) => {
            if (!cancelled) setState((s) => applyCloud(s, cloud, pendingSalesRef.current));
          })
          .catch(() => {
            /* the offline gate takes over if the connection is gone */
          })
          .finally(() => {
            loading = false;
          });
        void refreshActiveShift();
      }, 200);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener(APP_RESUME_EVENT, resume);
    let removeNative: (() => Promise<void>) | undefined;
    if (["android", "ios"].includes(platformName())) {
      void import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) resume();
          }),
        )
        .then((handle) => {
          if (cancelled) void handle.remove();
          else removeNative = () => handle.remove();
        })
        .catch(() => {
          /* WebView visibility and focus remain the lifecycle fallback. */
        });
    }
    return () => {
      cancelled = true;
      if (resumeTimer) window.clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener(APP_RESUME_EVENT, resume);
      if (removeNative) void removeNative();
    };
  }, [signedIn, refreshActiveShift]);

  // Electron can miss socket events while its window is minimized. Regaining
  // focus wakes the durable worker and re-reads the branch snapshot; the
  // worker remains responsible for ordered push/pull convergence.
  useEffect(() => {
    if (effectiveDatabaseMode() === "online" || !signedIn) return;
    const focus = () => {
      const bridge = localDb();
      const active =
        activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
      void Promise.resolve(bridge?.sync?.auto?.())
        .catch(() => undefined)
        .then(() => loadPrimaryState(active ?? undefined))
        .then((cloud) => setState((current) => applyCloud(current, cloud, pendingSalesRef.current)))
        .catch(() => {
          /* The local snapshot remains authoritative while sync recovers. */
        });
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [signedIn]);

  // Catalogue, member and promotion events carry the changed row identity.
  // Pull only that row so a barcode or price edit never downloads the complete
  // master dataset or interrupts scanning and checkout.
  useEffect(() => {
    if (!signedIn) return;
    const timers = new Map<string, number>();
    const pendingProductIds = new Set<string>();
    const unsubscribe = subscribeDataChange((change) => {
      if (
        !change.entityId ||
        !["products", "product_barcodes", "members", "promotions"].includes(change.table)
      )
        return;
      const kind = change.table === "product_barcodes" ? "products" : change.table;
      if (kind === "products") {
        pendingProductIds.add(change.entityId);
        const previous = timers.get("products:batch");
        if (previous) window.clearTimeout(previous);
        timers.set(
          "products:batch",
          window.setTimeout(() => {
            timers.delete("products:batch");
            const ids = [...pendingProductIds];
            pendingProductIds.clear();
            void loadCloudProducts(ids)
              .then((records) => {
                const changed = new Set(ids);
                const byId = new Map(records.map((record) => [record.id, record]));
                setState((current) => ({
                  ...current,
                  products: [
                    ...current.products
                      .filter((product) => !changed.has(product.id) || byId.has(product.id))
                      .map((product) => byId.get(product.id) ?? product),
                    ...records.filter(
                      (record) => !current.products.some((product) => product.id === record.id),
                    ),
                  ],
                }));
              })
              .catch(() => {
                /* the next reconnect snapshot remains the recovery path */
              });
          }, 150),
        );
        return;
      }
      const key = `${kind}:${change.entityId}`;
      const previous = timers.get(key);
      if (previous) window.clearTimeout(previous);
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          const read =
            kind === "members"
              ? loadCloudMember(change.entityId!)
              : loadCloudPromotion(change.entityId!);
          void read
            .then((record) => {
              setState((current) => {
                if (kind === "members") {
                  const members = record
                    ? current.members.some((row) => row.id === record.id)
                      ? current.members.map((row) =>
                          row.id === record.id ? (record as Member) : row,
                        )
                      : [record as Member, ...current.members]
                    : current.members.filter((row) => row.id !== change.entityId);
                  return { ...current, members };
                }
                const promotions = record
                  ? current.promotions.some((row) => row.id === record.id)
                    ? current.promotions.map((row) =>
                        row.id === record.id ? (record as Promotion) : row,
                      )
                    : [record as Promotion, ...current.promotions]
                  : current.promotions.filter((row) => row.id !== change.entityId);
                return { ...current, promotions };
              });
            })
            .catch(() => {
              /* the next reconnect snapshot remains the recovery path */
            });
        }, 150),
      );
    });
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [signedIn]);

  // A committed sale is announced by the existing shared Realtime channel.
  // The event is only a notification: always fetch the complete canonical
  // transaction graph rather than assembling a sale from a partial payload.
  useEffect(() => {
    if (!signedIn) return;
    let timer: number | undefined;
    const unsubscribe = subscribeSalesChange((change) => {
      const active =
        activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
      if (change.storeId && active && change.storeId !== active) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        // Electron must re-read SQL Server after the main worker pulls; a
        // cloud-only read would hide locally committed receipts still queued
        // for upload. Browser/mobile continue to read their cloud authority.
        const refresh =
          effectiveDatabaseMode() === "online"
            ? active
              ? loadSalesPage(active, null, 500).then(({ rows }) => {
                  setState((current) =>
                    applySalesSnapshot(current, rows, active, pendingSalesRef.current, true),
                  );
                })
              : loadCloudState().then((cloud) => {
                  setState((current) => applyCloud(current, cloud, pendingSalesRef.current));
                })
            : Promise.resolve(localDb()?.sync?.auto?.())
                .catch(() => undefined)
                .then(() => loadLocalSales())
                .then((rows) => {
                  setState((current) =>
                    applySalesSnapshot(current, rows, active, pendingSalesRef.current, true),
                  );
                });
        void refresh.catch(() => {
          /* reconnect/pull remains the eventual-convergence fallback */
        });
      }, 250);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [signedIn]);

  // The Electron main process confirms a transaction only after SQL Server has
  // committed it. Re-read just the local receipt set on that signal so every
  // renderer reflects the sale without a restart or a successful cloud push.
  useEffect(() => {
    if (effectiveDatabaseMode() === "online" || !signedIn) return;
    const bridge = localDb();
    if (!bridge?.onBusinessChanged) return;
    let cancelled = false;
    let loading = false;
    let queued = false;
    const refresh = async () => {
      if (loading) {
        queued = true;
        return;
      }
      loading = true;
      try {
        const rows = await loadLocalSales();
        if (cancelled) return;
        const active =
          activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
        setState((current) =>
          applySalesSnapshot(current, rows, active, pendingSalesRef.current, true),
        );
      } catch {
        /* recordSale's optimistic state remains until the next confirmed read */
      } finally {
        loading = false;
        if (queued && !cancelled) {
          queued = false;
          void refresh();
        }
      }
    };
    const unsubscribe = bridge.onBusinessChanged((change) => {
      if (change.kind === "branch") {
        // First verified login can repair an older activation that stored only
        // the token. Re-run the complete local snapshot now that Main can
        // enforce the correct branch predicate.
        setReloadTick((tick) => tick + 1);
        return;
      }
      const active =
        activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
      if (change.kind !== "sale") return;
      if (change.branchId && active && change.branchId !== active) return;
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [signedIn]);

  // Refresh shared settings after remote edits and reconnects, with polling
  // when Realtime is unavailable. Never overwrite an edit with an older read.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running || settingsWrites.current.pending) return;
      running = true;
      const revision = settingsWrites.current.revision;
      try {
        const settings = await loadCloudSettings();
        if (
          !cancelled &&
          !settingsWrites.current.pending &&
          revision === settingsWrites.current.revision
        )
          setState((current) => ({ ...current, settings: mergeCloudSettings(settings) }));
      } catch {
        /* Keep the last confirmed settings until a later refresh. */
      } finally {
        running = false;
      }
    };
    const wake = () => {
      void refresh();
    };
    const unsubscribe = subscribeSettingsChange((change) => {
      if (
        change.table !== "pos_settings" &&
        change.reason !== "desktop:pull-complete" &&
        change.reason !== "reconnect" &&
        change.reason !== "realtime:subscribed"
      )
        return;
      wake();
    });
    const interval = window.setInterval(wake, 60_000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      unsubscribe();
    };
  }, [signedIn]);

  // Pull sync: embedded tills keep an offline mirror. Realtime applies normal
  // row changes above; this snapshot runs only after reconnection, when socket
  // events may have been missed.
  useEffect(() => {
    if (effectiveDatabaseMode() === "online" || !signedIn) return;
    let cancelled = false;
    const pull = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const bridge = localDb();
      void Promise.resolve(bridge?.sync?.auto?.())
        .catch(() => undefined)
        .then(() => loadPrimaryState())
        .then((cloud) => {
          if (cancelled) return;
          // Read the converged SQL Server snapshot. Local unsynced work stays
          // visible even when the central upload is still being retried.
          setState((s) => applyCloud(s, cloud, pendingSalesRef.current));
        })
        .catch(() => {
          /* offline or refused — the local copy keeps the till trading */
        });
    };
    window.addEventListener("online", pull);
    return () => {
      cancelled = true;
      window.removeEventListener("online", pull);
    };
  }, [signedIn]);

  const activeShift = useMemo(() => {
    const branch = activeBranchId(currentStore.id) ?? currentStore.id;
    if (dbShift && dbShift.storeId === branch && !dbShift.closedAt) return dbShift;
    if (shiftChecked) return null;
    return (
      state.shifts.find((s) => s.storeId === branch && s.status !== "CLOSED" && !s.closedAt) ?? null
    );
  }, [dbShift, shiftChecked, state.shifts, currentStore.id]);

  // Record the exact moment this user joined the open shift. Runs whenever the
  // signed-in account or the open shift changes, and is safe to repeat.
  useEffect(() => {
    const name = user?.name ?? terminalUser?.name;
    if (!activeShift || !name) return;
    const terminal = readTerminalConfig();
    beginShiftSession({
      shiftId: activeShift.id,
      storeId: activeShift.storeId,
      terminalId: activeShift.terminalId ?? terminal?.tokenId ?? localTerminalId(),
      terminalName: activeShift.terminalName ?? terminal?.locationName ?? "This PC",
      staffId: user?.staffId ?? terminalUser?.userCode ?? null,
      staffName: name,
      role: user?.role ?? terminalUser?.role ?? null,
    });
  }, [
    activeShift,
    user?.staffId,
    user?.name,
    user?.role,
    terminalUser?.userCode,
    terminalUser?.name,
    terminalUser?.role,
  ]);

  // Signing in on a shift somebody else already opened is never interrupted by
  // the opening screen — say so once, then get out of the way.
  const announcedShiftRef = useRef<string | null>(null);
  const activeShiftBranchName = activeShift
    ? branchDisplayName(state.stores, activeShift.storeId, "")
    : "";
  const activeShiftAnnouncementBranch = signedIn ? activeShiftBranchName : "";
  useEffect(() => {
    if (!activeShift || !activeShiftAnnouncementBranch) return;
    if (announcedShiftRef.current === activeShift.id) return;
    // The till that just opened the shift already saw its own confirmation.
    if (justOpenedRef.current?.shift.id === activeShift.id) return;
    // Directory data can arrive just after the shift. Wait for it instead of
    // briefly exposing the database identifier in a user-facing message.
    announcedShiftRef.current = activeShift.id;
    toast.success(`Continuing active shift opened at ${activeShiftAnnouncementBranch}`, {
      description: `Opened by ${activeShift.cashier} · float ${money(activeShift.openingFloat)}`,
    });
  }, [activeShift, activeShiftAnnouncementBranch]);

  const setCurrentStore = useCallback(
    (id: string) => setState((s) => ({ ...s, currentStoreId: id })),
    [],
  );

  const upsertStore = useCallback(async (store: Store) => {
    const committed = await db.upsertStore(store);
    setState((s) => ({
      ...s,
      stores: s.stores.some((x) => x.id === store.id)
        ? s.stores.map((x) => (x.id === store.id ? store : x))
        : [...s.stores, store],
      products: s.products.map((p) =>
        p.stockByStore[store.id] === undefined
          ? { ...p, stockByStore: { ...p.stockByStore, [store.id]: 0 } }
          : p,
      ),
    }));
    return committed;
  }, []);

  /**
   * Locations are never hard-deleted: history has to keep resolving them.
   * Archiving is refused while the location still holds stock or still has
   * live sub-locations underneath it.
   */
  const archiveStore = useCallback(
    async (id: string, archived: boolean): Promise<string | null> => {
      const snapshot = stateRef.current;
      const target = snapshot.stores.find((x) => x.id === id);
      if (!target) return "That location no longer exists.";
      if (archived) {
        const blocker = archiveBlockers(snapshot.products, snapshot.stores, id);
        if (blocker) return blocker.reason;
        if (activeLocations(snapshot.stores).length <= 1)
          return "At least one active location must remain.";
      }
      const next: Store = {
        ...target,
        active: !archived,
        archivedAt: archived ? new Date().toISOString() : null,
      };
      await db.upsertStore(next);
      setState((s) => {
        const stores = s.stores.map((x) => (x.id === id ? next : x));
        const stillActive = activeLocations(stores);
        return {
          ...s,
          stores,
          currentStoreId:
            archived && s.currentStoreId === id ? (stillActive[0]?.id ?? "") : s.currentStoreId,
        };
      });
      return null;
    },
    [],
  );

  const forgetDeletedStore = useCallback((id: string) => {
    setState((current) => {
      const stores = current.stores.filter((store) => store.id !== id);
      const fallback = activeLocations(stores)[0]?.id ?? "";
      return {
        ...current,
        stores,
        currentStoreId: current.currentStoreId === id ? fallback : current.currentStoreId,
        products: current.products.map((product) => {
          if (!(id in product.stockByStore)) return product;
          const stockByStore = { ...product.stockByStore };
          delete stockByStore[id];
          return { ...product, stockByStore };
        }),
      };
    });
  }, []);

  const openShift = useCallback(
    async (cashier: string, openingFloat: number) => {
      const terminal = readTerminalConfig();
      // The branch follows the terminal, never the staff record.
      const storeId = requireBranchId(stateRef.current.currentStoreId);
      const shift: Shift = {
        id: crypto.randomUUID(),
        storeId,
        cashier,
        openedAt: new Date().toISOString(),
        closedAt: null,
        openingFloat,
        countedCash: null,
        note: "",
        terminalId: terminal?.tokenId ?? localTerminalId(),
        terminalName: terminal?.locationName ?? "This PC",
        openedByStaffId: user?.staffId ?? terminalUser?.userCode,
        openedByRole: user?.role ?? terminalUser?.role,
        overdue: false,
        status: "OPEN",
        closingFloat: null,
        userId: authUserId ?? null,
      };
      // The central database stores the shift and hands the stored row back in
      // one call, so nothing has to be read again through the access rules.
      const stored = await openShiftOnServer(shift);
      let target: CommitTarget = "cloud";
      if (stored) {
        Object.assign(shift, stored);
      } else {
        // Offline, local SQL or queued: nothing opens until it is stored.
        target = await db.commitShift(shift);
        if (target === "cloud") {
          const seen = await db.shiftExists(shift.id, shift.storeId);
          if (seen === "no") {
            throw new Error(
              "The shift was not found in the database after saving. Nothing was opened — try again, or check this account's branch and role.",
            );
          }
          // "unknown" means the check itself failed — never read that as "no
          // shift". The shift opens, and the failed check is recorded.
          if (seen === "unknown") {
            toast.warning(
              "The shift opened, but it could not be confirmed centrally. Check Data Sync & Audit if it looks wrong.",
            );
          }
        }
      }
      void trackTransition({
        entity: "shift",
        entityId: shift.id,
        from: null,
        to: "OPEN",
        actorName: shift.cashier,
        actorRole: shift.openedByRole ?? null,
        storeId: shift.storeId,
        terminalId: shift.terminalId ?? null,
        metadata: { openingFloat: shift.openingFloat },
      });
      logger.log("sale_event", "Shift opened", "shifts", {
        cashier,
        openingFloat,
        storeId,
        terminal: terminal?.locationName ?? "This PC",
      });
      void recordActivity({
        type: "shift_open",
        title: "Shift opened",
        message: `${cashier} opened a shift with a float of ${openingFloat}.`,
        actorName: cashier,
        actorRole: user?.role ?? terminalUser?.role ?? null,
        terminalId: shift.terminalId ?? null,
        terminalName: shift.terminalName ?? null,
        storeId,
        entityType: "shift",
        entityId: shift.id,
        amount: openingFloat,
      });
      setState((s) => ({ ...s, shifts: [shift, ...s.shifts] }));
      justOpenedRef.current = { shift, at: Date.now() };
      setShiftReadError(null);
      setDbShift(shift);
      setShiftChecked(true);
      // The lock screen keys off the store in view — make sure it is the
      // terminal's branch so the guard clears the instant the shift is stored.
      if (storeId !== stateRef.current.currentStoreId) {
        setState((s) => ({ ...s, currentStoreId: storeId }));
      }
      return target;
    },
    [user, terminalUser, authUserId],
  );

  const closeShift = useCallback(
    async (countedCash: number, note: string, extras: Partial<Shift> = {}) => {
      if (!activeShift) return null;
      // Only the PC that opened the shift may close it — unless a manager or
      // admin is signed in, who can close from anywhere.
      const here = readTerminalConfig()?.tokenId ?? localTerminalId();
      const sameTerminal = !activeShift.terminalId || activeShift.terminalId === here;
      if (!sameTerminal && !can("can_manage_other_shifts")) return null;
      const closed: Shift = {
        ...activeShift,
        ...extras,
        closedAt: new Date().toISOString(),
        countedCash,
        closingFloat: countedCash,
        status: "CLOSED",
        note,
        closedBy: user?.name ?? terminalUser?.name ?? activeShift.cashier,
        closedByStaffId: user?.staffId ?? terminalUser?.userCode,
        closedByRole: user?.role ?? terminalUser?.role,
        overdue: isShiftOverdue(activeShift, defaultTradingHours),
      };
      // Electron's trusted shift-count/approval IPC has already committed the
      // financial close atomically. Rewriting it from the untrusted renderer
      // would both duplicate the operation and reopen a privilege bypass.
      if (!localDb()) await db.commitShift(closed);
      // Everyone who was signed in on this shift is signed out with it.
      endShiftSessions({ shiftId: closed.id });
      setState((s) => ({
        ...s,
        shifts: s.shifts.map((x) => (x.id === closed.id ? closed : x)),
      }));
      justOpenedRef.current = null;
      setDbShift(null);
      setShiftChecked(true);
      const transitionWritten = trackTransition({
        entity: "shift",
        entityId: closed.id,
        from: "OPEN",
        to: "CLOSED",
        reason: note || null,
        actorName: closed.closedBy ?? closed.cashier,
        actorRole: closed.closedByRole ?? null,
        storeId: closed.storeId,
        terminalId: closed.terminalId ?? null,
        metadata: { countedCash, openingFloat: closed.openingFloat, overdue: closed.overdue },
      });
      logger.log("sale_event", "Shift closed", "shifts", {
        shiftId: closed.id,
        storeId: closed.storeId,
        openingFloat: closed.openingFloat,
        countedCash: countedCash,
        note,
        closedBy: closed.closedBy,
        overdue: closed.overdue,
      });
      const activityWritten = recordActivity({
        type: "shift_close",
        severity: closed.overdue ? "warning" : "info",
        title: "Shift closed",
        message: `${closed.closedBy ?? closed.cashier} closed the shift with ${countedCash} counted.`,
        actorName: closed.closedBy ?? closed.cashier,
        actorRole: closed.closedByRole ?? null,
        terminalId: closed.terminalId ?? null,
        terminalName: closed.terminalName ?? null,
        storeId: closed.storeId,
        entityType: "shift",
        entityId: closed.id,
        amount: countedCash,
        meta: { note, overdue: closed.overdue },
      });
      // Do not let Electron exit until the closing records have either reached
      // the server or been parked durably in the terminal database.
      const summaryWritten = (async () => {
        const snapshot = stateRef.current;
        const storeName = branchDisplayName(snapshot.stores, closed.storeId);
        const { buildShiftSummary, dispatchShiftSummary } = await import("./shift-alerts");
        await dispatchShiftSummary(buildShiftSummary(closed, snapshot.sales, storeName)).catch(
          () => null,
        );
      })();
      await Promise.all([transitionWritten, activityWritten, summaryWritten]);
      return closed;
    },
    [activeShift, user, terminalUser, can],
  );

  const recordSale = useCallback(
    async (
      input: Omit<Sale, "id" | "receiptNo" | "createdAt"> & { receiptNo?: string },
      memberSnapshot?: Member | null,
    ) => {
      const snapshot = stateRef.current;
      const counter = snapshot.counter + 1;
      // Never write a bill without a branch — the terminal's branch is authoritative.
      const branchId = requireBranchId(input.storeId || snapshot.currentStoreId);
      input = { ...input, storeId: branchId };
      const store = snapshot.stores.find((x) => x.id === branchId);
      const exchangeSource = input.exchangeOfReceiptNo
        ? snapshot.sales.find(
            (candidate) =>
              candidate.receiptNo === input.exchangeOfReceiptNo && candidate.storeId === branchId,
          )
        : null;
      if (input.exchangeOfReceiptNo && !exchangeSource)
        throw Object.assign(
          new Error("The original exchange bill is no longer available in this branch."),
          { code: "EEXCHANGE_STATE" },
        );
      // Branch + platform + terminal + day + sequence, so two registers can
      // never mint the same bill number, online or off. A number reserved when
      // the ticket started wins, so the header, the held record and the printed
      // bill all agree. The reservation is awaited: if it cannot be stored the
      // sale stops here rather than risking a duplicate bill number.
      const receiptNo =
        input.receiptNo ||
        (await reserveBillNumber(
          store?.receiptPrefix?.trim() || store?.code || "R",
          snapshot.sales.map((s) => s.receiptNo),
          {
            ...(snapshot.settings.integrations.billNumbering ?? {}),
            timeZone: snapshot.settings.integrations.timeZone || undefined,
          },
        ));
      const clientTxnId = input.clientTxnId ?? crypto.randomUUID();
      let sale: Sale = {
        ...input,
        ...(exchangeSource ? { exchangeOfSaleId: exchangeSource.id } : {}),
        // Freeze how this branch reads right now, so a later rename never
        // rewrites a printed bill or a historical report.
        storeName: input.storeName ?? store?.name ?? "",
        storeAddress: input.storeAddress ?? store?.address ?? "",
        // Stamp the cost price of every line at the moment of sale so margin
        // reports stay accurate when prices change later.
        lines: input.lines.map((l) => ({
          ...l,
          cost: l.cost ?? snapshot.products.find((p) => p.id === l.productId)?.cost ?? 0,
        })),
        id: clientTxnId,
        receiptNo,
        clientTxnId,
        createdAt: new Date().toISOString(),
      };

      const touchedProducts = snapshot.products
        .filter((p) => input.lines.some((l) => l.productId === p.id))
        .map((p) => {
          const quantity = input.lines.reduce(
            (total, line) => total + (line.productId === p.id ? line.qty : 0),
            0,
          );
          return bump(
            p,
            input.storeId,
            -quantity,
            snapshot.settings.integrations.autoArchiveZeroStock !== false,
          );
        });
      const member =
        memberSnapshot?.id === input.memberId
          ? memberSnapshot
          : (snapshot.members.find((m) => m.id === input.memberId) ?? null);
      const updatedMember = member
        ? {
            ...member,
            points:
              member.points + input.pointsEarned - (input.method === "points" ? input.paid : 0),
            totalSpend: Number((member.totalSpend + input.total).toFixed(2)),
          }
        : null;
      // The bill is only real once it is stored somewhere.
      //
      // A retried payment keeps the ticket's reserved number, so the database can
      // refuse it as already used. When that happens: if this exact checkout
      // attempt is already stored the sale is simply complete; otherwise a fresh
      // number is minted and the bill goes through, instead of the cashier being
      // stuck on a "duplicate bill" error.
      const endCommitProtection = beginAutoLockOperation();
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await db.commitSale(sale, touchedProducts, updatedMember);
            break;
          } catch (error) {
            if (attempt >= 2 || !isDuplicateBillNumber(error)) throw error;
            if (sale.clientTxnId && (await db.saleAttemptExists(sale.clientTxnId)) === "yes") break;
            const nextNo = await reserveBillNumber(
              store?.receiptPrefix?.trim() || store?.code || "R",
              [...snapshot.sales.map((s) => s.receiptNo), sale.receiptNo],
              {
                ...(snapshot.settings.integrations.billNumbering ?? {}),
                timeZone: snapshot.settings.integrations.timeZone || undefined,
              },
            );
            sale = { ...sale, receiptNo: nextNo };
          }
        }
      } finally {
        endCommitProtection();
      }

      pendingSalesRef.current.add(sale.id);
      setState((s) => {
        const products = s.products.map((p) => {
          const quantity = input.lines.reduce(
            (total, line) => total + (line.productId === p.id ? line.qty : 0),
            0,
          );
          return quantity
            ? bump(
                p,
                input.storeId,
                -quantity,
                s.settings.integrations.autoArchiveZeroStock !== false,
              )
            : p;
        });
        const members = updatedMember
          ? s.members.some((m) => m.id === updatedMember.id)
            ? s.members.map((m) => (m.id === updatedMember.id ? updatedMember : m))
            : [updatedMember, ...s.members]
          : s.members;
        const existingSales = s.sales.filter((existing) => existing.id !== sale.id);
        const tagged = input.exchangeOfReceiptNo
          ? existingSales.map((x) =>
              x.receiptNo === input.exchangeOfReceiptNo
                ? { ...x, exchangedToReceiptNo: sale.receiptNo }
                : x,
            )
          : existingSales;
        return {
          ...s,
          counter: Math.max(counter, s.counter + 1),
          products,
          members,
          sales: [sale, ...tagged],
        };
      });
      try {
        logger.log(
          "sale_event",
          sale.exchangeOfReceiptNo ? "Exchange bill created" : "Bill created",
          "register",
          {
            receiptNo: sale.receiptNo,
            storeId: sale.storeId,
            paymentMethod: sale.method,
            subtotal: sale.subtotal,
            discount: sale.discount,
            tax: sale.tax,
            total: sale.total,
            paid: sale.paid,
            memberId: sale.memberId ?? null,
            pointsEarned: sale.pointsEarned,
            exchangeOfReceiptNo: sale.exchangeOfReceiptNo ?? null,
            cart: sale.lines.map((l) => ({
              productId: l.productId,
              name: l.name,
              qty: l.qty,
              price: l.price,
              discount: l.discount,
              discountType: l.discountType,
              credit: !!l.credit,
            })),
          },
        );
      } catch {
        /* post-commit audit failures never change the sale result */
      }
      try {
        recordActivity({
          type: "sale_complete",
          title: sale.exchangeOfReceiptNo ? "Exchange bill created" : "Sale completed",
          message: `Bill ${sale.receiptNo} for ${sale.total} paid by ${sale.method}.`,
          actorName: sale.cashier ?? null,
          storeId: sale.storeId,
          entityType: "sale",
          entityId: sale.receiptNo,
          amount: sale.total,
          meta: { lines: sale.lines.length, discount: sale.discount },
        });
      } catch {
        /* post-commit activity failures never change the sale result */
      }
      return sale;
    },
    [],
  );

  const createBooking = useCallback(async (input: NewBooking) => {
    const snapshot = stateRef.current;
    const counter = snapshot.bookingCounter + 1;
    const store = snapshot.stores.find((x) => x.id === input.storeId);
    const now = new Date().toISOString();
    const payments: BookingPayment[] = input.deposit
      ? [
          {
            id: crypto.randomUUID(),
            amount: r2(input.deposit),
            method: input.depositMethod,
            at: now,
            cashier: input.cashier,
          },
        ]
      : [];
    const booking: Booking = {
      id: crypto.randomUUID(),
      ref: `BK-${store?.code ?? "R"}-${String(counter).padStart(5, "0")}`,
      storeId: input.storeId,
      shiftId: input.shiftId,
      lines: input.lines,
      serviceTypeId: input.serviceTypeId,
      serviceName: input.serviceName,
      serviceFee: input.serviceFee,
      paymentTiming: input.paymentTiming,
      subtotal: input.subtotal,
      discount: input.discount,
      tax: input.tax,
      total: input.total,
      paid: r2(input.deposit),
      payments,
      dueDate: input.dueDate,
      memberId: input.memberId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      note: input.note,
      cashier: input.cashier,
      createdAt: now,
      status: "active",
      job: input.job,
      tagId: input.tagId,
      intakeNote: input.intakeNote,
      stringOrigin: input.stringOrigin,
      stringProductId: input.stringProductId,
      gripProductId: input.gripProductId,
      charges: input.charges,
      liabilityAccepted: input.liabilityAccepted,
      technician: input.technician,
      jobStatus: input.job ? "received" : undefined,
      jobStatusBy: input.job ? input.cashier : undefined,
      jobStatusAt: input.job ? now : undefined,
    };
    await commitBooking(booking);
    setState((s) => ({
      ...s,
      bookingCounter: Math.max(counter, s.bookingCounter + 1),
      bookings: [booking, ...s.bookings],
    }));
    logger.log("sale_event", "Booking created", "bookings", {
      ref: booking.ref,
      storeId: booking.storeId,
      total: booking.total,
      deposit: booking.paid,
      balance: bookingBalance(booking),
      dueDate: booking.dueDate,
      customer: booking.customerName,
      items: booking.lines.map((l) => ({ name: l.name, qty: l.qty })),
    });
    return booking;
  }, []);

  const addBookingPayment = useCallback(
    async (
      id: string,
      amount: number,
      method: PaymentMethod,
      cashier: string,
      clientPaymentId?: string,
    ) => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current || current.status !== "active" || amount <= 0) return null;
      const payment: BookingPayment = {
        id: crypto.randomUUID(),
        amount: r2(amount),
        method,
        at: new Date().toISOString(),
        cashier,
      };
      // The server records the tender and reports the settled total back; the
      // till never adds money up on its own when the cloud is reachable.
      const server = await collectBookingPayment({
        bookingId: id,
        amount: payment.amount,
        method,
        cashier,
        clientPaymentId: clientPaymentId ?? payment.id,
        complete: false,
      });
      let updated: Booking;
      if (server.ok) {
        updated = {
          ...current,
          paid: server.state.settledPaid,
          payments: server.state.duplicate ? current.payments : [...current.payments, payment],
        };
        setState((s) => ({
          ...s,
          bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
        }));
      } else {
        // Offline: queue the payment exactly as the till always has.
        updated = {
          ...current,
          paid: r2(current.paid + payment.amount),
          payments: [...current.payments, payment],
        };
        await commitBooking(updated);
        setState((s) => ({
          ...s,
          bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
        }));
      }
      logger.log("sale_event", "Booking part payment", "bookings", {
        ref: updated.ref,
        amount: payment.amount,
        method,
        paid: updated.paid,
        balance: bookingBalance(updated),
        authoritative: server.ok,
      });
      return updated;
    },
    [],
  );

  /**
   * Cancelling is a server call: the reason, who did it and when are stored
   * permanently, and an empty reason is refused in the database.
   */
  const cancelBooking = useCallback(
    async (
      id: string,
      reason: string,
      terminal?: string | null,
      moneyAction?: "refunded" | "retained" | null,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return { ok: false, error: "Booking not found." };
      if (current.status !== "active")
        return { ok: false, error: "This booking is already closed." };
      const clean = reason.trim();
      if (clean.length < 3) return { ok: false, error: "A cancellation reason is required." };
      const who = user?.name || current.cashier || "Counter";
      const res = await cancelBookingAuthoritative({
        bookingId: id,
        reason: clean,
        cancelledBy: who,
        terminal: terminal ?? null,
        moneyAction: moneyAction ?? null,
        clientPaymentId: moneyAction === "refunded" ? `cancel-refund-${id}` : null,
      });
      if (!res.ok) return res;
      const held = r2(current.paid);
      const action: Booking["cancelMoneyAction"] = held > 0 ? (moneyAction ?? "retained") : "none";
      const refundLine: BookingPayment[] =
        action === "refunded" && held > 0
          ? [
              {
                id: `cancel-refund-${id}`,
                amount: -held,
                method: "cash",
                at: new Date().toISOString(),
                cashier: who,
                kind: "refund",
                refundReason: `Refunded on cancellation: ${clean}`,
                clientPaymentId: `cancel-refund-${id}`,
              },
            ]
          : [];
      const cancelled: Booking = {
        ...current,
        status: "cancelled",
        closedAt: new Date().toISOString(),
        cancelReason: clean,
        cancelledBy: who,
        cancelledAt: new Date().toISOString(),
        cancelMoneyAction: action,
        paid: action === "refunded" ? 0 : current.paid,
        payments: [...current.payments, ...refundLine],
        ...(terminal ? { cancelledTerminal: terminal } : {}),
      };
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? cancelled : b)),
      }));
      logger.log("sale_event", "Booking cancelled", "bookings", {
        ref: current.ref,
        reason: clean,
        by: who,
        held,
        moneyAction: action,
      });
      trackTransition({
        entity: "booking",
        entityId: id,
        from: current.status,
        to: "cancelled",
        reason: clean,
        actorName: who,
        metadata: { ref: current.ref, held, moneyAction: action },
      });
      return { ok: true };
    },
    [user],
  );

  /** Hand money back on a booking. The server owns the cap and the audit line. */
  const refundBooking = useCallback(
    async (
      id: string,
      amount: number,
      method: PaymentMethod,
      reason: string,
    ): Promise<{ ok: true; booking: Booking } | { ok: false; error: string }> => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return { ok: false, error: "Booking not found." };
      const value = r2(amount);
      if (value <= 0) return { ok: false, error: "Enter a refund amount greater than zero." };
      const clean = reason.trim();
      if (clean.length < 3) return { ok: false, error: "A refund reason is required." };
      const who = user?.name || current.cashier || "Counter";
      const clientPaymentId = crypto.randomUUID();
      const res = await refundBookingPayment({
        bookingId: id,
        amount: value,
        method,
        reason: clean,
        cashier: who,
        clientPaymentId,
      });
      if (!res.ok) return res;
      const line: BookingPayment = {
        id: clientPaymentId,
        amount: -value,
        method,
        at: new Date().toISOString(),
        cashier: who,
        kind: "refund",
        refundReason: clean,
        clientPaymentId,
      };
      const updated: Booking = {
        ...current,
        paid: res.state.settledPaid,
        payments: res.state.duplicate ? current.payments : [...current.payments, line],
      };
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
      }));
      logger.log("sale_event", "Booking refunded", "bookings", {
        ref: current.ref,
        amount: value,
        method,
        reason: clean,
        by: who,
        paid: updated.paid,
      });
      return { ok: true, booking: updated };
    },
    [user],
  );

  /** Remove a booking / job card altogether, with the reason on the record. */
  const deleteBooking = useCallback(async (id: string, reason: string) => {
    const current = stateRef.current.bookings.find((b) => b.id === id);
    if (!current) return;
    setState((s) => ({ ...s, bookings: s.bookings.filter((b) => b.id !== id) }));
    logger.log("sale_event", "Booking deleted", "bookings", {
      ref: current.ref,
      reason,
      status: current.status,
      jobStatus: current.jobStatus ?? "received",
      customer: current.customerName,
      total: current.total,
      paid: current.paid,
    });
    await deleteBookingRow(id).catch(() => undefined);
  }, []);

  /**
   * Move a racket through received → strung → ready → collected. Handing one
   * over is only allowed once the server agrees nothing is owed.
   */
  const setBookingJobStatus = useCallback(
    async (id: string, status: JobStatus, who: string, incidentNote?: string) => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return null;
      if (status === "collected") {
        const check = await readBookingBalance(id);
        if (!check.ok) {
          toast.error("Payment could not be verified", { description: check.error });
          return null;
        }
        if (!check.state.fullyPaid) {
          toast.error("A balance is still outstanding", {
            description: `${money(check.state.outstanding)} must be collected first.`,
          });
          return null;
        }
      }
      const updated: Booking = {
        ...current,
        jobStatus: status,
        jobStatusBy: who,
        jobStatusAt: new Date().toISOString(),
        ...(incidentNote ? { incidentNote } : {}),
      };
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
      }));
      saveBookingQuietly(updated);
      logger.log("sale_event", "Job card status changed", "bookings", {
        ref: updated.ref,
        status,
        by: who,
        customer: updated.customerName,
        ...(incidentNote ? { incident: incidentNote } : {}),
      });
      trackTransition({
        entity: "job_card",
        entityId: id,
        kind: "job_status",
        from: current.jobStatus ?? "received",
        to: status,
        reason: incidentNote ?? null,
        actorName: who,
        metadata: { ref: updated.ref, customer: updated.customerName },
      });
      return updated;
    },
    [],
  );

  /** Rewrite the job card of a booking that has not been collected yet. */
  const updateBookingSpecs = useCallback((id: string, job: RacketJob) => {
    const current = stateRef.current.bookings.find((b) => b.id === id);
    if (!current) return null;
    const updated: Booking = { ...current, job: { ...current.job, ...job } };
    setState((s) => ({ ...s, bookings: s.bookings.map((b) => (b.id === id ? updated : b)) }));
    saveBookingQuietly(updated);
    logger.log("sale_event", "Job card specs edited", "bookings", {
      ref: updated.ref,
      racket: updated.job?.racketModel,
      string: updated.job?.stringType,
    });
    return updated;
  }, []);

  /**
   * Hand a booking over. The server checks the outstanding amount, takes the
   * final tender and closes the booking in one go; only then is a sale
   * receipt written, so a booking can never be collected unpaid.
   */
  const collectBooking = useCallback(
    async (id: string, amount: number, method: PaymentMethod, clientPaymentId?: string) => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current || current.status !== "active") return null;

      const check = await readBookingBalance(id);
      if (!check.ok) {
        toast.error("Payment could not be verified", { description: check.error });
        return null;
      }
      const outstanding = check.state.outstanding;
      const settled = r2(Math.min(Math.max(amount, 0), outstanding));
      if (outstanding > 0 && settled < outstanding) {
        toast.error("A balance is still outstanding", {
          description: `${money(outstanding)} must be collected before handover.`,
        });
        return null;
      }

      const server = await collectBookingPayment({
        bookingId: id,
        amount: settled,
        method,
        cashier: current.cashier,
        clientPaymentId: clientPaymentId ?? crypto.randomUUID(),
        complete: true,
      });
      if (!server.ok) {
        toast.error("Collection refused", { description: server.error });
        return null;
      }

      const sale = await recordSale({
        storeId: current.storeId,
        shiftId: activeShift?.id ?? current.shiftId,
        lines: current.lines,
        subtotal: current.subtotal,
        discount: current.discount,
        tax: current.tax,
        total: current.total,
        paid: current.total,
        change: r2(Math.max(0, amount - outstanding)),
        method,
        memberId: current.memberId,
        pointsEarned: 0,
        cashier: current.cashier,
        bookingRef: current.ref,
      });
      const finalPayment: BookingPayment = {
        id: clientPaymentId ?? crypto.randomUUID(),
        amount: settled,
        method,
        at: new Date().toISOString(),
        cashier: current.cashier,
      };
      const updated: Booking = {
        ...current,
        paid: server.state.settledPaid,
        payments:
          settled && !server.state.duplicate
            ? [...current.payments, finalPayment]
            : current.payments,
        status: "collected",
        closedAt: new Date().toISOString(),
        saleReceiptNo: sale.receiptNo,
        jobStatus: current.job ? "collected" : current.jobStatus,
        jobStatusAt: current.job ? new Date().toISOString() : current.jobStatusAt,
      };
      saveBookingQuietly(updated);
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
      }));
      logger.log("sale_event", "Booking collected", "bookings", {
        ref: updated.ref,
        receiptNo: sale.receiptNo,
        settled,
        total: updated.total,
      });
      trackTransition({
        entity: "booking",
        entityId: id,
        from: current.status,
        to: "collected",
        actorName: current.cashier,
        relatedEntity: "sale",
        relatedEntityId: sale.id ?? sale.receiptNo,
        metadata: { ref: updated.ref, receiptNo: sale.receiptNo, settled, total: updated.total },
      });
      if (current.job && (current.jobStatus ?? "received") !== "collected") {
        trackTransition({
          entity: "job_card",
          entityId: id,
          kind: "job_status",
          from: current.jobStatus ?? "received",
          to: "collected",
          actorName: current.cashier,
          metadata: { ref: updated.ref, receiptNo: sale.receiptNo },
        });
      }
      return { booking: updated, sale };
    },
    [activeShift, recordSale],
  );

  const refundSale = useCallback(
    async (
      saleId: string,
      grantToken?: string | null,
      loadedSale?: Sale,
    ): Promise<boolean> => {
      const sale = stateRef.current.sales.find((x) => x.id === saleId) ?? loadedSale;
      if (!sale || sale.refunded) return false;
      const payload = {
        sale_id: sale.id,
        receipt_no: sale.receiptNo,
        total: Math.abs(sale.total),
      };
      const [{ verifyBusinessAuthorization }, { getPosCallerAuth }] = await Promise.all([
        import("./authorization-client"),
        import("./pos-caller-auth"),
      ]);
      const authorization = await verifyBusinessAuthorization({
        data: {
          ...(await getPosCallerAuth()),
          actionKey: "refund",
          storeId: sale.storeId,
          payload,
          requestedAmount: Math.abs(sale.total),
          grantToken: grantToken ?? null,
        },
      });
      if (!authorization.ok) throw new Error(authorization.error);
      // The stable refund id makes a retry idempotent. Nothing visible changes
      // until the authoritative gateway has accepted the refund.
      await db.refundSale(saleId, `refund:${saleId}`);
      logger.log("sale_event", "Sale refunded", "receipts", {
        saleId,
        receiptNo: sale.receiptNo,
      });
      recordActivity({
        type: "sale_refund",
        severity: "critical",
        title: "Refund issued",
        message: `Bill ${sale.receiptNo} was refunded.`,
        storeId: sale.storeId ?? null,
        entityType: "sale",
        entityId: sale.receiptNo,
        amount: sale.total,
      });
      setState((s) => {
        const existingSale = s.sales.find((x) => x.id === saleId);
        const sale = existingSale ?? loadedSale;
        if (!sale || sale.refunded) return s;
        const products = s.products.map((p) => {
          const quantity = sale.lines.reduce(
            (total, line) => total + (line.productId === p.id ? line.qty : 0),
            0,
          );
          return quantity
            ? bump(
                p,
                sale.storeId,
                quantity,
                s.settings.integrations.autoArchiveZeroStock !== false,
              )
            : p;
        });
        return {
          ...s,
          products,
          sales: existingSale
            ? s.sales.map((x) => (x.id === saleId ? { ...x, refunded: true } : x))
            : [{ ...sale, refunded: true }, ...s.sales],
        };
      });
      return true;
    },
    [],
  );

  /** Correct the tender recorded on a completed bill (e.g. rung up as card). */
  const changeSalePayment = useCallback(
    async (saleId: string, method: PaymentMethod, reason?: string): Promise<boolean> => {
      const sale = stateRef.current.sales.find((x) => x.id === saleId);
      if (!sale || sale.method === method) return false;
      await db.updateSalePayment(saleId, method);
      logger.log("sale_event", "Bill payment method corrected", "receipts", {
        saleId,
        receiptNo: sale.receiptNo,
        from: sale.method,
        to: method,
        reason: reason ?? null,
      });
      setState((s) => ({
        ...s,
        sales: s.sales.map((x) => (x.id === saleId ? { ...x, method } : x)),
      }));
      return true;
    },
    [],
  );

  const upsertProduct = useCallback(async (product: Product): Promise<CommitTarget> => {
    const prev = stateRef.current.products.find((p) => p.id === product.id);
    // The catalog is shared by every branch: make sure the product exists at
    // all stores (starting at zero) so it shows up everywhere after sync.
    const stockByStore = { ...product.stockByStore };
    for (const store of stateRef.current.stores) {
      if (stockByStore[store.id] === undefined) stockByStore[store.id] = 0;
    }
    const record = applyZeroStockLifecycle(
      { ...product, stockByStore },
      stateRef.current.settings.integrations.autoArchiveZeroStock !== false,
    );
    logger.log("inventory_edit", prev ? "Product updated" : "Product created", "inventory", {
      productId: record.id,
      name: record.name,
      barcode: record.barcode,
      previous: prev
        ? { name: prev.name, price: prev.price, cost: prev.cost, ecomPrice: prev.ecomPrice }
        : null,
      updated: {
        name: record.name,
        price: record.price,
        cost: record.cost,
        ecomPrice: record.ecomPrice,
      },
    });
    // A branch that keeps a private catalogue owns whatever it creates, so
    // the item never shows up at the other shops. The owner travels with the
    // record itself, which is what the central database enforces on.
    const ownsNewItems =
      !prev &&
      branchPolicy(stateRef.current.settings, stateRef.current.currentStoreId).privateCatalogue;
    const stored: Product = ownsNewItems
      ? { ...record, ownerStoreId: stateRef.current.currentStoreId }
      : record;
    // Store it before anything on screen says it was saved.
    const target = await db.commitProduct(stored);
    if (ownsNewItems) {
      const owners = {
        ...(stateRef.current.settings.integrations.productOwners ?? {}),
        [record.id]: stateRef.current.currentStoreId,
      };
      updateSettingsRef.current?.({
        integrations: { ...stateRef.current.settings.integrations, productOwners: owners },
      });
    }
    setState((s) => ({
      ...s,
      products: s.products.some((p) => p.id === stored.id)
        ? s.products.map((p) => (p.id === stored.id ? stored : p))
        : [stored, ...s.products],
    }));
    return target;
  }, []);

  const upsertProductPriceOverride = useCallback(
    async (productId: string, price: number, ecomPrice?: number): Promise<CommitTarget> => {
      const branchId = stateRef.current.currentStoreId;
      if (!branchId) throw new Error("Choose a branch before saving a branch price.");
      const current = stateRef.current.products.find((product) => product.id === productId);
      if (!current) throw new Error("That product is no longer available.");
      const target = await db.commitProductPriceOverride(
        productId,
        branchId,
        price,
        ecomPrice,
        user?.staffId ?? null,
      );
      logger.log("inventory_edit", "Branch price override saved", "inventory", {
        productId,
        branchId,
        previous: { price: current.price, ecomPrice: current.ecomPrice },
        updated: { price, ecomPrice },
      });
      setState((snapshot) => ({
        ...snapshot,
        products: snapshot.products.map((product) =>
          product.id === productId ? { ...product, price, ecomPrice } : product,
        ),
      }));
      return target;
    },
    [user?.staffId],
  );

  /**
   * Saves a whole spreadsheet of products in batches.
   *
   * A large import used to save one item at a time, which meant thousands of
   * separate database round trips, audit entries and screen updates back to
   * back — enough to make the till unusable and to leave the job half done. It
   * now goes out in groups: the same branch-ownership, catalogue and audit
   * rules apply, they are simply applied to a group instead of to a single row.
   *
   * Each group is reported back as soon as it is genuinely stored, so an
   * interrupted import knows exactly where it got to.
   */
  const importProducts = useCallback(
    async (
      rows: ImportRow[],
      options: ImportProductsOptions = {},
    ): Promise<ImportProductsResult> => {
      const size = options.batchSize ?? DEFAULT_BATCH_SIZE;
      const storeId = stateRef.current.currentStoreId;
      const skipKeys = new Set(options.alreadyDone ?? []);
      const todo = rows.filter((r) => !skipKeys.has(r.key));

      const result: ImportProductsResult = {
        created: 0,
        restocked: 0,
        failed: [],
        pending: [],
        savedKeys: [],
        savedProducts: [],
      };
      if (!todo.length) return result;
      const importId = options.importId ?? crypto.randomUUID();

      const privateCatalogue = branchPolicy(stateRef.current.settings, storeId).privateCatalogue;
      const zeroStockLifecycle =
        stateRef.current.settings.integrations.autoArchiveZeroStock !== false;
      const autoSku = readSkuSettings().mode === "auto";
      // One running list of codes, so the auto numbering never has to re-scan
      // the catalogue per row.
      const skuPool = stateRef.current.products.map((p) => p.sku);
      const storeIds = stateRef.current.stores.map((s) => s.id);

      // Index the catalogue once for the whole import.
      const byCode = new Map<string, Product>();
      for (const p of stateRef.current.products) {
        for (const code of productCodes(p)) if (!byCode.has(code)) byCode.set(code, p);
      }

      const newOwners: Record<string, string> = {};
      let done = 0;
      let halted = false;

      for (const group of batches(todo, size)) {
        const entries: Array<{ row: ImportRow; record: Product; existing: boolean }> = [];

        for (const row of group) {
          const hit = byCode.get(row.key) ?? row.existingProduct;
          if (hit) {
            const record: Product = {
              ...hit,
              ...(row.updateExisting
                ? {
                    name: row.name,
                    price: row.price,
                    cost: row.cost,
                    category: row.category,
                    unit: row.unit || hit.unit,
                    ecomPrice: hit.ecomPrice || row.price,
                    ...(row.taxRate === undefined ? {} : { taxRate: row.taxRate }),
                  }
                : {}),
              stockByStore: {
                ...hit.stockByStore,
                [storeId]:
                  (hit.stockByStore?.[storeId] ?? 0) +
                  (options.applyStock === false ? 0 : row.stock),
              },
              customPoints: row.customPoints ?? hit.customPoints,
            };
            for (const id of storeIds) {
              if (record.stockByStore[id] === undefined) record.stockByStore[id] = 0;
            }
            entries.push({
              row,
              record: applyZeroStockLifecycle(record, zeroStockLifecycle),
              existing: true,
            });
          } else {
            let sku: string;
            try {
              sku = autoSku
                ? await nextSku(skuPool, { storeId, terminalId: localTerminalId() })
                : row.barcode;
            } catch (error) {
              result.failed.push({
                line: row.line,
                barcode: row.barcode,
                name: row.name,
                reason: error instanceof Error ? error.message : "Could not allocate an SKU",
              });
              done += 1;
              options.onProgress?.(done, todo.length);
              continue;
            }
            skuPool.push(sku);
            const record: Product = {
              id: crypto.randomUUID(),
              name: row.name,
              sku,
              barcode: row.barcode,
              category: row.category,
              unit: row.unit,
              price: row.price,
              cost: row.cost,
              ecomPrice: row.price,
              ecomVisible: false,
              stockByStore: Object.fromEntries(
                storeIds.map((id) => [
                  id,
                  id === storeId && options.applyStock !== false ? row.stock : 0,
                ]),
              ),
              reorderLevel: 10,
              taxRate:
                row.taxRate ??
                (stateRef.current.settings.tax.enabled
                  ? stateRef.current.settings.tax.rate / 100
                  : 0),
              customPoints: row.customPoints,
              ...(privateCatalogue ? { ownerStoreId: storeId } : {}),
            };
            entries.push({
              row,
              record: applyZeroStockLifecycle(record, zeroStockLifecycle),
              existing: false,
            });
          }
        }

        const persist = async (
          slice: Array<{ row: ImportRow; record: Product; existing: boolean }>,
        ): Promise<void> =>
          persistBatchWithIsolation(
            slice,
            async (part) => {
              const movements =
                options.applyStock === false
                  ? []
                  : part.flatMap((entry) => {
                      const delta = Math.round(entry.row.stock);
                      if (!delta) return [];
                      const after = Math.round(entry.record.stockByStore?.[storeId] ?? delta);
                      return [
                        {
                          id: stableChildId(importId, "6", entry.row.line),
                          productId: entry.record.id,
                          productName: entry.record.name,
                          sku: entry.record.sku,
                          barcode: entry.record.barcode,
                          storeId,
                          terminalId: localTerminalId(),
                          quantityDelta: delta,
                          stockBefore: after - delta,
                          stockAfter: after,
                          unitCost: entry.record.cost,
                          staffId: actorStaffIdRef.current,
                          staffName: actorRef.current,
                          role: actorRoleRef.current,
                          reference: `Bulk import ${importId}`,
                        },
                      ];
                    });
              const target = await db.commitProducts(
                part.map((entry) => entry.record),
                movements,
              );
              if (target === "offline") {
                throw Object.assign(
                  new Error(
                    "Connection lost while saving this batch. It is queued safely and will be verified before the import is marked complete.",
                  ),
                  { code: "NETWORK" },
                );
              }
            },
            async (saved) => {
              const records = saved.map((entry) => entry.record);
              const keys = saved.map((entry) => entry.row.key);
              const created = saved.filter((entry) => !entry.existing).length;
              const restocked = saved.length - created;
              result.created += created;
              result.restocked += restocked;
              result.savedKeys.push(...keys);
              result.savedProducts.push(...records);
              for (const entry of saved) {
                byCode.set(entry.row.key, entry.record);
                if (privateCatalogue && !entry.existing) newOwners[entry.record.id] = storeId;
              }

              logger.log("inventory_edit", "Products imported", "inventory", {
                importId,
                storeId,
                created,
                restocked,
                lines: `${saved[0]?.row.line}-${saved[saved.length - 1]?.row.line}`,
                names: saved.slice(0, 5).map((entry) => entry.row.name),
              });

              const merged = new Map(records.map((product) => [product.id, product]));
              setState((state) => {
                const next = state.products.map((product) => merged.get(product.id) ?? product);
                const known = new Set(state.products.map((product) => product.id));
                const fresh = records.filter((product) => !known.has(product.id));
                return { ...state, products: fresh.length ? [...fresh, ...next] : next };
              });

              done += saved.length;
              options.onProgress?.(done, todo.length);
              options.onBatchSaved?.(keys, {
                created: result.created,
                restocked: result.restocked,
              });
            },
            async (failed, error) => {
              const reason = importFailureReason(error);
              for (const entry of failed) {
                result.failed.push({
                  line: entry.row.line,
                  barcode: entry.row.barcode,
                  name: entry.row.name,
                  reason,
                });
              }
              done += failed.length;
              options.onProgress?.(done, todo.length);
              if (options.stopOnBatchFailure || isSystemicImportFailure(error)) halted = true;
            },
            !options.stopOnBatchFailure,
          );

        await persist(entries);
        if (halted) {
          for (const row of todo.slice(done)) {
            result.pending.push({
              line: row.line,
              barcode: row.barcode,
              name: row.name,
              reason: "Not attempted — the import stopped after a failed batch",
            });
          }
          break;
        }
        // Hand the screen back between batches so the window stays alive.
        await new Promise((r) => setTimeout(r, 0));
      }

      if (Object.keys(newOwners).length) {
        updateSettingsRef.current?.({
          integrations: {
            ...stateRef.current.settings.integrations,
            productOwners: {
              ...(stateRef.current.settings.integrations.productOwners ?? {}),
              ...newOwners,
            },
          },
        });
      }

      return result;
    },
    [],
  );

  /**
   * Deletes products that the database will actually let go of.
   *
   * Anything still referenced by past bills or paperwork is kept on screen and
   * returned with the reason, so the caller can explain it to the user.
   */
  const deleteProductIds = useCallback(async (ids: string[], bulk: boolean) => {
    const removed: string[] = [];
    const blocked: BlockedDelete[] = [];
    for (const id of ids) {
      const product = stateRef.current.products.find((p) => p.id === id);
      try {
        await db.deleteProductNow(id);
        removed.push(id);
        logger.log("inventory_edit", "Product deleted", "inventory", {
          productId: id,
          name: product?.name ?? null,
          barcode: product?.barcode ?? null,
          ...(bulk ? { bulk: true } : {}),
        });
      } catch (e) {
        const message = (e as { message?: string })?.message ?? String(e);
        blocked.push({
          id,
          name: product?.name ?? "This product",
          reason: describeDeleteBlock(message),
        });
      }
    }
    if (removed.length) {
      const gone = new Set(removed);
      setState((s) => ({ ...s, products: s.products.filter((p) => !gone.has(p.id)) }));
    }
    return blocked;
  }, []);

  const removeProduct = useCallback(
    (id: string) => deleteProductIds([id], false),
    [deleteProductIds],
  );

  /** Bulk delete from the inventory selection — one trail entry per item. */
  const removeProducts = useCallback(
    (ids: string[]) => deleteProductIds(ids, true),
    [deleteProductIds],
  );

  /** Bulk field edit (category, tax, web visibility…) across a selection. */
  const patchProducts = useCallback(async (ids: string[], patch: Partial<Product>) => {
    const set = new Set(ids);
    const zeroStockLifecycle =
      stateRef.current.settings.integrations.autoArchiveZeroStock !== false;
    const explicitArchiveState = patch.archived !== undefined;
    const updated = stateRef.current.products
      .filter((p) => set.has(p.id))
      .map((p) =>
        explicitArchiveState
          ? { ...p, ...patch }
          : applyZeroStockLifecycle({ ...p, ...patch }, zeroStockLifecycle),
      );
    logger.log("inventory_edit", "Products bulk edited", "inventory", {
      count: updated.length,
      changes: patch,
      names: updated.slice(0, 10).map((p) => p.name),
    });
    const target = await db.commitProducts(updated);
    setState((s) => ({
      ...s,
      products: s.products.map((p) =>
        set.has(p.id)
          ? explicitArchiveState
            ? { ...p, ...patch }
            : applyZeroStockLifecycle(
                { ...p, ...patch },
                s.settings.integrations.autoArchiveZeroStock !== false,
              )
          : p,
      ),
    }));
    return target;
  }, []);

  /**
   * Takes items off the till and the web catalogue without touching a single
   * record that points at them, so receipts and reports stay exactly as they
   * were rung up.
   */
  const archiveProducts = useCallback(
    (ids: string[]) => patchProducts(ids, { archived: true, ecomVisible: false }),
    [patchProducts],
  );

  /** Brings an archived item back into the catalogue. */
  const restoreProducts = useCallback(
    (ids: string[]) => patchProducts(ids, { archived: false }),
    [patchProducts],
  );

  /**
   * Folds duplicate product records into one master: branch stock is added
   * together and every losing barcode/SKU becomes an alias on the master, so
   * scanning the old code still finds the item.
   */
  const mergeProducts = useCallback(
    async (masterId: string, duplicateIds: string[]): Promise<BlockedDelete[]> => {
      const all = stateRef.current.products;
      const master = all.find((p) => p.id === masterId);
      if (!master) return [];
      const losers = all.filter((p) => duplicateIds.includes(p.id) && p.id !== masterId);
      if (!losers.length) return [];

      const stockByStore = { ...master.stockByStore };
      const aliases = new Set([...(master.barcodes ?? [])]);
      for (const loser of losers) {
        for (const [storeId, qty] of Object.entries(loser.stockByStore ?? {})) {
          stockByStore[storeId] = (stockByStore[storeId] ?? 0) + (qty || 0);
        }
        for (const code of [loser.barcode, loser.sku, ...(loser.barcodes ?? [])]) {
          if (code && code !== master.barcode && code !== master.sku) aliases.add(code);
        }
      }
      const merged: Product = { ...master, stockByStore, barcodes: [...aliases] };

      logger.log("inventory_edit", "Products merged", "inventory", {
        masterId,
        masterName: master.name,
        merged: losers.map((l) => ({ id: l.id, name: l.name, barcode: l.barcode })),
        aliasBarcodes: merged.barcodes,
      });

      await db.commitProduct(merged);
      setState((s) => ({
        ...s,
        products: s.products.map((p) => (p.id === masterId ? merged : p)),
      }));
      return deleteProductIds(
        losers.map((l) => l.id),
        true,
      );
    },
    [deleteProductIds],
  );

  const adjustStock = useCallback(async (id: string, delta: number, storeId?: string) => {
    const target = storeId ?? stateRef.current.currentStoreId;
    const before = stateRef.current.products.find((p) => p.id === id);
    logger.log("inventory_edit", "Stock adjusted", "inventory", {
      productId: id,
      name: before?.name ?? null,
      storeId: target,
      delta,
      previousStock: before ? stockAt(before, target) : null,
      updatedStock: before ? stockAt(before, target) + delta : null,
    });
    if (!before) return null;
    const updated = bump(
      before,
      target,
      delta,
      stateRef.current.settings.integrations.autoArchiveZeroStock !== false,
    );
    const committed = await db.commitStockAdjustments(
      [updated],
      [
        {
          productId: before.id,
          productName: before.name,
          sku: before.sku ?? null,
          storeId: target,
          reason: "manual",
          previousStock: stockAt(before, target),
          updatedStock: stockAt(before, target) + delta,
          delta,
          costImpact: r2(delta * (before.cost ?? 0)),
        },
      ],
    );
    setState((s) => ({
      ...s,
      products: s.products.map((p) =>
        p.id === id
          ? bump(
              p,
              storeId ?? s.currentStoreId,
              delta,
              s.settings.integrations.autoArchiveZeroStock !== false,
            )
          : p,
      ),
    }));
    return committed;
  }, []);

  /** Move stock between two branch buckets with both audit legs in one batch. */
  const moveStock = useCallback(
    async (id: string, qty: number, fromStoreId: string, toStoreId: string) => {
      const before = stateRef.current.products.find((p) => p.id === id);
      const amount = Math.max(0, Math.round(qty));
      if (!before || !amount || fromStoreId === toStoreId) return null;
      const fromBefore = stockAt(before, fromStoreId);
      const toBefore = stockAt(before, toStoreId);
      const updated = {
        ...before,
        stockByStore: {
          ...before.stockByStore,
          [fromStoreId]: fromBefore - amount,
          [toStoreId]: toBefore + amount,
        },
      };
      const common = {
        productId: before.id,
        productName: before.name,
        sku: before.sku ?? null,
        reason: "transfer",
        costImpact: r2(amount * (before.cost ?? 0)),
      };
      const committed = await db.commitStockAdjustments(
        [updated],
        [
          {
            ...common,
            storeId: fromStoreId,
            previousStock: fromBefore,
            updatedStock: fromBefore - amount,
            delta: -amount,
          },
          {
            ...common,
            storeId: toStoreId,
            previousStock: toBefore,
            updatedStock: toBefore + amount,
            delta: amount,
          },
        ],
      );
      setState((s) => ({ ...s, products: s.products.map((p) => (p.id === id ? updated : p)) }));
      return committed;
    },
    [],
  );

  /**
   * Pull the authoritative quantities back from the database for a handful of
   * products. Called right after receiving stock so the grid and the register
   * show the same number the backend holds, never a stale cached one.
   */
  const syncProducts = useCallback(async (ids: string[]) => {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (!wanted.length) return;
    try {
      const { loadProductsByIds } = await import("@/core/api/pos-db");
      const current = stateRef.current;
      const branchId = current.currentStoreId;
      const clusterId = current.stores.find((store) => store.id === branchId)?.groupId;
      const fresh = await loadProductsByIds(wanted, { branchId, clusterId });
      if (!fresh.length) return;
      const byId = new Map(fresh.map((p) => [p.id, p]));
      setState((s) => ({
        ...s,
        products: s.products.map((p) => byId.get(p.id) ?? p),
      }));
    } catch {
      /* offline — the local figures stay as they are and sync later */
    }
  }, []);

  /**
   * Commits a physical stock count / adjustment: absolute counted quantities
   * replace the system figure and every variance is written to the trail with
   * a reason, so calibration differences can be audited later.
   */
  const applyStockCount = useCallback(
    (
      entries: { productId: string; counted: number }[],
      reason: StockAdjustmentReason,
      note = "",
      storeId?: string,
      draftId?: string | null,
      postedBy?: string | null,
    ): Promise<CommitTarget | null> => {
      const target = storeId ?? stateRef.current.currentStoreId;
      const changes = entries
        .map((e) => {
          const product = stateRef.current.products.find((p) => p.id === e.productId);
          if (!product) return null;
          const before = stockAt(product, target);
          const counted = Math.max(0, Math.round(e.counted));
          if (counted === before) return null;
          return { product, before, counted, delta: counted - before };
        })
        .filter(Boolean) as {
        product: Product;
        before: number;
        counted: number;
        delta: number;
      }[];
      if (!changes.length) return Promise.resolve(null);

      for (const c of changes) {
        logger.log("inventory", "Stock adjusted", "inventory", {
          productId: c.product.id,
          name: c.product.name,
          sku: c.product.sku,
          storeId: target,
          reason,
          note,
          previousStock: c.before,
          updatedStock: c.counted,
          delta: c.delta,
          costImpact: r2(c.delta * (c.product.cost ?? 0)),
        });
      }
      const products = changes.map((c) => ({
        ...c.product,
        stockByStore: { ...c.product.stockByStore, [target]: c.counted },
      }));
      const adjustments = changes.map((c) => ({
        productId: c.product.id,
        productName: c.product.name,
        sku: c.product.sku ?? null,
        storeId: target,
        reason,
        note,
        previousStock: c.before,
        updatedStock: c.counted,
        delta: c.delta,
        costImpact: r2(c.delta * (c.product.cost ?? 0)),
        draftId: draftId ?? null,
      }));
      return db
        .commitStockAdjustments(
          products,
          adjustments,
          draftId ? { id: draftId, by: postedBy } : undefined,
        )
        .then((committed) => {
          const byId = new Map(changes.map((c) => [c.product.id, c.counted]));
          setState((s) => ({
            ...s,
            products: s.products.map((p) =>
              byId.has(p.id)
                ? { ...p, stockByStore: { ...p.stockByStore, [target]: byId.get(p.id)! } }
                : p,
            ),
          }));
          return committed;
        });
    },
    [],
  );

  const upsertMember = useCallback(async (member: Member): Promise<CommitTarget> => {
    const prev = stateRef.current.members.find((m) => m.id === member.id);
    logger.log("member_event", prev ? "Member profile edited" : "Member created", "members", {
      memberId: member.id,
      name: member.name,
      phone: member.phone,
      previous: prev ? { points: prev.points, tier: prev.tier, phone: prev.phone } : null,
      updated: { points: member.points, tier: member.tier, phone: member.phone },
      pointsDelta: prev ? member.points - prev.points : member.points,
    });
    const target = await db.commitMember(member);
    setState((s) => ({
      ...s,
      members: s.members.some((m) => m.id === member.id)
        ? s.members.map((m) => (m.id === member.id ? member : m))
        : [member, ...s.members],
    }));
    return target;
  }, []);

  const removeMember = useCallback(async (id: string) => {
    const member = stateRef.current.members.find((m) => m.id === id);
    logger.log("member_event", "Member deleted", "members", {
      memberId: id,
      name: member?.name ?? null,
      phone: member?.phone ?? null,
    });
    await db.deleteMember(id);
    setState((s) => ({ ...s, members: s.members.filter((m) => m.id !== id) }));
  }, []);

  const upsertPromotion = useCallback(async (promotion: Promotion): Promise<CommitTarget> => {
    const previous = stateRef.current.promotions.find((p) => p.id === promotion.id);
    logger.log("promotion", previous ? "Promotion updated" : "Promotion created", "promotions", {
      promotionId: promotion.id,
      name: promotion.name,
      active: promotion.active,
    });
    const target = await db.commitPromotion(promotion);
    setState((s) => ({
      ...s,
      promotions: s.promotions.some((p) => p.id === promotion.id)
        ? s.promotions.map((p) => (p.id === promotion.id ? promotion : p))
        : [promotion, ...s.promotions],
    }));
    return target;
  }, []);

  const removePromotion = useCallback(async (id: string) => {
    const promotion = stateRef.current.promotions.find((p) => p.id === id);
    logger.log("promotion", "Promotion deleted", "promotions", {
      promotionId: id,
      name: promotion?.name ?? null,
    });
    await db.deletePromotion(id);
    setState((s) => ({ ...s, promotions: s.promotions.filter((p) => p.id !== id) }));
  }, []);

  const togglePromotion = useCallback(async (id: string, active: boolean) => {
    {
      const p = stateRef.current.promotions.find((x) => x.id === id);
      if (p) {
        logger.log("promotion", active ? "Promotion enabled" : "Promotion disabled", "promotions", {
          promotionId: id,
          name: p.name,
        });
        await db.upsertPromotion({ ...p, active });
      }
    }
    setState((s) => ({
      ...s,
      promotions: s.promotions.map((p) => (p.id === id ? { ...p, active } : p)),
    }));
  }, []);

  const writeGlobalSettings = useCallback((patch: Partial<AppSettings>) => {
    {
      const prev = stateRef.current.settings;
      trackSettingsWrite("GLOBAL", () =>
        db
          .saveSettingsNow({
            tax: { ...prev.tax, ...(patch.tax ?? {}) },
            receipt: { ...prev.receipt, ...(patch.receipt ?? {}) },
            payment: { ...prev.payment, ...(patch.payment ?? {}) },
            whatsapp: { ...prev.whatsapp, ...(patch.whatsapp ?? {}) },
            integrations: { ...prev.integrations, ...(patch.integrations ?? {}) },
            visibility: { ...prev.visibility, ...(patch.visibility ?? {}) },
          }, patch)
          .catch((error) => {
            dbError("Saving display settings", error);
            throw error;
          }),
      );
    }
    setState((s) => {
      const settings = {
        tax: { ...s.settings.tax, ...(patch.tax ?? {}) },
        receipt: { ...s.settings.receipt, ...(patch.receipt ?? {}) },
        payment: { ...s.settings.payment, ...(patch.payment ?? {}) },
        whatsapp: { ...s.settings.whatsapp, ...(patch.whatsapp ?? {}) },
        integrations: { ...s.settings.integrations, ...(patch.integrations ?? {}) },
        visibility: { ...s.settings.visibility, ...(patch.visibility ?? {}) },
      };
      return {
        ...s,
        settings,
        products: applyZeroStockLifecycleToProducts(
          s.products,
          settings.integrations.autoArchiveZeroStock !== false,
        ),
      };
    });
  }, []);

  /**
   * Route each leaf to the strongest valid organizational tier that owns its
   * block. Locked blocks always fall back to global.
   */
  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      if (confirmedScopeKey !== JSON.stringify(scopeIdsRef.current)) {
        toast.error("Settings are still loading. Please wait before editing.");
        return;
      }
      logger.log("settings", "Settings updated", "settings", {
        sections: Object.keys(patch),
        fields: Object.fromEntries(
          Object.entries(patch).map(([section, value]) => [
            section,
            value && typeof value === "object" && !Array.isArray(value)
              ? Object.keys(value)
              : "value",
          ]),
        ),
      });
      const scope = scopeRef.current;
      const ids = scopeIdsRef.current;
      const byTier = new Map<SettingTier, Map<SettingsSectionId, Record<string, unknown>>>();
      let globalPatch: Record<string, unknown> = {};
      let hasGlobal = false;
      const effective = resolveScopedSettings(
        stateRef.current.settings,
        scope,
        mergePatch,
      ).settings;
      for (const path of patchPaths(patch as Record<string, unknown>)) {
        const value = getPath(patch, path);
        if (JSON.stringify(value) === JSON.stringify(getPath(effective, path))) continue;
        const section = sectionOfPath(path);
        // Strongest tier that already owns this block wins the write.
        const tier =
          section && !scope.locks[section.id]
            ? [...SETTING_TIERS]
                .reverse()
                .find(
                  (t) =>
                    sectionAllowsTier(section.id, t) && scope.overrides[t][section.id] && ids[t],
                )
            : undefined;
        if (section && tier) {
          const bag = byTier.get(tier) ?? new Map<SettingsSectionId, Record<string, unknown>>();
          const base = bag.get(section.id) ?? scope.overrides[tier][section.id] ?? {};
          bag.set(section.id, setPath(base, path, value));
          byTier.set(tier, bag);
        } else {
          globalPatch = setPath(globalPatch, path, value);
          hasGlobal = true;
        }
      }
      if (hasGlobal) writeGlobalSettings(globalPatch as Partial<AppSettings>);
      if (!byTier.size) return;
      setScope((s) => {
        const overrides = { ...s.overrides };
        for (const [tier, bag] of byTier) {
          overrides[tier] = { ...overrides[tier], ...Object.fromEntries(bag) };
        }
        return { ...s, overrides };
      });
      for (const [tier, bag] of byTier) {
        for (const [section, sectionPatch] of bag) {
          const targetId = ids[tier]!;
          const actor = whoRef.current;
          trackSettingsWrite(`${tier}:${targetId}:${section}`, () =>
            saveSectionOverride(tier, targetId, section, sectionPatch, actor).catch((error) => {
              toast.error(`Scoped settings not saved: ${(error as Error).message}`);
              throw error;
            }),
          );
        }
      }
    },
    [writeGlobalSettings, confirmedScopeKey],
  );
  updateSettingsRef.current = updateSettings;

  /** Start or stop overriding one block at one tier. */
  const setSectionScope = useCallback(
    async (
      section: SettingsSectionId,
      on: boolean,
      tier: SettingTier = "BRANCH",
      scopeId?: string,
    ) => {
      const target = scopeId || scopeIdsRef.current[tier];
      const def = SECTION_BY_ID[section];
      if (!def) return;
      if (!sectionAllowsTier(section, tier))
        throw new Error(`${def.label} cannot be stored at ${TIER_LABELS[tier]} scope`);
      if (!target) {
        toast.error(
          tier === "CLUSTER"
            ? "This branch is not part of a cluster yet."
            : "No scope is available for this terminal.",
        );
        return;
      }
      if (scopeRef.current.locks[section] && on) {
        toast.error("This block is locked by head office.");
        return;
      }
      await settingsWrites.current.flush();
      settingsWrites.current.revision++;
      try {
        if (on) {
          // Re-selecting a tier must keep its saved values. A genuinely new
          // owner starts empty so inherited values are not copied downward.
          const patch: Record<string, unknown> = {
            ...(scopeRef.current.overrides[tier][section] ?? {}),
          };
          await saveSectionOverride(tier, target, section, patch, whoRef.current);
          setScope((s) => ({
            ...s,
            overrides: { ...s.overrides, [tier]: { ...s.overrides[tier], [section]: patch } },
          }));
        } else {
          await clearSectionOverride(tier, target, section);
          setScope((s) => {
            const tierBag = { ...s.overrides[tier] };
            delete tierBag[section];
            return { ...s, overrides: { ...s.overrides, [tier]: tierBag } };
          });
        }
      } finally {
        settingsWrites.current.revision++;
      }
      logger.log("settings", on ? "Scope override enabled" : "Override removed", "settings", {
        section,
        tier,
        scopeId: target,
      });
    },
    [],
  );

  const setSectionLocked = useCallback(async (section: SettingsSectionId, locked: boolean) => {
    setScope((s) => ({ ...s, locks: { ...s.locks, [section]: locked } }));
    await setSectionLock(section, locked, whoRef.current);
    logger.log("settings", locked ? "Setting locked globally" : "Setting unlocked", "settings", {
      section,
    });
  }, []);

  /** Lets approveTransfer raise the fulfilling transfer without a cycle. */
  const createTransferRef = useRef<((input: NewTransfer) => Promise<Transfer>) | null>(null);

  const createTransfer = useCallback(async (input: NewTransfer) => {
    const now = new Date().toISOString();
    const { needsApproval, ...rest } = input;
    // Nothing moves at creation any more. The note either waits for a
    // supervisor or is pre-approved, and stock only leaves at dispatch.
    const transfer: Transfer = {
      ...rest,
      id: crypto.randomUUID(),
      ref: "",
      status: needsApproval ? "awaiting_approval" : "approved",
      approvedBy: needsApproval ? undefined : input.createdBy,
      approvedAt: needsApproval ? undefined : now,
      createdAt: now,
      updatedAt: now,
    };
    logger.log("inventory", "Stock transfer created", "transfers", {
      transferId: transfer.id,
      ref: transfer.ref,
      kind: transfer.kind,
      fromStoreId: transfer.fromStoreId,
      toStoreId: transfer.toStoreId,
      itemCount: transfer.items.length,
      quantity: transfer.items.reduce((sum, item) => sum + item.qty, 0),
      status: transfer.status,
    });
    const transferCounter = stateRef.current.transferCounter + 1;
    const series = input.kind === "transfer" ? "transfer" : "request";
    const originStoreId = input.kind === "transfer" ? input.fromStoreId : input.toStoreId;
    const originCode =
      stateRef.current.stores.find((store) => store.id === originStoreId)?.code ?? "BR";
    const integrations = resolveScopedSettings(
      stateRef.current.settings,
      scopeRef.current,
      mergePatch,
    ).settings.integrations;
    const numbering =
      series === "transfer"
        ? (integrations.transferNumbering ?? {})
        : (integrations.requestNumbering ?? {});
    const { nextStockRef } = await import("./stock-ref");
    transfer.ref = nextStockRef(numbering, originCode, series);
    await saveTransfer({
      transfer,
      from: stateRef.current.stores.find((x) => x.id === transfer.fromStoreId),
      to: stateRef.current.stores.find((x) => x.id === transfer.toStoreId),
      products: stateRef.current.products,
    });
    setState((s) => ({ ...s, transferCounter, transfers: [transfer, ...s.transfers] }));
    if (transfer.kind === "request") {
      const requester = stateRef.current.stores.find((x) => x.id === transfer.toStoreId)?.name;
      recordActivity({
        type: "stock_request_received",
        severity: "warning",
        title: `Stock request ${transfer.ref} received`,
        message: `${requester || "Another branch"} requested ${transfer.items.reduce((sum, item) => sum + item.qty, 0)} unit(s).`,
        actorName: transfer.createdBy,
        storeId: transfer.fromStoreId,
        entityType: "stock_request",
        entityId: transfer.id,
        meta: {
          route: `/requests/${transfer.id}`,
          audience: "branch_stock_team",
          audience_roles: ["admin", "manager", "supervisor", "warehouse", "cashier"],
          requester_store_id: transfer.toStoreId,
        },
      });
    }
    return transfer;
  }, []);

  createTransferRef.current = createTransfer;

  /** Quantities for a step, defaulting to the previous step's numbers. */
  const linesFor = (
    t: Transfer,
    given: LineQty[] | undefined,
    ceiling: (i: TransferItem) => number,
  ) =>
    t.items.map((i) => {
      const typed = given?.find((l) => l.productId === i.productId)?.qty;
      const cap = ceiling(i);
      return { productId: i.productId, qty: Math.max(0, Math.min(typed ?? cap, cap)) };
    });

  /**
   * Approve: only records how many of each line are allowed. No stock moves,
   * because nothing has been picked yet.
   */
  const approveTransfer = useCallback(async (id: string, lines?: LineQty[]): Promise<RpcResult> => {
    const before = stateRef.current.transfers.find((x) => x.id === id);
    if (!before || before.status !== "awaiting_approval")
      return { success: false, error: "Transfer is not awaiting approval." };
    const allowed = linesFor(before, lines, (i) => i.qty);
    const persisted = await approveTransferInDb(id, actorRef.current, allowed);
    if (!persisted.success) return persisted;

    setState((s) => ({
      ...s,
      transfers: s.transfers.map((x) =>
        x.id === id
          ? {
              ...x,
              status: "approved",
              approvedBy: actorRef.current,
              approvedAt: new Date().toISOString(),
              items: x.items.map((i) => ({
                ...i,
                approvedQty: allowed.find((l) => l.productId === i.productId)?.qty ?? i.qty,
              })),
              updatedAt: new Date().toISOString(),
            }
          : x,
      ),
    }));

    // A request is paperwork; the goods move on a transfer of its own. The
    // two rows stay joined by sourceRequestId so either page can reach the
    // other, and the request keeps its original quantities untouched.
    if (before.kind === "request") {
      const lines = allowed.filter((l) => l.qty > 0);
      if (lines.length)
        await createTransferRef.current?.({
          kind: "transfer",
          fromStoreId: before.fromStoreId,
          toStoreId: before.toStoreId,
          items: lines,
          note: before.note ? `${before.note} · against ${before.ref}` : `Against ${before.ref}`,
          createdBy: actorRef.current,
          sourceRequestId: before.id,
          needsApproval: false,
        });
    }
    logger.log("inventory", "Stock transfer approved", "transfers", {
      transferId: id,
      ref: before.ref,
      fromStoreId: before.fromStoreId,
      toStoreId: before.toStoreId,
      quantity: allowed.reduce((a, l) => a + l.qty, 0),
    });
    trackTransition({
      entity: "stock_transfer",
      entityId: id,
      from: "awaiting_approval",
      to: "approved",
      actorName: actorRef.current,
      storeId: before.fromStoreId,
      metadata: { ref: before.ref, toStoreId: before.toStoreId, lines: allowed },
    });
    return { success: true };
  }, []);

  /**
   * Dispatch: the goods physically leave. Whatever was not sent is simply not
   * sent — the note closes here rather than carrying a remainder forward.
   */
  const dispatchTransfer = useCallback(
    async (id: string, lines?: LineQty[]): Promise<RpcResult> => {
      const s0 = stateRef.current;
      const before = s0.transfers.find((x) => x.id === id);
      if (!before || before.status !== "approved")
        return { success: false, error: "Transfer is not approved." };
      const sent = linesFor(before, lines, (i) => i.approvedQty ?? i.qty);
      const moving = sent.filter((l) => l.qty > 0);
      const asked = before.items.reduce((a, i) => a + i.qty, 0);
      const total = sent.reduce((a, l) => a + l.qty, 0);
      const fulfilment: Transfer["fulfilment"] =
        total === 0 ? "none" : total >= asked ? "full" : "partial";
      const now = new Date().toISOString();

      const persisted = await dispatchTransferInDb(id, actorRef.current, sent);
      if (!persisted.success) return persisted;

      setState((s) => ({
        ...s,
        products: bumpItems(
          s.products,
          moving,
          before.fromStoreId,
          -1,
          s.settings.integrations.autoArchiveZeroStock !== false,
        ),
        transfers: s.transfers.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "dispatched",
                dispatchedBy: actorRef.current,
                dispatchedAt: now,
                closedAt: now,
                fulfilment,
                items: x.items.map((i) => ({
                  ...i,
                  dispatchedQty: sent.find((l) => l.productId === i.productId)?.qty ?? 0,
                })),
                updatedAt: now,
              }
            : x,
        ),
      }));

      // The request behind this transfer closes on what was actually sent.
      if (before.sourceRequestId) {
        const requestId = before.sourceRequestId;
        const request = s0.transfers.find((x) => x.id === requestId);
        const requested = request?.items.reduce((a, i) => a + i.qty, 0) ?? asked;
        const requestFulfilment: Transfer["fulfilment"] =
          total === 0 ? "none" : total >= requested ? "full" : "partial";
        setState((s) => ({
          ...s,
          transfers: s.transfers.map((x) =>
            x.id === requestId
              ? {
                  ...x,
                  status: "completed",
                  closedAt: now,
                  fulfilment: requestFulfilment,
                  updatedAt: now,
                }
              : x,
          ),
        }));
        await closeRequestInDb(requestId, requestFulfilment ?? "partial");
      }
      logger.log("inventory", "Stock transfer dispatched", "transfers", {
        transferId: id,
        ref: before.ref,
        fromStoreId: before.fromStoreId,
        toStoreId: before.toStoreId,
        quantity: total,
        fulfilment,
      });
      trackTransition({
        entity: "stock_transfer",
        entityId: id,
        from: "approved",
        to: "dispatched",
        actorName: actorRef.current,
        storeId: before.fromStoreId,
        metadata: { ref: before.ref, toStoreId: before.toStoreId, fulfilment, lines: sent },
      });
      const source = s0.stores.find((x) => x.id === before.fromStoreId)?.name;
      recordActivity({
        type: "transfer_sent",
        title: `Transfer ${before.ref} is on its way`,
        message: `${source || "The sending branch"} dispatched ${total} unit(s) to this branch.`,
        actorName: actorRef.current,
        storeId: before.toStoreId,
        entityType: "stock_transfer",
        entityId: before.id,
        meta: {
          route: `/transfers/${before.id}`,
          audience: "receiving_branch",
          audience_roles: ["admin", "manager", "supervisor", "warehouse", "cashier"],
          sender_store_id: before.fromStoreId,
        },
      });
      return { success: true };
    },
    [],
  );

  /**
   * Arrival. The delivery is at the destination but nobody has opened it, so
   * no stock moves here — that happens at verification.
   */
  const receiveTransfer = useCallback(async (id: string): Promise<RpcResult> => {
    const s0 = stateRef.current;
    const before = s0.transfers.find((x) => x.id === id);
    if (!before || before.status !== "dispatched")
      return { success: false, error: "Transfer is not dispatched." };
    const now = new Date().toISOString();
    const persisted = await receiveTransferInDb(id, actorRef.current);
    if (!persisted.success) return persisted;

    setState((s) => ({
      ...s,
      transfers: s.transfers.map((x) =>
        x.id === id
          ? {
              ...x,
              status: "received",
              receivedBy: actorRef.current,
              receivedAt: now,
              updatedAt: now,
            }
          : x,
      ),
    }));

    logger.log("inventory", "Stock transfer arrived", "transfers", {
      transferId: id,
      ref: before.ref,
      fromStoreId: before.fromStoreId,
      toStoreId: before.toStoreId,
    });
    trackTransition({
      entity: "stock_transfer",
      entityId: id,
      from: "dispatched",
      to: "received",
      actorName: actorRef.current,
      storeId: before.toStoreId,
      metadata: { ref: before.ref, fromStoreId: before.fromStoreId },
    });
    const destination = s0.stores.find((store) => store.id === before.toStoreId)?.name;
    recordActivity({
      type: "transfer_received",
      title: `Transfer ${before.ref} received`,
      message: `${destination || "The receiving branch"} confirmed that the delivery arrived.`,
      actorName: actorRef.current,
      storeId: before.fromStoreId,
      entityType: "stock_transfer",
      entityId: before.id,
      meta: {
        route: `/transfers/${before.id}`,
        audience: "sending_branch",
        audience_roles: ["admin", "manager", "supervisor", "warehouse", "cashier"],
        receiving_store_id: before.toStoreId,
      },
    });
    return { success: true };
  }, []);

  /**
   * Physical verification. The counted quantity — and only that — goes onto
   * the destination shelf. The cloud call is the authority: if it refuses
   * (already posted, permission, connection), nothing is left half-moved
   * because the local mirror is only written once the database agrees.
   */
  const verifyTransfer = useCallback(
    async (id: string, lines: LineQty[], reason?: string): Promise<RpcResult> => {
      const s0 = stateRef.current;
      const before = s0.transfers.find((x) => x.id === id);
      if (!before) return { success: false, error: "That transfer no longer exists." };
      if (before.status !== "received")
        return { success: false, error: "This delivery has already been checked in." };

      const counted = linesFor(before, lines, (i) => i.dispatchedQty ?? i.approvedQty ?? i.qty);
      const sent = before.items.reduce((a, i) => a + (i.dispatchedQty ?? i.qty), 0);
      const total = counted.reduce((a, l) => a + l.qty, 0);
      const short = total < sent;
      if (short && !reason?.trim())
        return { success: false, error: "A short delivery needs a reason." };

      const res = await verifyTransferInDb(id, actorRef.current, counted, reason);
      if (!res.success) return res;

      const arriving = counted.filter((l) => l.qty > 0);
      const now = new Date().toISOString();
      const status: TransferStatus = short ? "completed_with_discrepancy" : "completed";

      setState((s) => ({
        ...s,
        products: bumpItems(
          s.products,
          arriving,
          before.toStoreId,
          1,
          s.settings.integrations.autoArchiveZeroStock !== false,
        ),
        transfers: s.transfers.map((x) =>
          x.id === id
            ? {
                ...x,
                status,
                verifiedBy: actorRef.current,
                verifiedAt: now,
                postedAt: now,
                discrepancyReason: short ? reason?.trim() : x.discrepancyReason,
                items: x.items.map((i) => {
                  const qty = counted.find((l) => l.productId === i.productId)?.qty ?? 0;
                  return { ...i, receivedQty: qty, verifiedQty: qty };
                }),
                updatedAt: now,
              }
            : x,
        ),
      }));

      logger.log("inventory", "Stock transfer verified", "transfers", {
        transferId: id,
        ref: before.ref,
        fromStoreId: before.fromStoreId,
        toStoreId: before.toStoreId,
        quantity: total,
        short,
      });
      trackTransition({
        entity: "stock_transfer",
        entityId: id,
        from: "received",
        to: status,
        actorName: actorRef.current,
        storeId: before.toStoreId,
        metadata: { ref: before.ref, fromStoreId: before.fromStoreId, lines: counted, reason },
      });
      return { success: true };
    },
    [],
  );

  /**
   * Turn the note down, or call it off after dispatch. Either way a reason is
   * required, and goods already sent come back to the sending branch.
   */
  const rejectTransfer = useCallback(async (id: string, reason: string): Promise<RpcResult> => {
    const s0 = stateRef.current;
    const before = s0.transfers.find((x) => x.id === id);
    if (!before) return { success: false, error: "Transfer does not exist." };
    if (!["awaiting_approval", "approved", "dispatched"].includes(before.status))
      return { success: false, error: "Transfer can no longer be changed." };
    const next: TransferStatus = before.status === "dispatched" ? "cancelled" : "rejected";
    const returning =
      before.status === "dispatched"
        ? before.items
            .map((i) => ({ productId: i.productId, qty: i.dispatchedQty ?? i.qty }))
            .filter((l) => l.qty > 0)
        : [];
    const now = new Date().toISOString();

    await setTransferStatus(id, next, actorRef.current, reason);

    setState((s) => ({
      ...s,
      products: returning.length
        ? bumpItems(
            s.products,
            returning,
            before.fromStoreId,
            1,
            s.settings.integrations.autoArchiveZeroStock !== false,
          )
        : s.products,
      transfers: s.transfers.map((x) =>
        x.id === id
          ? {
              ...x,
              status: next,
              ...(next === "rejected" ? { rejectedReason: reason } : { cancelledReason: reason }),
              updatedAt: now,
            }
          : x,
      ),
    }));

    logger.log(
      "inventory",
      next === "cancelled" ? "Stock transfer cancelled" : "Stock transfer rejected",
      "transfers",
      {
        transferId: id,
        ref: before.ref,
        fromStoreId: before.fromStoreId,
        toStoreId: before.toStoreId,
        reason,
      },
    );
    trackTransition({
      entity: "stock_transfer",
      entityId: id,
      from: before.status,
      to: next,
      reason,
      actorName: actorRef.current,
      storeId: before.fromStoreId,
      metadata: { ref: before.ref, toStoreId: before.toStoreId },
    });
    return { success: true };
  }, []);

  const reset = useCallback(() => setState(emptyState), []);

  // Every consumer sees the resolved record. Business sections use Branch >
  // Cluster > Global; terminal sections use Terminal > Cluster > Global.
  const effectiveState = useMemo(() => {
    const { settings, touched } = resolveScopedSettings(state.settings, scope, mergePatch);
    if (!touched) return state;
    return { ...state, settings };
  }, [state, scope]);

  /** Which tier is supplying the value at a dotted settings path right now. */
  const sourceOfPath = useCallback(
    (path: string): SettingSource => {
      const section = sectionOfPath(path);
      if (!section || scope.locks[section.id]) return "GLOBAL";
      for (const tier of [...SETTING_TIERS].reverse()) {
        const patch = scope.overrides[tier][section.id];
        if (sectionAllowsTier(section.id, tier) && patch && getPath(patch, path) !== undefined)
          return tier;
      }
      return "GLOBAL";
    },
    [scope],
  );

  const value: Ctx = {
    ready,
    loadPhase,
    storesLoaded,
    retryLoad,
    state: effectiveState,
    settingsScope: scope,
    configuredGlobalSettings: state.settings,
    scopeIds,
    settingsScopeLoading: confirmedScopeKey !== JSON.stringify(scopeIds),
    settingsTerminalId,
    setSettingsTerminalId,
    sourceOfPath,
    setSectionScope,
    setSectionLocked,
    stores: activeLocations(state.stores),
    allStores: state.stores,
    currentStore,
    setCurrentStore,
    upsertStore,
    archiveStore,
    forgetDeletedStore,
    activeShift,
    shiftReadError,
    shiftChecked,
    openShift,
    closeShift,
    recordSale,
    refundSale,
    changeSalePayment,
    createBooking,
    addBookingPayment,
    collectBooking,
    cancelBooking,
    refundBooking,
    deleteBooking,
    setBookingJobStatus,
    updateBookingSpecs,
    upsertProduct,
    upsertProductPriceOverride,
    importProducts,

    removeProduct,
    syncProducts,
    removeProducts,
    patchProducts,
    archiveProducts,
    restoreProducts,
    mergeProducts,
    adjustStock,
    moveStock,
    applyStockCount,
    upsertMember,
    removeMember,
    upsertPromotion,
    removePromotion,
    togglePromotion,
    updateSettings,
    updateGlobalSettings: writeGlobalSettings,
    saveConfiguredSettings,
    createTransfer,
    approveTransfer,
    dispatchTransfer,
    receiveTransfer,
    verifyTransfer,
    rejectTransfer,
    reset,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used inside PosProvider");
  return ctx;
}

/**
 * Same as usePos, but returns null instead of throwing when the provider is
 * not mounted yet. Use in shell-level components that must never blank the app.
 */
export function usePosOptional() {
  return useContext(PosContext);
}

export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0,
  );

/**
 * The one place a ticket turns into money. Line discounts (promotion first,
 * then the cashier's own), the bill discount and any automatic promotion are
 * folded in here — the register passes the raw entries, never a pre-converted
 * figure, so the percent → currency rule exists exactly once.
 */
export function cartTotals(
  lines: CartLine[],
  cartDiscount: number,
  cartDiscountType: DiscountType = "amount",
  tax?: TaxSettings,
  promoDiscount = 0,
) {
  const subtotal = r2(lines.reduce((a, l) => a + l.price * l.qty, 0));
  const lineDiscount = r2(
    lines.reduce((a, l) => a + lineDiscountTotal(l) * (l.qty < 0 ? -1 : 1), 0),
  );
  const base = r2(subtotal - lineDiscount);
  // Never let a discount push the ticket below zero.
  const billDiscount = r2(
    Math.min(
      Math.max(0, base),
      Math.max(
        0,
        r2(
          cartDiscountType === "percent" ? (base * (cartDiscount || 0)) / 100 : cartDiscount || 0,
        ) + Math.max(0, r2(promoDiscount || 0)),
      ),
    ),
  );
  const discount = r2(lineDiscount + billDiscount);
  // Spread the bill-level discount proportionally so tax stays accurate.
  const ratio = base !== 0 ? (base - billDiscount) / base : 1;
  /** taxable value of the ticket after every discount */
  const net = r2(subtotal - discount);
  let taxAmount: number;
  let total: number;
  if (tax) {
    ({ tax: taxAmount, total } = computeTax(net, tax));
  } else {
    taxAmount = r2(
      lines.reduce(
        (a, l) =>
          a +
          (Math.abs(l.price * l.qty) - lineDiscountTotal(l)) *
            (l.qty < 0 ? -1 : 1) *
            l.taxRate *
            ratio,
        0,
      ),
    );
    total = r2(net + taxAmount);
  }
  const credit = r2(
    lines
      .filter((l) => l.credit)
      .reduce((a, l) => a + (Math.abs(l.price * l.qty) - lineDiscountTotal(l)), 0),
  );
  return { subtotal, discount, lineDiscount, billDiscount, tax: taxAmount, total, credit, net };
}
