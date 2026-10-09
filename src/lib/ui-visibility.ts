import { pageForRoute, pageEnabled } from "./permission-pages";
/**
 * Admin-controlled screen visibility.
 *
 * The permission matrix decides what a person is *allowed* to do; this decides
 * what they can *see*. There is no third, hidden layer: whatever an
 * administrator switches here is what the role gets, immediately.
 *
 * The only exception is a small set of owner-only screens (staff, terminals,
 * database, security, billing identity). Those can never be handed to another role
 * by accident, and are marked `ownerOnly`.
 *
 * Admins are never hidden from anything, so a bad toggle cannot lock the owner
 * out of their own install.
 */
import { useCallback, useMemo } from "react";
import { usePos } from "./pos-store";
import { useAuth } from "@/lib/pos-auth";
import type { StaffRole } from "./permissions";

export type VisibilityRole = Exclude<StaffRole, "admin">;

export const VISIBILITY_ROLES: { id: VisibilityRole; label: string }[] = [
  { id: "cashier", label: "Cashier" },
  { id: "supervisor", label: "Supervisor" },
  { id: "warehouse", label: "Warehouse" },
];

/**
 * How tightly a screen is locked.
 * - `core`: never grantable — it could hand over the whole install.
 * - `sensitive`: grantable, but hidden from every role until an admin says so.
 * - `none`: an ordinary day-to-day screen, visible unless hidden.
 */
export type VisibilityLock = "core" | "sensitive" | "none";

export type VisibilityElement = {
  key: string;
  label: string;
  blurb: string;
  group: string;
  /** Route this element hides. Set for whole screens such as settings pages. */
  route?: string;
  lock?: VisibilityLock;
  /** Legacy alias: true only for the locked core screens. */
  ownerOnly?: boolean;
};

/** Every element an administrator can hide, grouped by the screen it lives on. */
export const VISIBILITY_ELEMENTS: VisibilityElement[] = [
  {
    key: "workspace.shiftStatus",
    label: "Workspace shift status",
    blurb: "Open or closed shift card on the landing workspace.",
    group: "Workspace overview",
  },
  {
    key: "workspace.todayBills",
    label: "Workspace today's bills",
    blurb: "Number of completed bills today for the current branch.",
    group: "Workspace overview",
  },
  {
    key: "workspace.todayRevenue",
    label: "Workspace today's revenue",
    blurb: "Sales value completed today for the current branch.",
    group: "Workspace overview",
  },
  {
    key: "workspace.lowStock",
    label: "Workspace low-stock count",
    blurb: "Number of current-branch products at or below reorder level.",
    group: "Workspace overview",
  },
  {
    key: "register.transactionActions",
    label: "Transaction actions card",
    blurb: "Hold order, void cart, apply coupon and split bill.",
    group: "Register POS",
  },
  {
    key: "register.paymentExecution",
    label: "Payment execution card",
    blurb: "The cash / card / wallet charge buttons deck.",
    group: "Register POS",
  },
  {
    key: "register.exchange",
    label: "Exchange button",
    blurb: "Start an exchange against an earlier bill.",
    group: "Register POS",
  },
  {
    key: "register.coupon",
    label: "Apply coupon",
    blurb: "Coupon entry on the ticket.",
    group: "Register POS",
  },
  {
    key: "register.splitBill",
    label: "Split bill",
    blurb: "Split the balance across several tenders.",
    group: "Register POS",
  },
  {
    key: "register.holdOrder",
    label: "Hold order",
    blurb: "Park the ticket and recall it later.",
    group: "Register POS",
  },
  {
    key: "sales.heldOrders",
    label: "Held tickets page",
    blurb: "The list and details of parked tickets.",
    group: "Sales & Operations",
    route: "/holds",
  },
  {
    key: "register.closeShift",
    label: "Close shift button",
    blurb: "Close the shift straight from the register header.",
    group: "Register POS",
  },
  {
    key: "register.customerDisplay",
    label: "Customer display shortcut",
    blurb: "Open the second, customer-facing screen.",
    group: "Register POS",
  },
  {
    key: "sales.receiptHistory",
    label: "Bill search & history",
    blurb: "Look up and reprint earlier bills.",
    group: "Sales & Operations",
    route: "/receipts",
  },
  {
    key: "sales.bookings",
    label: "Bookings / pay later",
    blurb: "Deposits, balances and collections.",
    group: "Sales & Operations",
    route: "/bookings",
  },

  {
    key: "inventory.costColumns",
    label: "Cost & margin columns",
    blurb: "Cost price, landed cost and margin in inventory tables.",
    group: "Inventory",
  },
  {
    key: "inventory.stockValue",
    label: "Stock value totals",
    blurb: "Money value of stock on hand.",
    group: "Inventory",
  },
];

/**
 * Whole settings pages an administrator can hide from a role.
 *
 * The last column is the lock level. Only four screens stay with the owner
 * whatever the switches say — the access screen itself, terminal activation
 * and sync — because handing those over hands over the install. Money and
 * system screens are `sensitive`: an admin can grant them, but they are hidden
 * from every role until that happens. Everything else is an ordinary page.
 */
export const SETTINGS_VISIBILITY_ELEMENTS: VisibilityElement[] = (
  [
    ["/settings/display", "Display & text size", "Interface scale, density and theme.", "none"],
    ["/settings/updates", "Software updates", "App version and background updates.", "sensitive"],
    ["/settings/terminals", "Terminal activation", "Register tills and activation codes.", "none"],
    ["/settings/admin-terminals", "Admin terminal activation", "Cloud-only admin browser registrations.", "core"],
    [
      "/settings/mobile-terminals",
      "Mobile terminals",
      "Phones and tablets running the POS.",
      "none",
    ],
    [
      "/settings/sessions",
      "Active sessions",
      "Who is signed in, with remote sign-out.",
      "sensitive",
    ],
    ["/settings/printer", "Receipt printer", "Device, margins, drawer pin, test print.", "none"],
    ["/settings/elements", "Receipt elements", "Paper size, logo, points and barcode.", "none"],
    ["/settings/type", "Receipt typography", "Fonts, sizes and spacing on slips.", "none"],
    ["/settings/lines", "Receipt extra lines", "Policy notes and opening hours.", "none"],
    ["/settings/qr", "Receipt QR code", "QR payload, size and placement.", "none"],
    ["/settings/receipt-designer", "Receipt designer", "Lay the slip out visually.", "none"],
    ["/settings/booking-slip", "Booking slip wording", "Terms and the signature line.", "none"],
    ["/settings/identity", "Business identity", "Company name, tax numbers, header.", "sensitive"],
    ["/settings/tax", "Tax & pricing", "Global tax rate and inclusive pricing.", "sensitive"],
    [
      "/settings/rules",
      "POS rules & enforcement",
      "Shift, discount and refund limits.",
      "sensitive",
    ],
    ["/settings/sku", "SKU numbering", "Automatic product codes.", "none"],
    ["/settings/numbering", "Bill numbering", "Branch, till and running number.", "sensitive"],
    ["/settings/catalog", "Categories & units", "Category groups and units of measure.", "none"],
    ["/settings/region", "Region & time", "Country, time zone and clock format.", "sensitive"],
    ["/settings/visibility", "Roles & access", "What each role may do and see.", "core"],
    ["/settings/access", "Roles & access", "What each role may do and see.", "core"],
    ["/settings/payment", "Bank transfer details", "Bank account and payment QR.", "sensitive"],
    [
      "/settings/payment-methods",
      "Payment methods",
      "Tenders cashiers can collect at checkout.",
      "sensitive",
    ],
    ["/settings/accounts", "Payment accounts", "Card machines, banks and e-wallets.", "sensitive"],
    ["/settings/services", "Booking services", "Jobs and their default fee.", "none"],
    ["/settings/whatsapp", "WhatsApp bills", "Send receipts over WhatsApp.", "sensitive"],
    [
      "/settings/database",
      "Database connection",
      "Central Supabase credentials and status.",
      "core",
    ],
    [
      "/settings/system",
      "System status & integrations",
      "Connection health and public domains.",
      "sensitive",
    ],
    [
      "/settings/security-alerts",
      "Security alerts",
      "Scan findings and posture checks.",
      "sensitive",
    ],
    ["/settings/logic-health", "Logic health", "Relational flow checks.", "sensitive"],
    ["/settings/branch-telemetry", "Branch telemetry", "Heartbeats from every till.", "sensitive"],
    ["/settings/notifications", "Notifications", "Where alerts are delivered.", "sensitive"],
    ["/settings/shift-alerts", "Shift alerts", "How the day-end summary is delivered.", "none"],
    ["/settings/booking-rules", "Booking rules", "Deposits, timing and liability wording.", "none"],
    ["/settings/hardware", "Hardware", "Scanners, drawers and displays.", "none"],
    [
      "/settings/inheritance",
      "Settings inheritance",
      "Global, cluster and branch tiers.",
      "sensitive",
    ],
  ] as const
).map(([route, label, blurb, lock]) => ({
  key: `route:${route}`,
  label,
  blurb,
  group: "Settings pages",
  route,
  lock: lock as VisibilityLock,
  ownerOnly: lock === "core",
}));

VISIBILITY_ELEMENTS.push(...SETTINGS_VISIBILITY_ELEMENTS);

/** Every element that stands for a whole screen, settings or otherwise. */
const ROUTE_ELEMENTS = VISIBILITY_ELEMENTS.filter((e) => e.route);

const LOCK_BY_KEY = new Map(VISIBILITY_ELEMENTS.map((e) => [e.key, e.lock ?? "none"]));

/** Sensitive screens are hidden from every role until an admin grants them. */
export const lockFor = (key: string): VisibilityLock => LOCK_BY_KEY.get(key) ?? "none";

/** Where an explicit grant for a sensitive element is stored. */
const grantKey = (key: string) => `grant:${key}`;

/** Screens the owner keeps whatever the switches say. */
export const isOwnerOnlyRoute = (path: string): boolean => routeElementFor(path)?.lock === "core";

function routeElementFor(path: string): VisibilityElement | undefined {
  return ROUTE_ELEMENTS.filter((e) => path === e.route || path.startsWith(`${e.route}/`)).sort(
    (a, b) => (b.route?.length ?? 0) - (a.route?.length ?? 0),
  )[0];
}

/**
 * Can someone holding `role` open `path`? Only two things decide it: the
 * owner-only marker, and the switch an administrator set. Administrators are
 * never blocked.
 */
export function isRouteVisibleFor(
  hidden: VisibilityMap,
  path: string,
  role: string | null,
): boolean {
  if (!role || role === "admin") return true;
  const match = routeElementFor(path);
  if (!match) return true;
  if (match.lock === "core") return false;
  return isVisibleFor(hidden, match.key, role);
}

export const VISIBILITY_GROUPS = Array.from(new Set(VISIBILITY_ELEMENTS.map((e) => e.group)));

export type VisibilityMap = Record<string, string[]>;

/**
 * True when this element should be shown to someone holding `role`.
 *
 * Ordinary elements are visible until an administrator hides them. Sensitive
 * screens work the other way round: they stay hidden until an administrator
 * grants them to that role, so relaxing a lock never opens anything by itself.
 */
export function isVisibleFor(hidden: VisibilityMap, key: string, role: string | null): boolean {
  if (!role || role === "admin") return true;
  const lock = lockFor(key);
  if (lock === "core") return false;
  if (lock === "sensitive") return (hidden[grantKey(key)] ?? []).includes(role);
  return !(hidden[key] ?? []).includes(role);
}

/** The stored map after showing / hiding `key` for `forRole`. */
export function withVisibility(
  hidden: VisibilityMap,
  key: string,
  forRole: VisibilityRole,
  hide: boolean,
): VisibilityMap {
  const sensitive = lockFor(key) === "sensitive";
  // Sensitive rows keep an allow-list; everything else keeps a deny-list.
  const storeKey = sensitive ? grantKey(key) : key;
  const listed = sensitive ? !hide : hide;
  const current = new Set(hidden[storeKey] ?? []);
  if (listed) current.add(forRole);
  else current.delete(forRole);
  const next: VisibilityMap = { ...hidden, [storeKey]: [...current] };
  if (!next[storeKey].length) delete next[storeKey];
  return next;
}

/**
 * `visible("register.holdOrder")` — the one call screens use.
 * Everything is visible until an administrator hides it.
 */
export function useVisibility() {
  const { state, updateSettings } = usePos();
  const { user, isAdmin } = useAuth();
  const hidden = useMemo(
    () => (state.settings.visibility?.hidden ?? {}) as VisibilityMap,
    [state.settings.visibility?.hidden],
  );
  // Prefer the person's real level so a supervisor can be hidden from a page
  // even though the till treats them as elevated. Only true admins see all.
  const role = (user?.metaRole ?? (isAdmin ? "admin" : user?.role) ?? "cashier") as string;

  const visible = useCallback((key: string) => isVisibleFor(hidden, key, role), [hidden, role]);

  const visibleRoute = useCallback(
    (path: string) => {
      const page = pageForRoute(path);
      return (isAdmin || !page || pageEnabled(user?.permissions ?? {}, page.id)) && isRouteVisibleFor(hidden, path, role);
    },
    [hidden, role, user?.permissions, isAdmin],
  );

  const setHidden = useCallback(
    (key: string, forRole: VisibilityRole, hide: boolean) => {
      updateSettings({ visibility: { hidden: withVisibility(hidden, key, forRole, hide) } });
    },
    [hidden, updateSettings],
  );

  return { hidden, role, visible, visibleRoute, setHidden };
}
