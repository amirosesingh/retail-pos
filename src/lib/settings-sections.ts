/**
 * Which settings belong to which scopable block.
 *
 * Every configuration block can either follow the global default or be
 * overridden for one branch. A block is described by the dotted paths it owns
 * inside `AppSettings`, so a write can be routed to the right place without
 * every settings page having to know about scopes.
 */
import type { AppSettings } from "@/core/types/pos-types";

export type SettingsSectionId =
  | "workspace"
  | "display"
  | "printer"
  | "terminalSecurity"
  | "tax"
  | "receiptIdentity"
  | "receiptLayout"
  | "payment"
  | "whatsapp"
  | "booking"
  | "paymentAccounts"
  | "numbering"
  | "stockNumbering"
  | "region"
  | "rounding"
  | "publicDomains"
  | "transferApproval"
  | "categoryMap"
  | "integrations"
  | "visibility";

export type SettingsSectionDef = {
  id: SettingsSectionId;
  label: string;
  blurb: string;
  /** Dotted paths inside AppSettings owned by this block. */
  paths: string[];
  /** Blocks head office normally keeps to itself. */
  lockedByDefault: boolean;
  /**
   * Business configuration follows Global → Cluster → Branch. Terminal
   * configuration follows Global → Cluster → Terminal. The access device
   * never becomes a configuration scope by itself.
   */
  scopeFamily: "business" | "terminal";
};

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: "workspace",
    label: "Terminal workspace",
    blurb: "Operational home and selling layout for this terminal.",
    paths: ["integrations.terminalPurpose", "integrations.sellingLayout"],
    lockedByDefault: false,
    scopeFamily: "terminal",
  },
  {
    id: "display",
    label: "Display & appearance",
    blurb: "Color theme, brightness, accent, text size, density and register zoom.",
    paths: ["integrations.displayProfile"],
    lockedByDefault: false,
    scopeFamily: "terminal",
  },
  {
    id: "printer",
    label: "Printer profile",
    blurb: "Printer, encoding, drawer and paper calibration.",
    paths: ["integrations.receiptPrinter"],
    lockedByDefault: false,
    scopeFamily: "terminal",
  },
  {
    id: "terminalSecurity",
    label: "Terminal security",
    blurb: "Idle screen locking for the selected terminal.",
    paths: ["integrations.autoLockTimeoutSeconds"],
    lockedByDefault: false,
    scopeFamily: "terminal",
  },
  {
    id: "tax",
    label: "Tax policy",
    blurb: "Rate, inclusive/exclusive mode and whether tax is charged at all.",
    paths: ["tax"],
    lockedByDefault: true,
    scopeFamily: "business",
  },
  {
    id: "visibility",
    label: "Screen visibility",
    blurb: "Which roles can see which elements of the till.",
    paths: ["visibility"],
    lockedByDefault: true,
    scopeFamily: "business",
  },
  {
    id: "receiptIdentity",
    label: "Receipt header & footer",
    blurb: "Branch address, phone, tax numbers and claim policy wording.",
    paths: [
      "receipt.companyName",
      "receipt.taxNumber",
      "receipt.regNumber",
      "receipt.phone",
      "receipt.website",
      "receipt.headerText",
      "receipt.footerText",
      "receipt.logo",
      "receipt.customLines",
      "receipt.bookingSlip",
      "receipt.qr",
    ],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "receiptLayout",
    label: "Receipt layout",
    blurb: "Paper size, typography and what is printed on the slip.",
    // Keep this disjoint from receiptIdentity. A whole `receipt` snapshot here
    // would silently copy company/branch wording into a terminal override.
    paths: [
      "receipt.paper",
      "receipt.showLogo",
      "receipt.logoLayout",
      "receipt.showPoints",
      "receipt.showBarcode",
      "receipt.showTax",
      "receipt.fonts",
      "receipt.css",
    ],
    lockedByDefault: false,
    scopeFamily: "terminal",
  },
  {
    id: "payment",
    label: "Payment details",
    blurb: "Bank, e-wallet and transfer QR shown to the customer.",
    paths: ["payment"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "whatsapp",
    label: "WhatsApp messaging",
    blurb: "Outbound bill and job notifications.",
    paths: ["whatsapp"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "booking",
    label: "Booking & labour rules",
    blurb: "Base labour fee, service list and the mandatory-customer rule.",
    paths: [
      "integrations.requireBookingCustomer",
      "integrations.baseLaborFee",
      "integrations.serviceTypes",
      "integrations.useServiceTypes",
      "integrations.allowCustomServiceType",
      "integrations.bookingRules",
      "integrations.racketModels",
      "integrations.stringModels",
    ],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "categoryMap",
    label: "Category & inventory mapping",
    blurb: "Which catalogue categories intake lines are booked against.",
    paths: ["integrations.categoryMap"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "integrations",
    label: "System & integrations",
    blurb: "Domains, approval switches, numbering and regional formats.",
    paths: ["integrations"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "paymentAccounts",
    label: "Payment accounts",
    blurb: "Card machines, bank accounts and e-wallets available at checkout.",
    paths: ["integrations.paymentAccounts", "integrations.usePaymentAccounts"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "numbering",
    label: "Bill numbering",
    blurb: "Receipt prefix, branch and terminal parts, padding and reset cycle.",
    paths: ["integrations.billNumbering"],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "stockNumbering",
    label: "Inventory document numbering",
    blurb: "Stock-count, receiving, request and transfer reference formats.",
    paths: [
      "integrations.stockNumbering",
      "integrations.receivingNumbering",
      "integrations.requestNumbering",
      "integrations.transferNumbering",
    ],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "region",
    label: "Region & time",
    blurb: "Country, time zone, date order and clock format.",
    paths: [
      "integrations.country",
      "integrations.timeZone",
      "integrations.dateFormat",
      "integrations.timeFormat",
    ],
    lockedByDefault: false,
    scopeFamily: "business",
  },
  {
    id: "rounding",
    label: "Cash rounding",
    blurb: "Rounding increment, mode and receipt label used at checkout.",
    paths: ["integrations.rounding"],
    lockedByDefault: true,
    scopeFamily: "business",
  },
  {
    id: "publicDomains",
    label: "Public domains",
    blurb: "Member signup and voucher redemption addresses.",
    paths: ["integrations.memberDomain", "integrations.redeemDomain"],
    lockedByDefault: true,
    scopeFamily: "business",
  },
  {
    id: "transferApproval",
    label: "Transfer approval",
    blurb: "Whether stock transfers require supervisor approval before dispatch.",
    paths: ["integrations.requireTransferApproval"],
    lockedByDefault: true,
    scopeFamily: "business",
  },
];

export type ConfigurableTier = "CLUSTER" | "BRANCH" | "TERMINAL";

export function sectionAllowsTier(section: SettingsSectionId, tier: ConfigurableTier): boolean {
  const family = SECTION_BY_ID[section]?.scopeFamily ?? "business";
  return tier === "CLUSTER" || (family === "terminal" ? tier === "TERMINAL" : tier === "BRANCH");
}

export const SECTION_BY_ID: Record<string, SettingsSectionDef> = Object.fromEntries(
  SETTINGS_SECTIONS.map((s) => [s.id, s]),
);

/** Longest matching path wins, so "integrations.baseLaborFee" beats "integrations". */
export function sectionOfPath(path: string): SettingsSectionDef | null {
  let best: SettingsSectionDef | null = null;
  let bestLen = -1;
  for (const section of SETTINGS_SECTIONS) {
    for (const owned of section.paths) {
      if ((path === owned || path.startsWith(`${owned}.`)) && owned.length > bestLen) {
        best = section;
        bestLen = owned.length;
      }
    }
  }
  return best;
}

type Bag = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Bag =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[key];
  }, source);
}

/** Immutably place `value` at a dotted path, creating the objects on the way. */
export function setPath<T extends Bag>(source: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  if (!head) return source;
  if (!rest.length) return { ...source, [head]: value };
  const child = isPlainObject(source[head]) ? (source[head] as Bag) : {};
  return { ...source, [head]: setPath(child, rest.join("."), value) };
}

/** Deep-merge an override patch over the global settings. */
export function mergePatch<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return patch as T;
  const out: Bag = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) ? mergePatch(out[key], value) : value;
  }
  return out as T;
}

/** Snapshot the values a section owns, ready to become a branch override. */
export function pickSection(settings: AppSettings, section: SettingsSectionDef): Bag {
  let patch: Bag = {};
  for (const path of section.paths) {
    const value = getPath(settings, path);
    if (value === undefined) continue;
    patch = setPath(patch, path, value);
  }
  return patch;
}

/** Every leaf path a settings patch touches, one level inside each block. */
export function patchPaths(patch: Bag, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && !prefix) paths.push(...patchPaths(value as Bag, path));
    else paths.push(path);
  }
  return paths;
}
