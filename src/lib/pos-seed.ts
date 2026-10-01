import type {
  AppSettings,
  PaymentDetails,
  PosState,
  ReceiptSettings,
  ReviewThresholds,
  TradingHours,
  WhatsAppSettings,
} from "@/core/types/pos-types";
import { defaultPaymentQr } from "@/core/types/pos-types";
import { DEFAULT_RECEIPT_LOGO_LAYOUT } from "@/lib/receipt-logo";

export const defaultPaymentDetails: PaymentDetails = {
  accountName: "",
  bankName: "",
  accountNumber: "",
  whatsapp: "",
  note: "Send the transfer slip on WhatsApp to confirm your booking.",
  showOnBookingSlip: true,
  paymentQr: defaultPaymentQr,
};

export const defaultReceiptSettings: ReceiptSettings = {
  paper: "80mm",
  companyName: "RETAIL",
  taxNumber: "88-2201194",
  regNumber: "",
  phone: "555-0100",
  website: "",
  headerText: "42 Harbour Street, Unit 3\nTel 555-0100 · VAT 88-2201194",
  footerText: "Thank you — see you again soon",
  showLogo: true,
  logo: "",
  logoLayout: DEFAULT_RECEIPT_LOGO_LAYOUT,
  showPoints: true,
  showBarcode: true,
  showTax: true,
  fonts: {
    header: { family: "mono", size: 15, bold: true, spacing: 2 },
    body: { family: "mono", size: 12, bold: false, spacing: 0 },
    footer: { family: "mono", size: 11, bold: false, spacing: 0 },
  },
  customLines: [],
  qr: { enabled: false, value: "", size: 96, placement: "footer" },
  css: "",
  bookingSlip: {
    terms:
      "1. Rackets left over 30 days after the ready date may be disposed of.\n2. Old or damaged frames and grommets may break during stringing; we string at the owner's risk.\n3. Tension is set as agreed above; a 5% variance is normal.\n4. Please check the racket before leaving the counter — no claims after collection.",
    showTerms: true,
    showSignature: true,
    signatureCaption: "I accept the terms above and confirm the racket details are correct.",
    termsOnPayment: false,
  },
};

export const defaultWhatsApp: WhatsAppSettings = {
  enabled: false,
  phoneNumberId: "",
  format: "summary",
  autoSendOnSale: false,
  autoSendOnBooking: false,
  countryCode: "+1",
  greeting: "Thanks for shopping with us!",
  signoff: "Keep this message as your digital receipt.",
};

/** Daily limits used to flag unusual cashier behaviour for review. */
export const defaultReviewThresholds: ReviewThresholds = {
  maxVoids: 5,
  maxRefunds: 3,
  maxRefundValue: 200,
  maxNoSaleOpens: 5,
  maxDiscountPct: 15,
};

/** Default trading window: 9am to 10pm, 12h shift ceiling, 30min warning. */
export const defaultTradingHours: TradingHours = {
  dayStart: "09:00",
  dayEnd: "22:00",
  maxShiftHours: 12,
  reminderMinutes: 30,
};

/** Public domains and operational switches, editable in System & Integrations. */
export const defaultIntegrations: AppSettings["integrations"] = {
  terminalPurpose: "retail",
  autoLockTimeoutSeconds: 90,
  memberDomain: "",
  redeemDomain: "",
  requireTransferApproval: true,
  autoIssueWelcome: false,
  offlineMode: false,
  timeZone: "",
  usePaymentAccounts: false,
  paymentAccounts: [],
  useServiceTypes: false,
  allowCustomServiceType: true,
  serviceTypes: [],
  requireBookingCustomer: true,
  baseLaborFee: 0,
  categoryMap: {},
  branches: {},
  productOwners: {},
  rounding: {
    enabled: false,
    unit: 0.05,
    direction: "nearest",
    appliesTo: "all",
    showOnReceipt: true,
    receiptLabel: "Extra Discount",
  },
};

export const defaultSettings: AppSettings = {
  tax: { enabled: true, rate: 5, mode: "exclusive" },
  receipt: defaultReceiptSettings,
  payment: defaultPaymentDetails,
  whatsapp: defaultWhatsApp,
  integrations: defaultIntegrations,
  visibility: { hidden: {} },
};

/**
 * Compatibility-only empty sample state.
 * Built-in demo stores, products, members and promotions have been removed
 * from production source. Keeping this empty shape temporarily avoids breaking
 * older callers while ensuring no sample business records can be inserted.
 */
export const sampleState: PosState = {
  stores: [],
  currentStoreId: "",
  counter: 1,
  transferCounter: 1,
  bookingCounter: 0,
  transfers: [],
  bookings: [],
  promotions: [],
  settings: defaultSettings,
  products: [],
  members: [],
  sales: [],
  shifts: [],
};

/**
 * What the till starts from before the database answers. Deliberately empty so
 * a deleted record can never reappear from a stale first paint.
 */
export const emptyState: PosState = {
  stores: [],
  currentStoreId: "",
  counter: 1,
  transferCounter: 1,
  bookingCounter: 0,
  transfers: [],
  bookings: [],
  promotions: [],
  settings: defaultSettings,
  products: [],
  members: [],
  sales: [],
  shifts: [],
};
