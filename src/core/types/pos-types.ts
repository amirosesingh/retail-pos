export type Store = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  /**
   * Cluster this branch belongs to. Branches in the same group share one
   * catalogue, so stock moves between them are "intra-group"; a move to a
   * branch in another group is "inter-group" and re-maps the product into the
   * receiving group's catalogue.
   */
  groupId?: string;
  /** prefix stamped on every receipt number raised at this branch */
  receiptPrefix?: string;
  /** optional branch-level receipt branding overrides */
  receiptOverrides?: ReceiptOverride;
  /** what this location physically is */
  locationType?: LocationType;
  /** parent location id — a floor/room/annex nests under its building */
  parentId?: string | null;
  /** the single central hub every inbound delivery lands in first */
  isCentral?: boolean;
  /** the sub-warehouse level stock is picked from first */
  isPrimarySub?: boolean;
  /** this branch keeps its own catalogue; its items stay hidden elsewhere */
  privateCatalogue?: boolean;
  /** building this location sits in, e.g. "Riverside Tower" */
  buildingName?: string;
  /** floor or room designation, e.g. "2nd Floor Vault" */
  floorLabel?: string;
  /** archived locations keep their history but leave every picker */
  active?: boolean;
  archivedAt?: string | null;
};

export type LocationType = "store" | "main_building" | "sub_warehouse" | "central_warehouse";

export type Product = {
  id: string;
  /** first time this catalogue item was recorded; fallback arrival date */
  createdAt?: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  /** middle classification level: Category > Group > Sub-category */
  group?: string;
  /** optional second classification level under `category` */
  subCategory?: string;
  /** base unit of measure code, e.g. pcs / kg / m */
  unit?: string;
  /** purchase / pack sizes expressed in base units, e.g. carton = 12 */
  packs?: ProductPack[];
  /** extra barcodes that resolve to this same product */
  barcodes?: string[];
  /** labelled barcode variants (colour / size / pack) for this same product */
  variants?: BarcodeVariant[];
  price: number;
  cost: number;
  /** online storefront price */
  ecomPrice?: number;
  /** visible on the e-commerce website */
  ecomVisible?: boolean;
  /** archived items keep their history but leave the till and web catalogue */
  archived?: boolean;
  /** stock per store id */
  stockByStore: Record<string, number>;
  reorderLevel: number;
  taxRate: number;
  /** bonus loyalty points awarded for this item (bulk import field) */
  customPoints?: number;
  /**
   * Branch that owns this item. Empty means every branch shares it. When the
   * owning branch keeps a private catalogue, the central database itself hides
   * the item from the other branches.
   */
  ownerStoreId?: string | null;
};

export type ProductPack = {
  /** label shown when receiving, e.g. "Carton" */
  name: string;
  /** how many base units one pack contains */
  factor: number;
};

/** One labelled barcode that resolves to the parent product. */
export type BarcodeVariant = {
  code: string;
  /** what makes this variant different, e.g. "Blue", "12 m pack" */
  label?: string;
};

/** Which of the three flat catalogue lists an entry belongs to. */
export type CatalogKind = "category" | "group" | "sub";

/** One entry in a flat catalogue list (category, group or sub-category). */
export type ProductCategory = {
  id: string;
  name: string;
  kind: CatalogKind;
  parentId?: string | null;
  sort: number;
  /** Retired entries stay readable on old records but cannot be chosen again. */
  active?: boolean;
};

/** A unit of measure the catalogue can use. */
export type UomUnit = {
  id: string;
  code: string;
  name: string;
  /** weight / length style units accept fractional quantities */
  allowDecimal: boolean;
  sort: number;
  /** Retired entries stay readable on old records but cannot be chosen again. */
  active?: boolean;
};

export type Member = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  tier: "Bronze" | "Silver" | "Gold";
  points: number;
  totalSpend: number;
  joinedAt: string;
  homeStoreId?: string;
  /** date of birth, ISO yyyy-mm-dd — powers birthday promotions */
  birthday?: string;
  /** set once the member has read back a one-time code; never edited by hand */
  verified?: boolean;
  verifiedAt?: string;
  verifiedChannel?: string;
};

export type CartLine = {
  productId: string;
  name: string;
  price: number;
  /** Catalogue price retained when an authorised override changes this sale line. */
  originalPrice?: number;
  priceOverridden?: boolean;
  priceOverrideReason?: string;
  qty: number;
  taxRate: number;
  discount: number;
  /** how `discount` is interpreted: flat amount per unit, or percent of price */
  discountType?: DiscountType;
  /** exchange credit line (negative qty) returned against an earlier bill */
  credit?: boolean;
  /** free-of-charge promo line, priced at 0 */
  foc?: boolean;
  /** promotion that generated this line */
  promoId?: string;
  /** coupon code applied directly to this line */
  couponCode?: string;
  /** currency value the coupon took off this line */
  couponDiscount?: number;
  /** unit cost price captured at the moment of sale (for margin reporting) */
  cost?: number;
  /** booking this line represents (reserved job shown on the ticket) */
  bookingRef?: string;
  bookingId?: string;
  /** racket job specs shown as chips on the cart row */
  job?: RacketJob;
};

export type DiscountType = "amount" | "percent";

/** Round to cents without float drift. */
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The parts of a line that decide what money comes off it. */
export type DiscountableLine = Pick<CartLine, "price" | "discount" | "discountType"> &
  Partial<Pick<CartLine, "qty" | "couponDiscount">>;

/** Promotion / coupon money already taken off one unit of the line. */
const unitCouponDiscount = (l: DiscountableLine) => {
  const qty = Math.max(1, Math.abs(l.qty ?? 1));
  return Math.min(Math.abs(l.price), r2(Math.abs(l.couponDiscount || 0) / qty));
};

/**
 * Per-unit discount in currency. A promotion or coupon comes off first, then
 * the cashier's own discount applies to the already-reduced price, so a second
 * discount never erases the first (100 → 20% promo → 80 → 10% more → 72).
 */
export const lineUnitDiscount = (l: DiscountableLine) => {
  const coupon = unitCouponDiscount(l);
  const after = r2(Math.abs(l.price) - coupon);
  const own =
    l.discountType === "percent"
      ? r2((after * Math.min(100, Math.max(0, l.discount || 0))) / 100)
      : Math.min(after, Math.max(0, r2(l.discount || 0)));
  return r2(Math.min(Math.abs(l.price), coupon + own));
};

/**
 * Whole-line discount, rounded once so a percentage does not drift a cent per
 * unit on prices like 33.33 × 3. This is what the ticket totals use.
 */
export const lineDiscountTotal = (l: DiscountableLine) => {
  const qty = Math.abs(l.qty ?? 1);
  const gross = Math.abs(l.price) * qty;
  const coupon = Math.min(gross, Math.abs(l.couponDiscount || 0));
  const after = gross - coupon;
  const own =
    l.discountType === "percent"
      ? (after * Math.min(100, Math.max(0, l.discount || 0))) / 100
      : Math.min(after, Math.max(0, l.discount || 0) * qty);
  return r2(Math.min(gross, coupon + own));
};

/**
 * A payment method is a code from the configurable payment-types list, so an
 * administrator can add tenders without a new build. The built-in codes below
 * keep their dedicated register behaviour (change, points, card machine).
 */
export type PaymentMethod = string;

export const BUILT_IN_METHODS = {
  cash: "cash",
  card: "card",
  wallet: "wallet",
  points: "points",
  bankTransfer: "bank_transfer",
} as const;

/** Labels for the built-in tenders; custom codes resolve at render time. */
export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  wallet: "Wallet",
  points: "Points",
  bank_transfer: "Bank transfer",
};

/** Readable name for any stored method code, including deleted tenders. */
export const methodLabel = (code: string) =>
  PAYMENT_LABELS[code] ??
  (code ? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown");

/** One tender line on a split payment. A bill may carry several. */
export type Payment = {
  id: string;
  method: PaymentMethod;
  amount: number;
  /** free-text bank / card machine used for a card tender */
  bankName?: string;
  /** slip, approval or transfer reference */
  ref?: string;
  /** voucher / coupon serial captured for a tender that demands one */
  reference?: string;
  /** extra details typed with the reference (issuer, batch, notes) */
  referenceNote?: string;
  /** the tender may not complete without `reference` */
  requiresReference?: boolean;
  /** id of the configured payment account (card machine / bank / e-wallet) */
  accountId?: string;
};

export const paymentsTotal = (ps: Payment[] | undefined) =>
  r2((ps ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0));

/** Human-readable one-line tender summary, e.g. "Cash 20.00 + Card (HSBC) 15.00". */
export const paymentsLabel = (ps: Payment[] | undefined) =>
  (ps ?? [])
    .map(
      (p) =>
        `${methodLabel(p.method)}${p.bankName ? ` (${p.bankName})` : ""} ${p.amount.toFixed(2)}`,
    )
    .join(" + ");

export type TenderCheck = {
  /** everything entered across the tender lines */
  paid: number;
  /** what is still outstanding (0 once the bill is covered) */
  balance: number;
  /** cash overpay handed back to the customer */
  change: number;
  /** blocking reason, or null when the tenders can complete the sale */
  error: string | null;
};

/**
 * Validates a split-tender payment: part cash, part card, part anything else.
 * Only cash may overpay (that becomes change); every card line must name the
 * bank / card machine used so the takings can be reconciled per terminal.
 */
export function validateTenders(total: number, tenders: Payment[]): TenderCheck {
  const target = r2(total);
  const paid = paymentsTotal(tenders);
  const balance = r2(Math.max(0, target - paid));
  const cash = paymentsTotal(tenders.filter((t) => t.method === "cash"));
  const nonCash = r2(paid - cash);
  const change = r2(Math.max(0, paid - target));

  let error: string | null = null;
  if (tenders.length === 0) error = "Add at least one tender";
  else if (tenders.some((t) => !(Number(t.amount) > 0)))
    error = "Every tender needs an amount above zero";
  else if (tenders.some((t) => t.method === "card" && !t.bankName?.trim()))
    error = "Enter the bank / card machine used for every card tender";
  else if (tenders.some((t) => t.requiresReference && !t.reference?.trim()))
    error = "Enter the voucher / reference number for every tender that needs one";
  else if (balance > 0) error = `Short by ${balance.toFixed(2)}`;
  else if (nonCash > target) error = "Only cash tenders may exceed the bill total";

  return { paid, balance, change, error };
}

export type Sale = {
  id: string;
  receiptNo: string;
  storeId: string;
  /**
   * Branch name / address exactly as they read when the bill was raised.
   * Renaming a location later never rewrites printed history.
   */
  storeName?: string;
  storeAddress?: string;
  shiftId: string;
  /** one id per checkout attempt, so a retry returns the same bill */
  clientTxnId?: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  method: PaymentMethod;
  /** full split-tender breakdown; single-tender bills carry one entry */
  payments?: Payment[];
  memberId: string | null;
  pointsEarned: number;
  cashier: string;
  createdAt: string;
  refunded?: boolean;
  /** original bill this sale exchanges against */
  exchangeOfReceiptNo?: string;
  /** new bill that exchanged this one */
  exchangedToReceiptNo?: string;
  /** credit value carried over from the original bill */
  exchangeCredit?: number;
  /** booking (pay-later ticket) this bill settles */
  bookingRef?: string;
  /** bank-transfer slip / reference number captured at the till */
  transferRef?: string;
  /** coupon code used on this bill */
  couponCode?: string;
  /** the approval that permitted a gated action on this bill */
  authorizationRequestId?: string | null;
  authorizedBy?: string | null;
  authorizedAt?: string | null;
  /** promotion the coupon matched */
  couponPromoId?: string;
  /** whether the coupon hit the whole bill or one line */
  couponScope?: "bill" | "item";
  /** currency value the coupon took off */
  couponDiscount?: number;
  /**
   * Total rounding applied to this bill: rounded − unrounded. Negative when
   * the customer paid less. Always stored, even when nothing is printed.
   */
  roundingAdjustment?: number;
  /** Receipt label in force when the bill was raised, so reprints match. */
  roundingLabel?: string;
  /** unused value left on a fixed-amount voucher after this bill */
  couponRemaining?: number;
  /** campaign the voucher belongs to, printed on the slip */
  couponName?: string;
};

export type Shift = {
  id: string;
  storeId: string;
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  countedCash: number | null;
  note: string;
  /** Authoritative lifecycle flag stored in the database. */
  status?: "OPEN" | "CLOSED";
  /** Cash counted back into the drawer at close. */
  closingFloat?: number | null;
  /** Signed-in account that opened the shift, when there is one. */
  userId?: string | null;
  /** terminal the shift was opened on — only that PC (or a manager) may close it */
  terminalId?: string;
  terminalName?: string;
  openedByStaffId?: string;
  openedByRole?: string;
  closedBy?: string;
  closedByStaffId?: string;
  closedByRole?: string;
  expectedCash?: number | null;
  /** Blind count: card and digital totals typed at close (null = not counted). */
  countedCard?: number | null;
  countedDigital?: number | null;
  expectedCard?: number | null;
  expectedDigital?: number | null;
  /** Over (positive) / short (negative) per tender, worked out at close. */
  varianceCash?: number | null;
  varianceCard?: number | null;
  varianceDigital?: number | null;
  varianceTotal?: number | null;
  /** set when the shift ran past the trading-day window */
  overdue?: boolean;
  /** Server-owned closing state machine. */
  state?: ShiftState;
  /** Why the cashier started closing — required by the server. */
  closeReason?: string | null;
  closingStartedAt?: string | null;
  closingStartedBy?: string | null;
  /** Cash the server accepted as final for this shift. */
  finalCountedCash?: number | null;
  /** Server verdict: NO_VARIANCE / OVER / SHORT (managers only see amounts). */
  varianceStatus?: string | null;
};

/** Lifecycle of a shift closure, owned by the database. */
export type ShiftState =
  | "ACTIVE"
  | "CLOSING_STARTED"
  | "CASH_COUNT_REQUIRED"
  | "CASH_COUNT_SUBMITTED"
  | "RECONCILIATION"
  | "VARIANCE_REVIEW_REQUIRED"
  | "CLOSED";

/** Trading-day window used to flag shifts left open and drive reminders. */
export type TradingHours = {
  /** "HH:MM" — blank means the store trades around the clock. */
  dayStart: string;
  dayEnd: string;
  /** hard ceiling for a single shift, in hours */
  maxShiftHours: number;
  /** minutes before day end that the "close the shift" reminder appears */
  reminderMinutes: number;
};

export type TransferKind = "transfer" | "request";
/**
 * The life of a note. Approval is a real step, dispatch is where stock leaves
 * the shelf, and arrival and posting are deliberately two different things:
 * "received" only means the box is here, "completed" means somebody counted
 * it and the stock went on the destination shelf.
 */
export type TransferStatus =
  | "awaiting_approval"
  | "approved"
  | "dispatched"
  | "received"
  | "completed"
  | "completed_with_discrepancy"
  | "rejected"
  | "cancelled";

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  awaiting_approval: "awaiting approval",
  approved: "approved",
  dispatched: "in transit",
  received: "arrived · awaiting check",
  completed: "completed",
  completed_with_discrepancy: "completed · short",
  rejected: "rejected",
  cancelled: "cancelled",
};

/** Statuses where nothing more can happen to the note. */
export const TRANSFER_CLOSED_STATUSES: TransferStatus[] = [
  "completed",
  "completed_with_discrepancy",
  "rejected",
  "cancelled",
];

/** How much of the original ask actually left the sending branch. */
export type TransferFulfilment = "full" | "partial" | "none";

export type TransferItem = {
  productId: string;
  /** what was asked for */
  qty: number;
  /** what the approver allowed */
  approvedQty?: number;
  /** what physically left the sending branch */
  dispatchedQty?: number;
  /** what the destination said arrived, before anyone counted it */
  receivedQty?: number;
  /** what was physically counted — the only number that moves stock */
  verifiedQty?: number;
};

export type Transfer = {
  id: string;
  ref: string;
  kind: TransferKind;
  /** store the goods leave from */
  fromStoreId: string;
  /** store the goods arrive at */
  toStoreId: string;
  /** one or more products moved together on the same note */
  items: TransferItem[];
  status: TransferStatus;
  note: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  dispatchedBy?: string;
  dispatchedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  /** who physically counted the delivery, and when */
  verifiedBy?: string;
  verifiedAt?: string;
  /** the moment the verified quantities went onto the destination shelf */
  postedAt?: string;
  /** required when the count came up short */
  discrepancyReason?: string;
  /** why it was turned down or called off — required for both */
  rejectedReason?: string;
  cancelledReason?: string;
  /** the request this transfer was raised to fulfil, when there is one */
  sourceRequestId?: string;
  /** set at dispatch: the request is closed from that moment */
  closedAt?: string;
  fulfilment?: TransferFulfilment;
  createdAt: string;
  updatedAt: string;
};

export type PosState = {
  stores: Store[];
  currentStoreId: string;
  products: Product[];
  members: Member[];
  sales: Sale[];
  shifts: Shift[];
  transfers: Transfer[];
  promotions: Promotion[];
  bookings: Booking[];
  counter: number;
  transferCounter: number;
  bookingCounter: number;
  settings: AppSettings;
};

/* ----------------------------- bookings ----------------------------- */

export type BookingStatus = "active" | "collected" | "cancelled";

/** When the customer settles a booking. */
export type BookingPaymentTiming = "now" | "deposit" | "collection";

export const BOOKING_TIMING_LABELS: Record<BookingPaymentTiming, string> = {
  now: "Paid in full now",
  deposit: "Deposit now",
  collection: "Pay on collection",
};

export type BookingPayment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  at: string;
  cashier: string;
  /** settled money counts towards the balance; reversed / void never does */
  status?: "settled" | "reversed" | "void";
  /** voucher serial, card slip or transfer reference */
  reference?: string;
  /** repeat-proof id sent by the till so a retry cannot double-charge */
  clientPaymentId?: string;
  /** money taken, or money handed back (stored as a negative amount) */
  kind?: "payment" | "refund";
  /** why the money was handed back */
  refundReason?: string;
  /** the payment this refund reverses, when it reverses just one */
  refundsPaymentId?: string;
  /** cash change handed back on an over-tender */
  changeGiven?: number;
};

/** Where a racket sits in the stringing workflow. */
export type JobStatus = "received" | "strung" | "ready" | "collected" | "damaged" | "cancelled";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  received: "Received",
  strung: "Strung",
  ready: "Ready to collect",
  collected: "Collected",
  damaged: "Frame damaged / snapped",
  cancelled: "Cancelled / refunded",
};

export const JOB_STATUS_FLOW: JobStatus[] = ["received", "strung", "ready", "collected"];

/** Statuses outside the normal flow; each one needs an incident note. */
export const JOB_STATUS_INCIDENT: JobStatus[] = ["damaged", "cancelled"];

/** Everything the stringer needs written on the job card. */
export type RacketJob = {
  racketModel?: string;
  stringType?: string;
  tensionMain?: number;
  tensionCross?: number;
  tensionUnit?: "lb" | "kg";
  grommetNotes?: string;
  jobNotes?: string;
  /** customer asked for the string to be stencilled */
  stencil?: boolean;
  /** overgrip replaced as part of the job */
  overgrip?: boolean;
  /** ISO timestamps for drop-off and the promised ready time */
  droppedOffAt?: string;
  promisedAt?: string;
  notifyWhatsApp?: boolean;
};

/** Where the string on a racket job came from. */
export type StringOrigin = "store" | "customer";

/** Which catalogue category each intake component is booked against. */
export type IntakeCategoryMap = {
  labor?: { category?: string; subCategory?: string };
  strings?: { category?: string; subCategory?: string };
  grips?: { category?: string; subCategory?: string };
  accessories?: { category?: string; subCategory?: string };
};

/** One priced component of a racket intake. */
export type IntakeCharge = {
  kind: "labor" | "string" | "grip" | "accessory";
  name: string;
  price: number;
  /** set when the line came from stock, so it can be deducted and reported */
  productId?: string;
  category?: string;
  subCategory?: string;
  /** cashier waived / re-priced this line — the reason is kept for the audit */
  overrideReason?: string;
  /** the racket or string was brought in by the customer, so it is priced at 0 */
  customerProvided?: boolean;
};

/** One-line summary of the string job, used on slips and tags. */
export const racketSummary = (j: RacketJob | undefined) => {
  if (!j) return "";
  const unit = j.tensionUnit ?? "lb";
  const tension =
    j.tensionMain || j.tensionCross
      ? `${j.tensionMain ?? "—"}/${j.tensionCross ?? j.tensionMain ?? "—"} ${unit}`
      : "";
  return [j.racketModel, j.stringType, tension].filter(Boolean).join(" · ");
};

/** A "book now, pay later" ticket. Stock is reserved the moment it is created. */
export type Booking = {
  id: string;
  ref: string;
  storeId: string;
  shiftId: string;
  lines: CartLine[];
  /** what the booking is for, e.g. re-stringing (blank for plain layaway) */
  serviceTypeId?: string;
  serviceName?: string;
  serviceFee?: number;
  /** when the customer settles: up front, part deposit, or on collection */
  paymentTiming?: BookingPaymentTiming;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** everything paid so far (initial deposit + part payments) */
  paid: number;
  payments: BookingPayment[];
  /** ISO yyyy-mm-dd the customer must settle & collect by */
  dueDate: string;
  memberId: string | null;
  customerName: string;
  customerPhone: string;
  note: string;
  cashier: string;
  createdAt: string;
  status: BookingStatus;
  closedAt?: string;
  /** racket stringing job card (blank for plain layaway) */
  job?: RacketJob;
  jobStatus?: JobStatus;
  jobStatusBy?: string;
  jobStatusAt?: string;
  /** quick job tag handed out when no customer is attached yet */
  tagId?: string;
  /** who dropped the racket off, when the customer is not the one at the counter */
  intakeNote?: string;
  stringOrigin?: StringOrigin;
  stringProductId?: string;
  gripProductId?: string;
  /** priced breakdown of the intake: labour, string, grip, add-ons */
  charges?: IntakeCharge[];
  /** receipt number of the bill raised when the goods were collected */
  saleReceiptNo?: string;
  /** customer accepted the service & high-tension liability terms at intake */
  liabilityAccepted?: boolean;
  /** who strung the racket */
  technician?: string;
  /** why the job was marked damaged or cancelled */
  incidentNote?: string;
  /** permanent cancellation record, written once by the server */
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelledTerminal?: string;
  /** what happened to money already taken when the booking was cancelled */
  cancelMoneyAction?: "refunded" | "retained" | "none";
};

/**
 * Display-only balance. Never use this to decide whether a booking may be
 * collected — the server owns that call (see `src/lib/booking-collection.ts`).
 */
export const bookingBalance = (b: Pick<Booking, "total" | "paid">) =>
  r2(Math.max(0, b.total - b.paid));

/** Anything at or below this is treated as fully settled. */
export const MONEY_TOLERANCE = 0.005;

/* -------------------------- stock adjustments -------------------------- */

export type StockAdjustmentReason =
  "stock_count" | "damage" | "theft" | "expiry" | "correction" | "received_off_po";

export const STOCK_ADJUSTMENT_REASONS: { value: StockAdjustmentReason; label: string }[] = [
  { value: "stock_count", label: "Stock count / calibration" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft / loss" },
  { value: "expiry", label: "Expiry" },
  { value: "correction", label: "Data correction" },
  { value: "received_off_po", label: "Received without a PO" },
];

export const STOCK_REASON_LABELS: Record<string, string> = Object.fromEntries(
  STOCK_ADJUSTMENT_REASONS.map((r) => [r.value, r.label]),
);

/** Bank-transfer / e-wallet details shown to the customer. */
export type PaymentDetails = {
  accountName: string;
  bankName: string;
  accountNumber: string;
  /** international format, powers the WhatsApp QR code */
  whatsapp: string;
  note: string;
  /** also print the transfer block on booking slips */
  showOnBookingSlip: boolean;
  /** payment QR shown on the customer display when paying by transfer */
  paymentQr?: PaymentQr;
};

/**
 * A bank / e-wallet payment QR. `static` prints the payload as-is; `dynamic`
 * substitutes {amount} and {reference} with the live bill figures.
 */
export type PaymentQr = {
  enabled: boolean;
  mode: "static" | "dynamic";
  /** EMVCo / UPI / PromptPay / DuitNow payload, or any URL */
  payload: string;
  label: string;
};

export const defaultPaymentQr: PaymentQr = {
  enabled: false,
  mode: "static",
  payload: "",
  label: "Scan to pay",
};

/** Fill a dynamic QR payload with the amount due and the bill reference. */
export const resolvePaymentQr = (
  qr: PaymentQr | undefined,
  amount: number,
  reference: string,
): string => {
  if (!qr?.enabled || !qr.payload.trim()) return "";
  if (qr.mode === "static") return qr.payload.trim();
  return qr.payload
    .replaceAll("{amount}", r2(amount).toFixed(2))
    .replaceAll("{reference}", reference || "")
    .trim();
};

export const whatsappLink = (number: string) => {
  const digits = (number || "").replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "";
};

/** WhatsApp bill delivery (Meta WhatsApp Cloud API). */
export type WhatsAppSettings = {
  enabled: boolean;
  /** Meta Cloud API phone number id (from the WhatsApp app dashboard) */
  phoneNumberId: string;
  /** short totals only, or every line of the bill */
  format: "summary" | "itemized";
  autoSendOnSale: boolean;
  autoSendOnBooking: boolean;
  /** default country dialling code applied to local member numbers */
  countryCode: string;
  /** intro line above the bill body */
  greeting: string;
  /** sign-off under the bill body */
  signoff: string;
};

export type PromoType = "points" | "foc" | "birthday" | "threshold" | "tier";

export type MemberTier = Member["tier"];

export type TaxMode = "inclusive" | "exclusive";

export type TaxSettings = {
  /** master switch for tax calculation */
  enabled: boolean;
  /** percent, e.g. 5 for 5% */
  rate: number;
  /** "Prices Include Tax" vs "Tax Added at Checkout" */
  mode: TaxMode;
};

export type PaperSize = "30mm" | "80mm" | "58mm" | "a4" | "letter";

export type FontFamilyKey = "mono" | "sans" | "serif";

export type FontStyleSettings = {
  family: FontFamilyKey;
  /** px */
  size: number;
  bold: boolean;
  /** px letter spacing */
  spacing: number;
};

export type ReceiptLinePlacement = "header" | "footer";

export type ReceiptCustomLine = {
  id: string;
  text: string;
  placement: ReceiptLinePlacement;
};

export type ReceiptQrSettings = {
  enabled: boolean;
  value: string;
  /** px */
  size: number;
  placement: ReceiptLinePlacement;
};

/** Wording printed on booking / racket job slips. */
export type BookingSlipSettings = {
  /** free-text terms & conditions, printed line by line */
  terms: string;
  /** print the terms block on booking slips */
  showTerms: boolean;
  /** print a customer signature rule under the terms */
  showSignature: boolean;
  /** line printed above the signature rule */
  signatureCaption: string;
  /** repeat the terms on part-payment receipts */
  termsOnPayment: boolean;
};

export type ReceiptSettings = {
  paper: PaperSize;
  /** business identity printed at the top of every slip */
  companyName: string;
  taxNumber: string;
  regNumber: string;
  phone: string;
  website: string;
  /** store header address / phone block */
  headerText: string;
  /** bottom thank-you note */
  footerText: string;
  showLogo: boolean;
  /** transparent PNG logo as a data URL; falls back to initials when empty */
  logo?: string;
  /** responsive placement and sizing for the logo on printed receipts */
  logoLayout: {
    position: "above-name" | "below-name" | "after-details";
    alignment: "left" | "center" | "right";
    widthPercent: number;
    maxHeightMm: number;
  };
  showPoints: boolean;
  showBarcode: boolean;
  showTax: boolean;
  fonts: {
    header: FontStyleSettings;
    body: FontStyleSettings;
    footer: FontStyleSettings;
  };
  customLines: ReceiptCustomLine[];
  qr: ReceiptQrSettings;
  /** operator stylesheet, scoped to the receipt body before printing */
  css?: string;
  /** wording printed on booking / racket job slips */
  bookingSlip: BookingSlipSettings;
};

/** Fields a single branch may override on top of the global receipt profile. */
export type ReceiptOverride = Partial<
  Pick<
    ReceiptSettings,
    | "companyName"
    | "taxNumber"
    | "regNumber"
    | "phone"
    | "website"
    | "headerText"
    | "footerText"
    | "logo"
    | "customLines"
    | "qr"
    | "css"
    | "bookingSlip"
  >
>;

export type AppSettings = {
  tax: TaxSettings;
  receipt: ReceiptSettings;
  payment: PaymentDetails;
  whatsapp: WhatsAppSettings;
  /** Domains, approval rules and other operational switches. */
  integrations: IntegrationSettings;
  /** Admin-controlled screen elements hidden from chosen roles. */
  visibility: UiVisibility;
};

/** Operational switches an admin can change from System & Integrations. */
export type DateFormat = "dmy" | "mdy" | "ymd";
export type TimeFormat = "12h" | "24h";
export type TerminalPurpose = "retail" | "warehouse" | "inventory" | "receiving" | "management";
export type SellingLayout = "standard" | "canvas";

export type IntegrationSettings = {
  /** Operational home shown on this terminal. It never grants user permissions. */
  terminalPurpose?: TerminalPurpose;
  /** Register presentation only; both options use the same cart and checkout engine. */
  sellingLayout?: SellingLayout;
  displayProfile?: import("@/lib/display-profile").DisplayProfile;
  /** Printer profile resolved using the selected settings scope. */
  receiptPrinter?: import("@/lib/receipt-printer").PrinterPrefs;
  /** Seconds before an idle signed-in terminal returns to its lock screen. */
  autoLockTimeoutSeconds?: number;
  /** public member signup domain */
  memberDomain: string;
  /** public voucher redemption domain */
  redeemDomain: string;
  /** transfers must be approved before stock moves */
  requireTransferApproval: boolean;
  /** hand out the welcome voucher automatically on member signup */
  autoIssueWelcome: boolean;
  /** keep working from the local cache even when the cloud is reachable */
  offlineMode: boolean;
  /** IANA zone used for every displayed / printed time; "" = this PC's zone */
  timeZone?: string;
  /** ISO country of the business, used to suggest a zone and formats */
  country?: string;
  /** how dates read on screen and on slips */
  dateFormat?: DateFormat;
  /** 12-hour or 24-hour clock */
  timeFormat?: TimeFormat;
  /** pick a configured account for card / transfer / wallet tenders */
  usePaymentAccounts?: boolean;
  /** card machines, bank accounts and e-wallets money can land in */
  paymentAccounts?: PaymentAccount[];
  /** offer a service type when raising a booking */
  useServiceTypes?: boolean;
  /** allow a typed-in service when nothing on the list fits */
  allowCustomServiceType?: boolean;
  /** re-stringing, repairs, custom orders … with their default fee */
  serviceTypes?: BookingServiceType[];
  /** master list of racket brands / models offered in the intake picker */
  racketModels?: string[];
  /** master list of string brands / models offered in the intake picker */
  stringModels?: string[];
  /** bookings cannot be saved without a named customer */
  requireBookingCustomer?: boolean;
  /** locked base labour fee used by the racket intake form */
  baseLaborFee?: number;
  /** deposit, scheduling, racket and control rules for bookings */
  bookingRules?: BookingRules;
  /** which catalogue categories intake lines are booked against */
  categoryMap?: IntakeCategoryMap;
  /** per-branch isolation and sync switches, keyed by store id */
  branches?: Record<string, BranchPolicy>;
  /** products owned by a private-catalogue branch: productId -> storeId */
  productOwners?: Record<string, string>;
  /** How receipt numbers are built on this branch's tills. */
  billNumbering?: BillNumberingSettings;
  /** How Stock Operations reference numbers are built. */
  stockNumbering?: import("@/lib/stock-ref").StockNumberingSettings;
  /** How goods-received (purchasing) reference numbers are built. */
  receivingNumbering?: import("@/lib/stock-ref").StockNumberingSettings;
  /** How branch stock-request references are built. */
  requestNumbering?: import("@/lib/stock-ref").StockNumberingSettings;
  /** How branch stock-transfer references are built. */
  transferNumbering?: import("@/lib/stock-ref").StockNumberingSettings;
  /** Cash-rounding of the final bill total. */
  rounding?: RoundingSettings;
};

/** How the final bill total is rounded at the till. */
export type RoundingSettings = {
  /** Master switch — everything else is ignored when off. */
  enabled: boolean;
  /** Smallest currency step the total may land on: 1, 0.5, 0.1, 0.05, 0.01. */
  unit: number;
  direction: "nearest" | "up" | "down";
  /** Round every tender, or only cash bills. */
  appliesTo: "all" | "cash";
  /** Print a customer-facing line when the customer paid less. */
  showOnReceipt: boolean;
  /** Wording of that line, e.g. "Extra Discount". */
  receiptLabel: string;
};

/** Receipt numbering: [BRANCH]-[PLATFORM][TERMINAL]-[YYYYMMDD]-[SEQUENCE]. */
export type BillNumberingSettings = {
  /** Blank = use the branch's own code. */
  branchCode?: string;
  /** Blank = derive from this device's activation. */
  terminalNo?: string;
  /** Digits in the running number (3–6). */
  padding?: number;
  /** Start again at 1 each trading day. */
  resetDaily?: boolean;
};

export type PaymentAccountType = "card_machine" | "bank_account" | "ewallet" | "other";

export const PAYMENT_ACCOUNT_LABELS: Record<PaymentAccountType, string> = {
  card_machine: "Card machine",
  bank_account: "Bank account",
  ewallet: "E-wallet",
  other: "Other",
};

/** A place money can land: one card terminal, bank account or e-wallet. */
export type PaymentAccount = {
  id: string;
  name: string;
  type: PaymentAccountType;
  bankName?: string;
  accountNumber?: string;
  active: boolean;
  /** empty = available at every branch */
  storeIds?: string[];
};

/** A bookable service, e.g. racket re-stringing. */
export type BookingServiceType = {
  id: string;
  name: string;
  fee: number;
  active: boolean;
  /** Racket / stringing work — opens the job card instead of needing cart items. */
  isStringingJob?: boolean;
};

/**
 * House rules for bookings: what deposit is required, how the ready-by date is
 * proposed, what a racket job must carry, and who may undo one.
 */
export type BookingRules = {
  /** every booking must take money at the counter */
  requireDeposit: boolean;
  /** how the minimum is expressed */
  depositMode: "percent" | "amount";
  /** minimum deposit: percent of the booking total, or a flat figure */
  depositMin: number;
  /** payment timings a cashier may choose */
  allowPayNow: boolean;
  allowPayDeposit: boolean;
  allowPayOnCollection: boolean;
  /** a booking cannot be collected while money is still owed */
  blockCollectionWithBalance: boolean;
  /** hours added to now to pre-fill the ready-by box (0 = leave blank) */
  defaultTurnaroundHours: number;
  /** a racket job cannot be saved without a promised date and time */
  requirePromisedAt: boolean;
  /** warn when the promised time falls outside the trading day */
  warnOutsideTradingHours: boolean;
  /** stamp a job tag on every racket booking */
  autoJobTag: boolean;
  /** default tension unit and figures on a fresh job card */
  defaultTensionUnit: "lb" | "kg";
  defaultTensionMain: number;
  defaultTensionCross: number;
  /** the job card needs a racket model / string type before saving */
  requireRacketModel: boolean;
  requireStringType: boolean;
  /** only supervisors and admins may cancel a booking */
  managerOnlyCancel: boolean;
  /** only supervisors and admins may edit specs once a deposit is held */
  managerOnlyEditPaidSpecs: boolean;
  /** flag uncollected bookings after this many days (0 = never) */
  staleAfterDays: number;
  /** what happens to labour when a stock racket and a stock string are both on the job */
  comboRule: "off" | "waive_labour" | "percent" | "amount";
  /** discount value used by the percent / amount combo rules */
  comboValue: number;
  /** overriding the locked labour fee needs a supervisor, not just a reason */
  overrideNeedsSupervisor: boolean;
  /** service & high-tension liability wording shown at intake and printed */
  serviceTerms: string;
  /** tension (in the branch unit) above which the job is flagged high-tension */
  highTensionThreshold: number;
  /** the customer must tick the liability agreement before a job can be saved */
  requireLiabilityAccept: boolean;
};

export const DEFAULT_SERVICE_TERMS =
  "The company/store shall not be held liable or responsible for any racket frame damage, cracking, or string breakage resulting from customer-requested high-tension stringing (over manufacturer recommended limits), pre-existing structural weakness, or normal wear during stringing.";

export const DEFAULT_BOOKING_RULES: BookingRules = {
  requireDeposit: false,
  depositMode: "percent",
  depositMin: 0,
  allowPayNow: true,
  allowPayDeposit: true,
  allowPayOnCollection: true,
  blockCollectionWithBalance: false,
  defaultTurnaroundHours: 48,
  requirePromisedAt: false,
  warnOutsideTradingHours: false,
  autoJobTag: true,
  defaultTensionUnit: "lb",
  defaultTensionMain: 0,
  defaultTensionCross: 0,
  requireRacketModel: false,
  requireStringType: false,
  managerOnlyCancel: false,
  managerOnlyEditPaidSpecs: false,
  staleAfterDays: 0,
  comboRule: "off",
  comboValue: 0,
  overrideNeedsSupervisor: true,
  serviceTerms: DEFAULT_SERVICE_TERMS,
  highTensionThreshold: 26,
  requireLiabilityAccept: true,
};

/** Merge stored rules over the defaults so a partial blob is always complete. */
export const bookingRulesOf = (raw: Partial<BookingRules> | undefined): BookingRules => ({
  ...DEFAULT_BOOKING_RULES,
  ...(raw ?? {}),
});

/** How one branch shares stock, catalogue and sync with the rest of the group. */
export type BranchPolicy = {
  /** stock levels here are hidden from other branches and group totals */
  privateStock: boolean;
  /** products created here stay local */
  privateCatalogue: boolean;
  /** stock may move in and out of this branch */
  allowTransfers: boolean;
  /** push stock and product changes to the central server */
  syncInventory: boolean;
  /** push sales, shifts, members and audit to the central server */
  syncOther: boolean;
};

/** Shared-with-the-group defaults; every branch starts here. */
export const defaultBranchPolicy: BranchPolicy = {
  privateStock: false,
  privateCatalogue: false,
  allowTransfers: true,
  syncInventory: true,
  syncOther: true,
};

/**
 * Element key → list of roles that must NOT see it. Admins always see
 * everything, so they can never lock themselves out of the register.
 */
export type UiVisibility = { hidden: Record<string, string[]> };

/** Daily limits that flag a cashier for review on the dashboard. */
export type ReviewThresholds = {
  maxVoids: number;
  maxRefunds: number;
  maxRefundValue: number;
  maxNoSaleOpens: number;
  /** manual discount as a percentage of that cashier's takings */
  maxDiscountPct: number;
};

export type ShiftSession = {
  id: string;
  shiftId: string;
  storeId: string;
  terminalId?: string | null;
  terminalName?: string | null;
  staffId?: string | null;
  staffName: string;
  role?: string | null;
  signedInAt: string;
  signedOutAt?: string | null;
};

export type Promotion = {
  id: string;
  name: string;
  type: PromoType;
  active: boolean;
  /** collaborator / partner the coupon codes of this rule belong to */
  partner?: string;
  /** optional ISO yyyy-mm-dd window */
  startDate?: string;
  endDate?: string;
  /** points policy */
  pointsPerDollar?: number;
  /** foc + threshold: minimum bill amount to trigger */
  minBill?: number;
  /** foc: product handed out for free */
  focProductId?: string;
  /** foc: how many units */
  focQty?: number;
  /** birthday + threshold: discount value */
  value?: number;
  /** how `value` is read (threshold rules only; birthday is always percent) */
  valueType?: DiscountType;
  /** tier rule: percentage discount per membership tier */
  tierRates?: Record<MemberTier, number>;
};
