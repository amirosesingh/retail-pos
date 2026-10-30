import { preserveSessionDrafts } from "./session-draft";
import { branchReadApplies, latestOpenShiftForBranch, shiftIsOpenForBranch } from "./branch-shift-state";
import { BranchOperationGate } from "./branch-operation-gate";
import { formatMoney, setPosCurrency } from "./currency";
import { subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { subscribeSettingsRefresh } from "./settings-refresh";
import { createRefreshQueue, requestBackgroundRefresh, subscribeBackgroundRefresh } from "./background-refresh";
import { stockCountChanges } from "./stock-count-plan";
import { retainUnchangedFields, applyLiveRowChanges } from "./live-state";
import { primarySnapshotReadsTable } from "./live-query-tables";
import { isLegacyExchange } from "@/lib/legacy-exchange";
import { redeemedPoints } from "./points-redemption";
import { CUSTOMER_REFUNDS_ALLOWED, NO_REFUND_MESSAGE, exchangePolicyError } from "./returns-policy";
import { uniqueSales, sameRecordId } from "./sale-identity";
import { staffSettingsTarget } from "./settings-edit-policy";
import { isCompanyIdentityPath } from "./company-identity";
import { readBranding, writeBranding } from "./branding";
import { canSelectLocation, selectedLocation, verifyTerminalLocation } from "@/core/api/location-directory";
import { documentOrigin } from "./document-origin";
import { SettingsWriteQueue, settingsWriteGroup } from "./settings-write-queue";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
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
  loadShiftsByIds,
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
import { APP_RESUME_EVENT, CONNECTIVITY_RESTORED_EVENT } from "@/core/activation/connection-health";
import { useAuth } from "@/lib/pos-auth";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { reserveBillNumber } from "./bill-number";
import { loadCashierToken, loadSessionToken } from "./pos-credentials";
import { beginAutoLockOperation } from "./auto-lock";
import { markStartupStage } from "./startup-timing";
import {
  activeBranchId,
  bindTerminalBranch,
  branchTerminalConfig,
  requireBranchId,
  setKnownBranches,
} from "./active-branch";
import { isShiftOverdue, localTerminalId } from "./shift-hours";
import { beginShiftSession, endShiftSessions } from "./shift-sessions";
import { setPublicHosts } from "./coupon-hosts";
import { branchDisplayName } from "./human-readable";
import { activeLocations, archiveBlockers, canonicalLocations } from "./locations";
import { branchOwnsNewCatalogue, branchPolicy } from "./branch-policy";
import { setActiveBranchSyncPolicy } from "./sync-policy";
import { setPosFormats, setPosTimeZone } from "./time-zone";
import {
  approveTransferInDb,
  dispatchTransferInDb,
  receiveTransferInDb,
  closeRequestInDb,
  scopeBetween,
  verifyTransferInDb,
  saveTransfer,
  loadTransfer,
  loadTransfers,
  setTransferStatus,
  type LineQty,
  type RpcResult,
} from "./stock-transfers";
import { computeTax } from "@/core/pricing/tax";
import { commitBooking, deleteBookingRow, loadBookings } from "./bookings-db";
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
import { businessReadsReady, transferReadAllowed, transferReadsReady } from "./business-readiness";
import { hasCentralAuthSession, subscribeCentralAuthSession } from "./session-presence";
import { retryDataRead, withReadDeadline } from "./read-retry";
import { beginDataReadAttempt, dataReadIdentity, dataSnapshotReady } from "./data-read-attempt";
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

/** Avoid waking every POS consumer when a database refresh returned the same rows. */
const hasSameValue = (left: unknown, right: unknown) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

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
  const stockByStore = { ...current, [canonicalId]: (current[canonicalId] ?? 0) + delta };
  return applyZeroStockLifecycle({ ...p, stockByStore }, lifecycle);
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
  /** Save or finalize this existing draft instead of creating another row. */
  draftId?: string;
  /** Persist the note without submitting it into the approval lifecycle. */
  saveAsDraft?: boolean;
  /** Deterministic child id used when a request approval is retried. */
  forcedId?: string;
};

export type NewBooking = {
  draftBillNo?: string | null;
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
  locationLoadError: string | null;
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
  correctSale: (previous: Sale, corrected: Sale, reason: string, clientKey: string) => Promise<Sale>;
  refundSale: (
    saleId: string,
    grantToken?: string | null,
    loadedSale?: Sale,
  ) => Promise<boolean>;
  changeSalePayment: (
    saleId: string,
    method: PaymentMethod,
    reason?: string,
    loadedSale?: Sale,
  ) => Promise<boolean>;
  createBooking: (input: NewBooking) => Promise<Booking>;
  setBookingJobStatus: (
    id: string,
    status: JobStatus,
    who: string,
    incidentNote?: string,
  ) => Promise<Booking | null>;
  /** Edit the technical specs of an existing racket job before payment. */
  updateBookingSpecs: (id: string, job: RacketJob) => Promise<Booking | null>;
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
  upsertProduct: (product: Product, options?: { catalogOnly?: boolean; includeEcommerce?: boolean; includeCost?: boolean }) => Promise<CommitTarget>;
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
    record?: { lines: unknown[]; totalImpact: number },
    adjustmentAttemptId?: string | null,
  ) => Promise<CommitTarget | null>;
  upsertMember: (member: Member) => Promise<CommitTarget>;
  removeMember: (id: string) => Promise<void>;
  upsertPromotion: (promotion: Promotion) => Promise<CommitTarget>;
  removePromotion: (id: string) => Promise<void>;
  togglePromotion: (id: string, active: boolean) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => boolean | void;
  /** Write directly to the company-wide record, bypassing inherited scopes. */
  updateGlobalSettings: (patch: Partial<AppSettings>) => void;
  saveConfiguredSettings: () => Promise<void>;
  commitSettingsDraft: (patch: Partial<AppSettings>) => Promise<void>;
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
  const next: PosState = {
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
      if (!pendingSales?.size) return uniqueSales(cloudSales);
      const incoming = new Set(cloudSales.map((sale) => sale.id));
      const preserved = s.sales.filter(
        (sale) => pendingSales.has(sale.id) && !incoming.has(sale.id),
      );
      return uniqueSales([...preserved, ...cloudSales])
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
      if (bound) return canonicalBranchId(bound);
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
  return retainUnchangedFields(s, next);
}

function applyLocationDirectory(s: PosState, stores: Store[]): PosState {
  const canonical = canonicalLocations(stores);
  const bound = activeBranchId(null);
  return {
    ...s,
    stores: canonical,
    currentStoreId:
      bound
        ? canonicalBranchId(bound)
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
    (sale) => !sameBranchId(sale.storeId, active) && !ids.has(sale.id),
  );
  const sales = uniqueSales([...otherBranches, ...pending, ...rows])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500);
  return retainUnchangedFields(current, {
    ...current,
    sales,
    counter: rows.reduce(
      (max, sale) => Math.max(max, receiptSequence(sale.receiptNo)),
      current.counter,
    ),
  });
}

export function PosProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PosState>(emptyState);
  const [ready, setReady] = useState(false);
  // Loading, ready, stalled or failed — never "the clock ran out, call it ready".
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [snapshotIdentity, setSnapshotIdentity] = useState<string | null>(null);
  const [settingsSnapshotLoaded, setSettingsSnapshotLoaded] = useState(false);
  // Whether the location list has actually been answered for, so an empty list
  // can be told apart from a list that has not arrived yet.
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [locationLoadError, setLocationLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const bootstrapGeneration = useRef(0);
  const retryLoad = useCallback(() => {
    // Invalidate the previous attempt synchronously, before React runs cleanup.
    bootstrapGeneration.current++;
    setStoresLoaded(false);
    setLocationLoadError(null);
    setLoadPhase("loading");
    setSettingsSnapshotLoaded(false);
    setReloadTick((v) => v + 1);
  }, []);
  const { authUserId, terminalUser, user, can, isAdmin, canSwitchStores, ready: authReady } = useAuth();
  const canReadTransfers = transferReadAllowed(can);
  // Nothing is fetched from the cloud until a cashier or supervisor session
  // exists — visitors never receive catalogue, member or sales data.
  const signedIn = Boolean(authUserId || terminalUser);
  const cloudSessionReady = useSyncExternalStore(subscribeCentralAuthSession, hasCentralAuthSession, () => false);
  const databaseMode = useSyncExternalStore(subscribeDatabaseMode, effectiveDatabaseMode, () => "online");
  const readsReady = businessReadsReady(authReady, signedIn, databaseMode === "local", authUserId, cloudSessionReady);
  const requiresCloudReauthentication = databaseMode === "online" && authReady && Boolean(terminalUser) && !authUserId && !cloudSessionReady;
  const personIdentity = terminalUser?.userCode ?? authUserId;
  const bootstrapBranch = activeBranchId(state.currentStoreId) ?? state.currentStoreId;
  const readIdentity = dataReadIdentity(personIdentity, databaseMode, bootstrapBranch);
  useEffect(() => {
    const name = state.settings.receipt.companyName?.trim();
    if (name && readBranding().company !== name) writeBranding({ company: name });
  }, [state.settings.receipt.companyName]);
  const missingCompanyNameNotice = useRef(false);
  useEffect(() => {
    if (!signedIn || !isAdmin || !ready || loadPhase !== "ready" || !settingsSnapshotLoaded) return;
    if (typeof state.settings.receipt.companyName === "string" &&
        state.settings.receipt.companyName.trim()) {
      missingCompanyNameNotice.current = false;
      return;
    }
    if (missingCompanyNameNotice.current) return;
    missingCompanyNameNotice.current = true;
    toast.warning("Company details are not loaded", {
      description: "Company details are not available in this database yet. Check Database & Cloud Connection and synchronization before changing the shared business identity.",
      duration: 10000,
    });
  }, [signedIn, isAdmin, ready, loadPhase, settingsSnapshotLoaded, state.settings.receipt.companyName]);
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
  const trackSettingsWrite = (key: string, save: () => Promise<unknown>, latestGroup?: string) =>
    latestGroup ? settingsWrites.current.enqueueLatest(key, latestGroup, save)
      : settingsWrites.current.enqueue(key, save);
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
    const attempt = beginDataReadAttempt(bootstrapGeneration);
    // A read that is taking too long is reported as exactly that. It is never
    // turned into "the data arrived", which would show an empty, healthy-looking
    // shop built out of nothing.
    const watchdog = window.setTimeout(() => {
      if (attempt.current()) setLoadPhase((p) => (p === "loading" ? "stalled" : p));
    }, 15000);
    void withReadDeadline(async () => {
      // Anonymous visitors get nothing: no products, members or sales.
      if (!signedIn) {
        if (authReady && attempt.current()) {
          setSnapshotIdentity(null);
          setReady(true);
          setLoadPhase("ready");
        }
        return;
      }
      if (!readsReady) {
        if (attempt.current()) {
          if (requiresCloudReauthentication) {
            setReady(true); setLoadPhase("failed");
            setLocationLoadError("The local SQL connection is unavailable. Sign in again while online to verify this cashier before reading central data.");
          } else { setReady(false); setLoadPhase("loading"); }
        }
        return;
      }
      if (
        typeof navigator !== "undefined" &&
        !navigator.onLine &&
        effectiveDatabaseMode() === "online"
      ) {
        if (attempt.current()) {
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
        // A paired local-first till gets its authoritative branch from the
        // same SQL snapshot as its catalogue. Do not hold that snapshot behind
        // a second directory read that may fall back to a slow cloud relay.
        const pairedLocalSnapshot = effectiveDatabaseMode() === "local" &&
          !!localDb()?.snapshot && !!readTerminalConfig()?.locationId;
        const locationTask = canLoadCloudDirectory && !pairedLocalSnapshot
          ? retryDataRead(async () => {
            const directory = await loadLocationDirectory();
            if (!directory.ok) throw directory.error;
            return directory;
          }, () => attempt.current()).catch(error => ({ ok: false as const, error: error instanceof Error ? error : new Error(String(error)) }))
          : null;
        let fullSnapshotApplied = false;
        const settingsRevision = settingsWrites.current.revision;
        const loadSnapshot = () => loadPrimaryState(bootstrapBranch || undefined, locationTask ?? undefined, (name) => {
          if (!attempt.current() || fullSnapshotApplied || settingsWrites.current.pending ||
              settingsWrites.current.revision !== settingsRevision) return;
          setState((current) => !attempt.current() ? current : ({ ...current, settings: {
            ...current.settings,
            receipt: { ...current.settings.receipt, companyName: name },
          } }));
        }, true);
        const cloudTask = effectiveDatabaseMode() === "online"
          ? retryDataRead(loadSnapshot, () => attempt.current()) : loadSnapshot();
        // Observe a fast SQL failure immediately while cloud discovery is pending.
        void cloudTask.catch(() => undefined);
        const directory = locationTask ? await locationTask : null;
        if (attempt.current()) setLocationLoadError(directory && !directory.ok ? directory.error.message : null);
        if (!attempt.current()) return;
        if (directory?.ok) {
          markStartupStage("location");
          setState((s) => attempt.current() ? applyLocationDirectory(s, directory.stores) : s);
          setStoresLoaded(true);
        }
        const loaded = await cloudTask;
        if (!attempt.current()) return;
        const terminal = readTerminalConfig();
        const verifiedLocations = verifyTerminalLocation(
          {ok: true, stores: loaded.stores, source: "local"},
          terminal?.tokenId ? terminal.locationId : null,
        );
        if (!verifiedLocations.ok) {
          setLocationLoadError(verifiedLocations.error.message);
          throw verifiedLocations.error;
        }
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
        fullSnapshotApplied = true;
        setState((s) => attempt.current() ? applyCloud(s, cloud, pendingSalesRef.current) : s);
        setSnapshotIdentity((current) => attempt.current() ? readIdentity ?? null : current);
        setSettingsSnapshotLoaded((current) => attempt.current() ? true : current);
        markStartupStage("essential-pos-ready");
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
            if (!attempt.current() || !cloudBookings.length) return;
            setState((s: PosState) => {
              if (!attempt.current()) return s;
              const seen = new Set(cloudBookings.map((b) => b.id));
              const bookings = [...cloudBookings, ...s.bookings.filter((b) => !seen.has(b.id))];
              return hasSameValue(s.bookings, bookings) ? s : { ...s, bookings };
            });
          })
          .catch(() => {
            /* offline or not permitted — the local list still works */
          });
      } catch (e) {
        if (!attempt.current()) return;
        void localDb()?.logConnection?.("renderer.bootstrap.failed", {
          scope: "initial-data",
          code: String((e as { code?: unknown })?.code ?? "ELOAD"),
          message: e instanceof Error ? e.message : String(e),
        });
        dbError("Loading data", e);
        setLoadPhase("failed");
        setReady(true);
        attempt.invalidate();
      } finally {
        if (attempt.current()) setReady(true);
      }
    }, 60_000).catch(error => {
      if (!attempt.current()) return;
      attempt.invalidate();
      setLocationLoadError(error instanceof Error ? error.message : 'The data service did not respond in time. Please retry.');
      setLoadPhase('failed');
      setReady(true);
    });

    return () => {
      attempt.cancel();
      window.clearTimeout(watchdog);
    };
  }, [signedIn, authReady, readsReady, readIdentity, bootstrapBranch, reloadTick, requiresCloudReauthentication]);

  // Retry a failed initial read when the connection recovers. Do not restart
  // an active catalogue download or discard a successfully loaded snapshot.
  useEffect(() => {
    if (!signedIn || loadPhase !== "failed") return;
    const recover = () => retryLoad();
    window.addEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
    return () => window.removeEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
  }, [signedIn, loadPhase, retryLoad]);

  // Transfers are not part of the register's small startup snapshot. Restore
  // their persisted headers and lines separately so a reload does not turn a
  // dispatched delivery into an empty receiving page or a read-only deep link.
  useEffect(() => {
    // A cashier's catalogue access does not grant transfer access. Do not send
    // forbidden reads or retain an earlier operator's transfer snapshot.
    if (!canReadTransfers) {
      setState(current => current.transfers.length ? { ...current, transfers: [] } : current);
      return;
    }
    // A remembered branch can exist before the Electron SQL pool finishes
    // connecting. Let the primary snapshot prove the selected backend is ready
    // before this secondary read; otherwise startup shows a false transfer
    // failure that disappears as soon as the connection completes.
    if (!transferReadsReady(readsReady, loadPhase, readIdentity, snapshotIdentity, state.currentStoreId)) return;
    let cancelled = false;
    let running = false;
    let queued = false;
    let warned = false;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        const rows = await loadTransfers();
        if (!cancelled) {
          const byId = new Map(rows.map((row) => [row.id, row]));
          setState((current) => {
            const transfers = [
              ...rows,
              ...current.transfers.filter((row) => !byId.has(row.id)),
            ];
            return hasSameValue(current.transfers, transfers)
              ? current
              : { ...current, transfers };
          });
          warned = false;
        }
      } catch (error) {
        if (!cancelled && !warned) {
          warned = true;
          toast.error("Stock transfers could not be loaded", {
            description: error instanceof Error ? error.message : "Retry when the database is ready.",
          });
        }
      } finally {
        running = false;
        if (queued && !cancelled) {
          queued = false;
          void refresh();
        }
      }
    };
    const wake = () => {
      // One transfer commonly commits its header and several lines together.
      // Collapse those hints into one scoped read without delaying startup.
      if (eventTimer) clearTimeout(eventTimer);
      eventTimer = setTimeout(() => { eventTimer = undefined; void refresh(); }, 150);
    };
    void refresh();
    const offData = subscribeDataChange((change) => {
      if (change.table === "stock_transfers" || change.table === "stock_transfer_items") wake();
    });
    const offSettings = subscribeSettingsChange((change) => {
      if (change.reason === "desktop:pull-complete" || change.reason === "reconnect") wake();
    });
    const offLocal = localDb()?.onBusinessChanged?.((change) => {
      if (change.kind === "transfer") wake();
    });
    const local = effectiveDatabaseMode() !== "online";
    const offCatchup = subscribeBackgroundRefresh(wake, local ? 60_000 : 300_000, local);
    return () => {
      cancelled = true;
      if (eventTimer) clearTimeout(eventTimer);
      offCatchup();
      offData();
      offSettings();
      offLocal?.();
    };
  }, [canReadTransfers, readsReady, loadPhase, snapshotIdentity, readIdentity, state.currentStoreId]);

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
    // Global locks and empty override sets still need confirmation before
    // editing global settings, even before the first branch is created.
    if (!readsReady) return;
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
          setScope((current) => (hasSameValue(current, next) ? current : next));
          setConfirmedScopeKey(scopeKey);
        }
      } catch {
        /* Preserve confirmed scope on a failed refresh. */
      } finally {
        running = false;
      }
    };
    const off = subscribeSettingsRefresh(refreshScope, undefined, { initial: true });
    return () => {
      cancelled = true;
      off();
    };
  }, [readsReady, readIdentity, state.currentStoreId, scopeIds]);

  // The directory may not have loaded yet (a cashier signs in with a PIN and
  // has no central-database account of their own). The terminal's own
  // activation claim still knows the branch, so use it rather than showing a
  // placeholder that reads "No branch yet" and locks the register.
  const currentStore = useMemo(() => {
    const terminal = branchTerminalConfig();
    const registeredBranchId = terminal?.deviceUse === "management" ? null : terminal?.locationId;
    const found = selectedLocation(state.stores, state.currentStoreId, registeredBranchId);
    if (found) return found;
    const boundId = (registeredBranchId ?? "").trim() || state.currentStoreId.trim();
    return {
      id: boundId,
      code: "",
      name: (registeredBranchId ? terminal?.locationName?.trim() : "") || (boundId ? "This branch" : "No branch yet"),
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
    setPosCurrency(state.settings.integrations.currency);
    setPosTimeZone(state.settings.integrations.timeZone);
    setPosFormats(state.settings.integrations.dateFormat, state.settings.integrations.timeFormat);
  }, [
    state.settings.integrations.currency,
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

  const shiftReadSequence = useRef(0);
  const refreshActiveShift = useCallback(async () => {
    // The terminal's registered branch wins, so the read always matches the
    // branch the shift was opened against.
    const storeId =
      activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
    const request = ++shiftReadSequence.current;
    const isCurrentRead = () => branchReadApplies(storeId,
      activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId,
      request, shiftReadSequence.current);
    try {
      const read = await loadActiveShift(storeId);
      if (!isCurrentRead()) return;
      const found = shiftIsOpenForBranch(read, storeId) ? read : null;
      const fresh = justOpenedRef.current;
      // A shift opened on this till stays open until it is closed here. A read
      // that cannot see it yet (replica lag, offline queue) must never re-lock
      // the register, however long ago it was opened.
      if (!found && fresh && shiftIsOpenForBranch(fresh.shift, storeId)) {
        setShiftReadError(null);
        setDbShift(fresh.shift);
        return;
      }
      setShiftReadError(null);
      setDbShift(previous => hasSameValue(previous, found) ? previous : found);
      // Only a real close ends a shift. An empty read never rewrites the
      // cached shift to CLOSED — the database row stays OPEN, and marking it
      // closed locally is what used to lock a trading till after a sign-out.
      if (found) {
        const row = found;
        setState((s) => {
          const shifts = s.shifts.some((x) => x.id === row.id)
            ? s.shifts.map((x) => (x.id === row.id ? row : x))
            : [row, ...s.shifts];
          return hasSameValue(s.shifts, shifts) ? s : { ...s, shifts };
        });
      }
    } catch (e) {
      if (!isCurrentRead()) return;
      // Offline, refused or unreachable: never downgrade a trading till to
      // "locked" — keep the last known open shift and say we are reconnecting.
      setShiftReadError((e as Error).message || "Could not reach the central database");
      setDbShift(
        (prev) =>
          (shiftIsOpenForBranch(prev, storeId) ? prev : null) ??
          (shiftIsOpenForBranch(justOpenedRef.current?.shift, storeId) ? justOpenedRef.current!.shift : null) ??
          latestOpenShiftForBranch(stateRef.current.shifts, storeId),
      );
    } finally {
      if (isCurrentRead()) setShiftChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      // Signing out never closes the shift: keep the last known open shift so
      // the next cashier walks straight back into it while the re-read runs.
      setShiftChecked(false);
      return;
    }
    if (readsReady) void refreshActiveShift();
  }, [signedIn, readsReady, readIdentity, currentStore.id, refreshActiveShift]);

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

  // Online shells keep the current snapshot while targeted change hints apply.
  // Reconnect or a stale foreground snapshot gets a bounded primary refresh;
  // ordinary focus must not repeatedly download unrelated history.
  useEffect(() => {
    if (effectiveDatabaseMode() !== "online" || !readsReady) return;
    let cancelled = false;
    let loading = false;
    let resumeTimer: number | undefined;
    let lastResumeStarted = Date.now();
    const resume = (event?: Event) => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      // Focus, visibility and the native app-state event often arrive together.
      // One foreground transition needs one snapshot, not three full reads.
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        resumeTimer = undefined;
        // Focus, visibility and native resume can arrive in separate bursts.
        // A recent or running snapshot already covers that foreground return.
        if (loading || cancelled || Date.now() - lastResumeStarted < (event?.type === "online" || event?.type === CONNECTIVITY_RESTORED_EVENT ? 5_000 : 300_000)) return;
        lastResumeStarted = Date.now();
        loading = true;
        const branch = activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
        void loadPrimaryState(branch)
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
    window.addEventListener(CONNECTIVITY_RESTORED_EVENT, resume);
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
      window.removeEventListener(CONNECTIVITY_RESTORED_EVENT, resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener(APP_RESUME_EVENT, resume);
      if (removeNative) void removeNative();
    };
  }, [readsReady, readIdentity, state.currentStoreId, refreshActiveShift]);

  // Sparse reconciliation also covers relayed/PIN sessions and missed row hints.
  // Never reset readiness: mounted tables, dialogs and checkout drafts stay intact.
  useEffect(() => {
    if (!readsReady) return;
    let cancelled = false;
    let revision = 0;
    const refresh = createRefreshQueue(async () => {
      const started = revision;
      const branch = activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
      const cloud = await loadPrimaryState(branch);
      if (cancelled) return;
      if (started !== revision) { void refresh.refresh(); return; }
      setState(current => applyCloud(current, cloud, pendingSalesRef.current));
    });
    const wake = async () => {
      // Keep the existing native worker wake; reads still come from SQL Server.
      if (effectiveDatabaseMode() !== "online")
        await Promise.resolve(localDb()?.sync?.auto?.()).catch(() => undefined);
      if (!cancelled) void refresh.refresh();
    };
    const offCatchup = subscribeBackgroundRefresh(() => void wake(), 300_000, effectiveDatabaseMode() !== "online", effectiveDatabaseMode() !== "online");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offData = subscribeDataChange(change => {
      if (change.storeId && state.currentStoreId && !sameBranchId(change.storeId, state.currentStoreId)) return;
      if (!primarySnapshotReadsTable(change.table)) return;
      revision += 1;
      if (change.entityId && !["product_barcodes", "stores"].includes(change.table)) return;
      if (!["products", "product_barcodes", "members", "promotions", "shifts", "stores"].includes(change.table)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void refresh.refresh(); }, 200);
    });
    return () => { cancelled = true; refresh.stop(); offCatchup(); offData(); if (timer) clearTimeout(timer); };
  }, [readsReady, readIdentity, state.currentStoreId]);

  useEffect(() => {
    if (!readsReady) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ids = new Set<string>();
    const off = subscribeDataChange(change => {
      if (change.table !== "shifts" || !change.entityId) return;
      ids.add(change.entityId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = new Set(ids); ids.clear();
        void loadShiftsByIds([...changed]).then(rows => {
          if (!active) return;
          setState(current => {
            const byId = new Map(rows.map(row => [row.id,row]));
            const known = new Set(current.shifts.map(row=>row.id));
            return {...current,shifts:[...current.shifts.filter(row=>!changed.has(row.id)||byId.has(row.id)).map(row=>byId.get(row.id)??row),...rows.filter(row=>!known.has(row.id))]};
          });
        }).catch(cause => { if (active) dbError("Refreshing shifts",cause); });
      },200);
    });
    return () => { active = false; off(); if (timer) clearTimeout(timer); };
  }, [readsReady, readIdentity, state.currentStoreId]);

  // Reload only changed bookings; local payments also wake their parent balances.
  useEffect(() => {
    if (!readsReady) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ids = new Set<string>();
    let all = false;
    const changedBooking = (change: { table: string; entityId?: string | null }) => {
      if (!["bookings","booking_payments"].includes(change.table)) return;
      if (change.table === "bookings" && change.entityId) ids.add(change.entityId); else all = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = new Set(ids); ids.clear(); const reloadAll = all; all = false;
        void loadBookings(reloadAll ? undefined : [...changed]).then(rows => {
          if (!active) return;
          setState(current => {
            const byId = new Map(rows.map(row => [row.id,row]));
            const known = new Set(current.bookings.map(row=>row.id));
            const bookings = [
              ...current.bookings.filter(row => !changed.has(row.id) || byId.has(row.id)).map(row => byId.get(row.id) ?? row),
              ...rows.filter(row => !known.has(row.id)),
            ];
            return hasSameValue(current.bookings, bookings) ? current : { ...current, bookings };
          });
        }).catch(cause => { if (active) dbError("Refreshing bookings",cause); });
      },200);
    };
    const off = subscribeDataChange(changedBooking);
    const local = effectiveDatabaseMode() !== "online";
    const offCatchup = subscribeBackgroundRefresh(() => changedBooking({ table: "bookings" }), local ? 60_000 : 300_000, local);
    return () => { active = false; off(); offCatchup(); if (timer) clearTimeout(timer); };
  }, [readsReady, readIdentity, state.currentStoreId]);

  // Catalogue, member and promotion events carry the changed row identity.
  // Pull only that row so a barcode or price edit never downloads the complete
  // master dataset or interrupts scanning and checkout.
  useEffect(() => {
    if (!readsReady) return;
    let active = true;
    const timers = new Map<string, number>();
    const pendingProductIds = new Set<string>();
    const versions = new Map<string, number>();
    const unsubscribe = subscribeDataChange((change) => {
      if (
        !change.entityId || change.table === "product_barcodes" ||
        !["products", "product_barcodes", "members", "promotions"].includes(change.table)
      )
        return;
      const kind = change.table;
      const versionKey = `${kind}:${canonicalBranchId(change.entityId)}`;
      versions.set(versionKey, (versions.get(versionKey) ?? 0) + 1);
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
            const requested = new Map(ids.map(id => [canonicalBranchId(id), versions.get(`products:${canonicalBranchId(id)}`)]));
            void loadCloudProducts(ids)
              .then((incoming) => {
                if (!active) return;
                const changed = new Set(ids.map(canonicalBranchId).filter(id => requested.get(id) === versions.get(`products:${id}`)));
                const records = incoming.filter(record => changed.has(canonicalBranchId(record.id)));
                setState((current) => {
                  const products = applyLiveRowChanges(current.products, changed, records,
                    product => canonicalBranchId(product.id));
                  return products === current.products ? current : { ...current, products };
                });
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
          const requestedVersion = versions.get(versionKey);
          const read =
            kind === "members"
              ? loadCloudMember(change.entityId!)
              : loadCloudPromotion(change.entityId!);
          void read
            .then((record) => {
              if (!active || requestedVersion !== versions.get(versionKey)) return;
              setState((current) => {
                const changed = new Set([change.entityId!]);
                if (kind === "members") {
                  const members = applyLiveRowChanges(current.members, changed, record ? [record as Member] : [], undefined, true);
                  return members === current.members ? current : { ...current, members };
                }
                const promotions = applyLiveRowChanges(current.promotions, changed, record ? [record as Promotion] : [], undefined, true);
                return promotions === current.promotions ? current : { ...current, promotions };
              });
            })
            .catch(() => {
              /* the next reconnect snapshot remains the recovery path */
            });
        }, 150),
      );
    });
    return () => {
      active = false;
      for (const timer of timers.values()) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [readsReady, readIdentity, state.currentStoreId]);

  // A committed sale is announced by the existing shared Realtime channel.
  // The event is only a notification: always fetch the complete canonical
  // transaction graph rather than assembling a sale from a partial payload.
  useEffect(() => {
    if (!readsReady) return;
    let cancelled = false;
    let timer: number | undefined;
    const unsubscribe = subscribeSalesChange((change) => {
      const active =
        activeBranchId(stateRef.current.currentStoreId) ?? stateRef.current.currentStoreId;
      if (change.storeId && active && !sameBranchId(change.storeId, active)) return;
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
                  if (cancelled) return;
                  setState((current) =>
                    applySalesSnapshot(current, rows, active, pendingSalesRef.current, true),
                  );
                })
              : loadCloudState().then((cloud) => {
                  if (cancelled) return;
                  setState((current) => applyCloud(current, cloud, pendingSalesRef.current));
                })
            : loadLocalSales()
                .then((rows) => {
                  if (cancelled) return;
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
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [readsReady, readIdentity, state.currentStoreId]);

  // The Electron main process confirms a transaction only after SQL Server has
  // committed it. Re-read just the local receipt set on that signal so every
  // renderer reflects the sale without a restart or a successful cloud push.
  useEffect(() => {
    if (effectiveDatabaseMode() === "online" || !readsReady) return;
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
      if (change.kind === "refund") { requestBackgroundRefresh(); return; }
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
      if (change.branchId && active && !sameBranchId(change.branchId, active)) return;
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [readsReady, readIdentity, state.currentStoreId]);

  // Refresh shared settings after remote edits and reconnects, with polling
  // when Realtime is unavailable. Never overwrite an edit with an older read.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    let running = false;
    let queued = false;
    const refresh = async () => {
      if (running) { queued = true; return; }
      if (settingsWrites.current.pending) return;
      running = true;
      const revision = settingsWrites.current.revision;
      try {
        const settings = await loadCloudSettings();
        if (
          !cancelled &&
          !settingsWrites.current.pending &&
          revision === settingsWrites.current.revision
        )
          setState((current) => {
            const next = mergeCloudSettings(settings);
            return hasSameValue(current.settings, next)
              ? current
              : { ...current, settings: next };
          });
      } catch {
        /* Keep the last confirmed settings until a later refresh. */
      } finally {
        running = false;
        if (queued && !cancelled) { queued = false; void refresh(); }
      }
    };
    const unsubscribe = subscribeSettingsRefresh(refresh, (change) =>
      ["pos_settings","pos_store_settings","settings_scoped","settings_overrides","settings_locks"].includes(change.table) ||
      ["desktop:pull-complete", "reconnect", "realtime:subscribed"].includes(change.reason),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [signedIn]);

  const activeShift = useMemo(() => {
    const branch = activeBranchId(currentStore.id) ?? currentStore.id;
    if (shiftIsOpenForBranch(dbShift, branch)) return dbShift;
    if (shiftChecked) return null;
    return latestOpenShiftForBranch(state.shifts, branch);
  }, [dbShift, shiftChecked, state.shifts, currentStore.id]);
  const selectedShiftRef = useRef(activeShift);
  selectedShiftRef.current = activeShift;

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

  const branchSwitchPending = useRef(false);
  const branchOperations = useRef(new BranchOperationGate());
  const setCurrentStore = useCallback(
    async (id: string) => {
      const terminal = branchTerminalConfig();
      const registeredBranchId = terminal?.deviceUse === "management" ? null : terminal?.locationId;
      const bound = registeredBranchId ?? user?.storeId ?? activeBranchId(null);
      if (!canSelectLocation(id, bound, canSwitchStores, registeredBranchId)) {
        toast.error("This terminal stays on its registered branch.");
        return;
      }
      const selectedId = canonicalBranchId(id);
      const location = stateRef.current.stores.find(store => sameBranchId(store.id, selectedId));
      if (!location || location.active === false || location.archivedAt) {
        toast.error("That branch is not available. Refresh the location directory first.");
        return;
      }
      if (sameBranchId(stateRef.current.currentStoreId, selectedId)) return;
      if (branchSwitchPending.current) return;
      let releaseBranchSwitch: () => void;
      try { releaseBranchSwitch = branchOperations.current.beginSwitch(); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Finish the current payment before changing branch."); return; }
      branchSwitchPending.current = true;
      try {
        // Preserve an open ticket under its original branch before changing view.
        await preserveSessionDrafts();
        // Retire old-branch results before the binding or React view changes.
        bootstrapGeneration.current++;
        setSettingsSnapshotLoaded(false);
        if (!registeredBranchId) bindTerminalBranch(selectedId, location.name);
        shiftReadSequence.current += 1;
        setShiftChecked(false);
        setShiftReadError(null);
        setState((s) => ({ ...s, currentStoreId: selectedId }));
      } catch (error) {
        toast.error("Branch was not changed", { description: error instanceof Error ? error.message : "The open ticket could not be safely held." });
      } finally { branchSwitchPending.current = false; releaseBranchSwitch(); }
    },
    [canSwitchStores, user?.storeId],
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

  const openingShiftRef = useRef(false);
  const openShift = useCallback(
    async (cashier: string, openingFloat: number) => {
      if (!can("can_open_shift")) throw new Error("You do not have permission to open a shift.");
      if (!Number.isFinite(openingFloat) || openingFloat < 0) throw new Error("Enter a valid non-negative opening float.");
      if (openingShiftRef.current) throw new Error("The shift is already being opened.");
      openingShiftRef.current = true;
      try {
      const terminal = readTerminalConfig();
      // The branch follows the terminal, never the staff record.
      const requestedBranch = stateRef.current.currentStoreId;
      const storeId = requireBranchId(requestedBranch);
      if (requestedBranch && !sameBranchId(requestedBranch, storeId)) {
        throw new Error("The selected branch does not match this terminal's registered branch. Return to its branch before opening a shift.");
      }
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
      } finally { openingShiftRef.current = false; }
    },
    [user, terminalUser, authUserId, can],
  );

  const closeShift = useCallback(
    async (countedCash: number, note: string, extras: Partial<Shift> = {}) => {
      if (!activeShift) return null;
      // Only the PC that opened the shift may close it — unless a manager or
      // admin is signed in, who can close from anywhere.
      const here = readTerminalConfig()?.tokenId ?? localTerminalId();
      const sameTerminal = !activeShift.terminalId || sameRecordId(activeShift.terminalId, here);
      if (!sameTerminal && !isAdmin && !can("can_manage_other_shifts") && !(stateRef.current.settings.integrations.allowAnyStaffCloseShift === true && can("can_close_shift"))) return null;
      const closed: Shift = {
        ...activeShift,
        ...extras,
        closedAt: new Date().toISOString(),
        countedCash,
        closingFloat: countedCash,
        status: "CLOSED",
        state: "CLOSED",
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
      const summaryWritten = localDb() ? Promise.resolve() : (async () => {
        const { publishCompleteShiftSummary } = await import("./shift-summary-client");
        const { getPosCallerAuth } = await import("./pos-caller-auth");
        // Electron already stores a complete SQL aggregate in the cash-count
        // transaction. After the final sync, central SQL can confirm all bills.
        await publishCompleteShiftSummary({ data: { ...await getPosCallerAuth(), shiftId: closed.id } }).catch(() => null);
      })();
      const recorded = await Promise.allSettled([transitionWritten, activityWritten, summaryWritten]);
      for (const result of recorded) if (result.status === "rejected")
        notifyError(result.reason, "Saving shift closure activity");
      return closed;
    },
    [isAdmin, activeShift, user, terminalUser, can],
  );

  const recordSale = useCallback(
    async (
      input: Omit<Sale, "id" | "receiptNo" | "createdAt"> & { receiptNo?: string },
      memberSnapshot?: Member | null,
    ) => {
      const snapshot = stateRef.current;
      const policyError = exchangePolicyError(input.lines, input.total, input.exchangeOfReceiptNo ?? null);
      if (policyError) throw new Error(policyError);
      const counter = snapshot.counter + 1;
      // Never write a bill without a branch — the terminal's branch is authoritative.
      const requestedBranch = input.storeId || snapshot.currentStoreId;
      const branchId = requireBranchId(requestedBranch);
      if (requestedBranch && !sameBranchId(requestedBranch, branchId)) {
        throw new Error("The selected branch does not match this terminal's registered branch. Return to its branch before completing the sale.");
      }
      const tradingShift = selectedShiftRef.current;
      if (!tradingShift || !sameRecordId(tradingShift.id, input.shiftId) || !shiftIsOpenForBranch(tradingShift, snapshot.currentStoreId))
        throw new Error("The active shift changed. Return to Selling and check the current branch before completing payment.");
      const releaseBranch = branchOperations.current.begin(branchId, snapshot.currentStoreId);
      try {
      input = { ...input, storeId: branchId };
      const store = snapshot.stores.find((x) => x.id === branchId);
      const exchangeSource = input.exchangeOfReceiptNo
        ? snapshot.sales.find(
            (candidate) =>
              candidate.receiptNo === input.exchangeOfReceiptNo && sameBranchId(candidate.storeId, branchId),
          )
        : null;
      if (isLegacyExchange(input.exchangeOfReceiptNo) && !isAdmin)
        throw new Error("Only an administrator can enter an old POS exchange.");
      if (input.exchangeOfReceiptNo && !exchangeSource && !isLegacyExchange(input.exchangeOfReceiptNo))
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
              member.points + input.pointsEarned - redeemedPoints(input),
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
          sales: uniqueSales([...tagged, sale]),
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
      } finally { releaseBranch(); }
    },
    [isAdmin],
  );

  const createBooking = useCallback(async (input: NewBooking) => {
    const snapshot = stateRef.current;
    const tradingShift = selectedShiftRef.current;
    if ((input.deposit > 0 || input.shiftId) && (!tradingShift || !sameRecordId(tradingShift.id, input.shiftId) || !shiftIsOpenForBranch(tradingShift, snapshot.currentStoreId)))
      throw new Error("The active shift changed. Check the branch and shift before saving this booking.");
    const releaseBranch = branchOperations.current.begin(input.storeId, snapshot.currentStoreId);
    try {
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
      // Keep the readable branch counter, but add entropy so two offline tills
      // cannot claim the same unique booking reference.
      ref: `BK-${documentOrigin(store?.code ?? store?.id ?? "R")}-${String(counter).padStart(5, "0")}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
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
    await commitBooking(booking, input.draftBillNo);
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
    } finally { releaseBranch(); }
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
      let releaseBranch: () => void;
      try { releaseBranch = branchOperations.current.begin(current.storeId, stateRef.current.currentStoreId); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Select the booking's branch first."); return null; }
      const endOperation = beginAutoLockOperation();
      try {
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
      if (!server.ok) {
        // Electron performs this transaction against SQL Server above. A web
        // RPC refusal must not be reinterpreted as "offline" and bypass its
        // permission, overpayment or idempotency checks with a plain upsert.
        toast.error("Payment was not recorded", { description: server.error });
        return null;
      }
      const updated: Booking = {
        ...current,
        paid: server.state.settledPaid,
        payments: server.state.duplicate ? current.payments : [...current.payments, payment],
      };
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
      }));
      logger.log("sale_event", "Booking part payment", "bookings", {
        ref: updated.ref,
        amount: payment.amount,
        method,
        paid: updated.paid,
        balance: bookingBalance(updated),
        authoritative: true,
      });
      return updated;
      } finally { releaseBranch(); endOperation(); }
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
      if (!CUSTOMER_REFUNDS_ALLOWED && moneyAction === "refunded") return { ok: false, error: NO_REFUND_MESSAGE };
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return { ok: false, error: "Booking not found." };
      if (!sameBranchId(current.storeId, stateRef.current.currentStoreId)) return { ok: false, error: "Select the booking's branch before cancelling it." };
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
      if (!CUSTOMER_REFUNDS_ALLOWED) return { ok: false, error: NO_REFUND_MESSAGE };
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return { ok: false, error: "Booking not found." };
      if (!sameBranchId(current.storeId, stateRef.current.currentStoreId)) return { ok: false, error: "Select the booking's branch before refunding it." };
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
    if (!sameBranchId(current.storeId, stateRef.current.currentStoreId)) throw new Error("Select the booking's branch before deleting it.");
    // Do not hide the row until both the payment children and booking have
    // actually been removed from the active database.
    await deleteBookingRow(id);
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
  }, []);

  /**
   * Move a racket through received → strung → ready → collected. Handing one
   * over is only allowed once the server agrees nothing is owed.
   */
  const setBookingJobStatus = useCallback(
    async (id: string, status: JobStatus, who: string, incidentNote?: string) => {
      const current = stateRef.current.bookings.find((b) => b.id === id);
      if (!current) return null;
      if (!sameBranchId(current.storeId, stateRef.current.currentStoreId)) throw new Error("Select the booking's branch before changing its status.");
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
      await commitBooking(updated);
      setState((s) => ({
        ...s,
        bookings: s.bookings.map((b) => (b.id === id ? updated : b)),
      }));
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
  const updateBookingSpecs = useCallback(async (id: string, job: RacketJob) => {
    const current = stateRef.current.bookings.find((b) => b.id === id);
    if (!current) return null;
    if (!sameBranchId(current.storeId, stateRef.current.currentStoreId)) throw new Error("Select the booking's branch before editing it.");
    const updated: Booking = { ...current, job: { ...current.job, ...job } };
    await commitBooking(updated);
    setState((s) => ({ ...s, bookings: s.bookings.map((b) => (b.id === id ? updated : b)) }));
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
      let releaseBranch: () => void;
      try {
        if (!activeShift || !sameBranchId(activeShift.storeId, current.storeId)) throw new Error("Open a shift in the booking's branch before collecting payment.");
        releaseBranch = branchOperations.current.begin(current.storeId, stateRef.current.currentStoreId);
      } catch (error) { toast.error(error instanceof Error ? error.message : "Select the booking's branch first."); return null; }
      const endOperation = beginAutoLockOperation();
      try {
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
      await commitBooking(updated);
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
      } finally { releaseBranch(); endOperation(); }
    },
    [activeShift, recordSale],
  );

  const correctSale = useCallback(async (previous: Sale, corrected: Sale, reason: string, clientKey: string) => {
    const {correctSaleInPlace}=await import("@/core/api/pos-db");
    const saved=await correctSaleInPlace(previous,corrected,reason,clientKey);
    setState(s=>({...s,sales:s.sales.map(sale=>sale.id===saved.id?saved:sale),products:s.products.map(product=>{
      const before=previous.lines.reduce((sum,line)=>sum+(line.productId===product.id?line.qty:0),0);
      const after=saved.lines.reduce((sum,line)=>sum+(line.productId===product.id?line.qty:0),0);
      return before===after?product:bump(product,saved.storeId,before-after,s.settings.integrations.autoArchiveZeroStock!==false);
    })}));
    return saved;
  },[]);

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
      await db.refundSale(saleId, `refund:${saleId}`, undefined, sale.storeId);
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
    async (
      saleId: string,
      method: PaymentMethod,
      reason?: string,
      loadedSale?: Sale,
    ): Promise<boolean> => {
      // Receipt history is paged. A bill found through exact search or an
      // older page may not be in the store's small live window, so retain the
      // verified row supplied by that screen instead of silently doing
      // nothing after the operator confirms the correction.
      const sale =
        loadedSale?.id === saleId
          ? loadedSale
          : stateRef.current.sales.find((x) => x.id === saleId);
      if (!sale || sale.method === method) return false;
      const payments = sale.payments?.map(payment => ({ ...payment, method }));
      await db.updateSalePayment(saleId, method, sale.storeId, payments);
      logger.log("sale_event", "Bill payment method corrected", "receipts", {
        saleId,
        receiptNo: sale.receiptNo,
        from: sale.method,
        to: method,
        reason: reason ?? null,
      });
      setState((s) => ({
        ...s,
        // Historical pages are owned by the receipt screen. Do not inject an
        // old bill into this newest-first, bounded live-sales window.
        sales: s.sales.map((x) => (x.id === saleId ? { ...x, method, payments } : x)),
      }));
      return true;
    },
    [],
  );

  const upsertProduct = useCallback(async (product: Product, options?: { catalogOnly?: boolean; includeEcommerce?: boolean; includeCost?: boolean }): Promise<CommitTarget> => {
    const prev = stateRef.current.products.find((p) => p.id === product.id);
    // The catalog is shared by every branch: make sure the product exists at
    // all stores (starting at zero) so it shows up everywhere after sync.
    const stockByStore = { ...(options?.catalogOnly ? prev?.stockByStore ?? {} : product.stockByStore) };
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
    // A grouped/private catalogue records the branch that created a NEW item.
    // This is cluster provenance; never guess or replace an existing owner.
    const ownsNewItems =
      !prev &&
      branchOwnsNewCatalogue(stateRef.current.settings, stateRef.current.currentStoreId, stateRef.current.stores);
    const stored: Product = ownsNewItems
      ? { ...record, ownerStoreId: stateRef.current.currentStoreId }
      : record;
    // Store it before anything on screen says it was saved.
    const target = await db.commitProduct(stored, options?.catalogOnly === true, { ecommerce: options?.includeEcommerce, cost: options?.includeCost });
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
        ? s.products.map((p) => (p.id === stored.id ? options?.catalogOnly ? { ...stored, stockByStore: p.stockByStore } : stored : p))
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
          product.id === productId ? { ...product, price, ...(ecomPrice !== undefined ? { ecomPrice } : {}) } : product,
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

      const ownsNewProducts = branchOwnsNewCatalogue(stateRef.current.settings, storeId, stateRef.current.stores);
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
              ...(ownsNewProducts ? { ownerStoreId: storeId } : {}),
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
                if (ownsNewProducts && !entry.existing) newOwners[entry.record.id] = storeId;
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
    if (zeroStockLifecycle && patch.archived !== undefined) {
      throw new Error("Archive status is managed automatically from stock. Turn off automatic archiving in Catalogue settings to change it manually.");
    }
    const updated = stateRef.current.products
      .filter((p) => set.has(p.id))
      .map((p) =>
        applyZeroStockLifecycle({ ...p, ...patch }, zeroStockLifecycle),
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
          ? applyZeroStockLifecycle(
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
      record?: { lines: unknown[]; totalImpact: number },
      adjustmentAttemptId?: string | null,
    ): Promise<CommitTarget | null> => {
      const target = storeId ?? stateRef.current.currentStoreId;
      const changes = stockCountChanges(stateRef.current.products, entries, target);
      if (!changes.length) return Promise.resolve(null);

      const lifecycle = stateRef.current.settings.integrations.autoArchiveZeroStock !== false;
      const products = changes.map((c) => applyZeroStockLifecycle({
        ...c.product,
        stockByStore: { ...canonicalStockMap(c.product.stockByStore), [canonicalBranchId(target)]: c.counted },
      }, lifecycle));
      // Stable movement ids make a retry safe after a local/cloud timeout. The
      // product id sort keeps the child index deterministic even if the UI
      // rows were re-ordered between attempts.
      const adjustmentChanges = [...changes].sort((a, b) =>
        a.product.id.localeCompare(b.product.id),
      );
      const adjustments = adjustmentChanges.map((c, index) => ({
        id: adjustmentAttemptId ? stableChildId(adjustmentAttemptId, "7", index) : undefined,
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
          draftId
            ? {
                id: draftId,
                by: postedBy,
                record: record ? { ...record, reason, note } : undefined,
              }
            : undefined,
        )
        .then((committed) => {
          // The per-product stock_adjustments are the durable detail trail.
          // One summary avoids rebuilding the visible audit feed 100,000 times.
          logger.log("inventory", "Stock count committed", "inventory", {
            storeId: target, reason, note, draftId: draftId ?? null,
            productCount: changes.length,
            costImpact: r2(changes.reduce((sum, change) => sum + change.delta * (change.product.cost ?? 0), 0)),
          });
          const byId = new Map(changes.map((c) => [c.product.id, c.counted]));
          setState((s) => ({
            ...s,
            products: s.products.map((p) =>
              byId.has(p.id)
                ? applyZeroStockLifecycle({ ...p, stockByStore: { ...canonicalStockMap(p.stockByStore), [canonicalBranchId(target)]: byId.get(p.id)! } }, lifecycle)
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
    // Cashiers can enrol and maintain contact details without receiving the
    // separate privilege that changes centrally governed loyalty balances.
    const target = await db.commitMember(member, can("can_edit_member_points"));
    setState((s) => ({
      ...s,
      members: s.members.some((m) => m.id === member.id)
        ? s.members.map((m) => (m.id === member.id ? member : m))
        : [member, ...s.members],
    }));
    return target;
  }, [can]);

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
    const target = await db.commitPromotion(promotion);
    logger.log("promotion", previous ? "Promotion updated" : "Promotion created", "promotions", {
      promotionId: promotion.id,
      promotionType: promotion.type,
      name: promotion.name,
      active: promotion.active,
    });
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
    await db.deletePromotion(id);
    logger.log("promotion", "Promotion deleted", "promotions", {
      promotionId: id,
      promotionType: promotion?.type ?? null,
      name: promotion?.name ?? null,
    });
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
    const latestGroup = settingsWriteGroup(patch as Record<string, unknown>);
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
            dbError("Saving settings", error);
            throw error;
          }),
        latestGroup,
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
        return false;
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
        if (isCompanyIdentityPath(path)) {
          if (!isAdmin) { toast.error("Only an administrator can change company details shared by all branches."); return false; }
          globalPatch = setPath(globalPatch, path, value);
          hasGlobal = true;
          continue;
        }
        const section = sectionOfPath(path);
        // Strongest tier that already owns this block wins the write.
        let staffTier: SettingTier | undefined;
        if (!isAdmin) {
          try { staffTier = staffSettingsTarget(section?.id ?? null, can("can_access_pos_settings"), ids.BRANCH, !!(section && scope.locks[section.id])); }
          catch (error) { toast.error((error as Error).message); return false; }
        }
        const tier = staffTier ?? (
          section && !scope.locks[section.id]
            ? [...SETTING_TIERS]
                .reverse()
                .find(
                  (t) =>
                    sectionAllowsTier(section.id, t) && scope.overrides[t][section.id] && ids[t],
                )
            : undefined);
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
      if (!byTier.size) return true;
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
            ["payment", "paymentAccounts", "booking", "whatsapp", "receiptIdentity", "receiptLayout"].includes(section) ? section : undefined,
          );
        }
      }
      return true;
    },
    [writeGlobalSettings, confirmedScopeKey, isAdmin, can],
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
      if (!isAdmin && (tier !== "BRANCH" || !can("can_access_pos_settings") || target !== scopeIdsRef.current.BRANCH))
        throw new Error("You may only edit your permitted branch settings.");
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
    [isAdmin, can],
  );

  const setSectionLocked = useCallback(async (section: SettingsSectionId, locked: boolean) => {
    if (!isAdmin) throw new Error("Only an administrator may change global settings locks.");
    await setSectionLock(section, locked, whoRef.current);
    setScope((s) => ({ ...s, locks: { ...s.locks, [section]: locked } }));
    logger.log("settings", locked ? "Setting locked globally" : "Setting unlocked", "settings", {
      section,
    });
  }, [isAdmin]);

  /** Lets approveTransfer raise the fulfilling transfer without a cycle. */
  const createTransferRef = useRef<((input: NewTransfer) => Promise<Transfer>) | null>(null);

  const createTransfer = useCallback(async (input: NewTransfer) => {
    const now = new Date().toISOString();
    const { needsApproval, draftId, saveAsDraft, forcedId, ...rest } = input;
    const previous = draftId
      ? stateRef.current.transfers.find((transfer) => transfer.id === draftId)
      : undefined;
    if (draftId && (!previous || previous.status !== "draft" || previous.kind !== input.kind))
      throw new Error("This stock-movement draft is no longer available to finalize.");
    const fromStore = stateRef.current.stores.find((store) => store.id === input.fromStoreId);
    const toStore = stateRef.current.stores.find((store) => store.id === input.toStoreId);
    const requiresApproval = needsApproval || scopeBetween(fromStore, toStore) === "INTER_GROUP";
    // Nothing moves at creation any more. The note either waits for a
    // supervisor or is pre-approved, and stock only leaves at dispatch.
    const transfer: Transfer = {
      ...rest,
      createdBy: previous?.createdBy ?? rest.createdBy,
      id: draftId ?? forcedId ?? crypto.randomUUID(),
      ref: previous?.ref ?? "",
      status: saveAsDraft ? "draft" : requiresApproval ? "awaiting_approval" : "approved",
      approvedBy: saveAsDraft || requiresApproval ? undefined : input.createdBy,
      approvedAt: saveAsDraft || requiresApproval ? undefined : now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const transferCounter = stateRef.current.transferCounter + (previous ? 0 : 1);
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
    if (!transfer.ref) transfer.ref = await nextStockRef(numbering, originCode, series, new Date(), originStoreId);
    await saveTransfer({
      transfer,
      from: fromStore,
      to: toStore,
      products: stateRef.current.products,
      previousLineCount: previous?.items.length,
    });
    // The lifecycle trigger owns the submitted status. Read the stored row
    // back before updating the screen so branch approval rules and the UI can
    // never disagree after a draft is finalized.
    const savedTransfer = (await loadTransfer(transfer.id)) ?? transfer;
    setState((s) => ({
      ...s,
      transferCounter,
      transfers: previous
        ? s.transfers.map((row) => (row.id === savedTransfer.id ? savedTransfer : row))
        : [savedTransfer, ...s.transfers.filter((row) => row.id !== savedTransfer.id)],
    }));
    logger.log(
      "inventory",
      saveAsDraft ? "Stock movement draft saved" : "Stock transfer created",
      "transfers",
      {
        transferId: savedTransfer.id,
        ref: savedTransfer.ref,
        kind: savedTransfer.kind,
        fromStoreId: savedTransfer.fromStoreId,
        toStoreId: savedTransfer.toStoreId,
        itemCount: savedTransfer.items.length,
        quantity: savedTransfer.items.reduce((sum, item) => sum + item.qty, 0),
        status: savedTransfer.status,
      },
    );
    if (!saveAsDraft && savedTransfer.kind === "request") {
      const requester = stateRef.current.stores.find((x) => x.id === savedTransfer.toStoreId)?.name;
      recordActivity({
        type: "stock_request_received",
        severity: "warning",
        title: `Stock request ${savedTransfer.ref} received`,
        message: `${requester || "Another branch"} requested ${savedTransfer.items.reduce((sum, item) => sum + item.qty, 0)} unit(s).`,
        actorName: savedTransfer.createdBy,
        storeId: savedTransfer.fromStoreId,
        entityType: "stock_request",
        entityId: savedTransfer.id,
        meta: {
          route: `/requests/${savedTransfer.id}`,
          audience: "branch_stock_team",
          audience_roles: ["admin", "manager", "supervisor", "warehouse", "cashier"],
          requester_store_id: savedTransfer.toStoreId,
        },
      });
    }
    return savedTransfer;
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
    const existingFulfilment = stateRef.current.transfers.find((x) => x.sourceRequestId === id);
    if (existingFulfilment) {
      // A fulfilment proves a previous approval reached durable storage, but
      // this till may still hold an awaiting snapshot. Reconcile the request
      // before treating the retry as complete.
      const durableRequest = await loadTransfer(id);
      if (!durableRequest)
        return {
          success: false,
          error: "The saved transfer request could not be verified. Refresh transfers and retry.",
        };
      setState((s) => ({
        ...s,
        transfers: s.transfers.map((row) => (row.id === id ? durableRequest : row)),
      }));
      if (durableRequest.status === "approved") return { success: true };
    }
    const repairingRequest =
      before?.kind === "request" && before.status === "approved" && !existingFulfilment;
    if (!before || (before.status !== "awaiting_approval" && !repairingRequest))
      return { success: false, error: "Transfer is not awaiting approval." };
    const allowed = repairingRequest
      ? before.items.map((item) => ({
          productId: item.productId,
          qty: item.approvedQty ?? item.qty,
        }))
      : linesFor(before, lines, (i) => i.qty);
    if (!repairingRequest) {
      const persisted = await approveTransferInDb(id, actorRef.current, allowed);
      if (!persisted.success) return persisted;
    }

    if (!repairingRequest)
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
          forcedId: stableChildId(before.id, "8", 0),
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
    ready: dataSnapshotReady(ready, signedIn, readIdentity, snapshotIdentity),
    loadPhase,
    storesLoaded,
    locationLoadError,
    retryLoad,
    state: effectiveState,
    settingsScope: scope,
    configuredGlobalSettings: state.settings,
    scopeIds,
    settingsScopeLoading: !settingsSnapshotLoaded || confirmedScopeKey !== JSON.stringify(scopeIds),
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
    correctSale,
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
    commitSettingsDraft: async (patch) => {
      if (!updateSettings(patch)) throw new Error("Settings could not be applied. Check the selected scope and your settings permissions.");
      await settingsWrites.current.flush();
    },
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

/** Settings forms preview a local draft without publishing business settings. */
export function PosSettingsDraftProvider({ settings, onChange, children }: {
  settings: AppSettings; onChange: Ctx["updateSettings"]; children: ReactNode;
}) {
  const parent = usePos();
  return <PosContext.Provider value={{ ...parent, state: { ...parent.state, settings }, updateSettings: onChange }}>{children}</PosContext.Provider>;
}

export const money = (amount: number) => formatMoney(amount);

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
