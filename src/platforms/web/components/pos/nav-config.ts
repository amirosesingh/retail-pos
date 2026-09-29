import {
  ArrowLeftRight,
  Boxes,
  Building2,
  ClipboardCheck,
  ListPlus,
  PauseCircle,
  CalendarClock,
  Clock,
  LayoutGrid,
  MonitorPlay,
  Percent,
  ScanBarcode,
  ScanEye,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Users,
  UserCog,
  Wallet,
  BarChart3,
  Activity,
  TicketPercent,
  PackageSearch,
  BellRing,
} from "lucide-react";

import type { PermissionFlag, PermissionTag } from "@/lib/permissions";

export type NavFlag = PermissionFlag;

export type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  flag?: NavFlag;
  /** Which roles this entry is meant for. Defaults to the tag of `flag`. */
  tag?: PermissionTag;
  adminOnly?: boolean;
  search?: Record<string, string>;
  /** Settings page section to expand when this item is opened. */
  section?: string;
  hash?: string;
  keywords?: string;
  /** One-line description shown on the section hub cards. */
  blurb?: string;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: typeof LayoutGrid;
  /** Landing page listing every option in this group. */
  hubTo: string;
  blurb?: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: "register",
    label: "Register & Selling",
    icon: Wallet,
    hubTo: "/sales",
    blurb: "Selling, shifts, receipts and promotions.",
    items: [
      {
        to: "/",
        search: { sell: "1" },
        label: "Register POS",
        icon: LayoutGrid,
        keywords: "checkout cart sale",
        blurb: "Scan, discount and charge a ticket.",
      },
      {
        to: "/holds",
        label: "Hold Tickets",
        icon: PauseCircle,
        keywords: "held parked draft ticket resume switch park",
        blurb: "Reopen parked tickets and see who cleared or voided them.",
      },
      {
        to: "/shifts",
        label: "Shift Management",
        icon: Clock,
        flag: "can_close_shift",
        keywords: "open close drawer z-report",
        blurb: "Open and close the drawer, print the Z-report.",
      },
      {
        to: "/receipts",
        label: "Bill Search & History",
        icon: ScrollText,
        flag: "can_view_sales_reports",
        keywords: "invoice receipt reprint",
        blurb: "Find any past bill and reprint it.",
      },
      {
        to: "/display",
        label: "Customer Display",
        icon: MonitorPlay,
        keywords: "second screen customer facing transfer qr",
        blurb: "Second screen facing the customer.",
      },
      {
        to: "/promotions",
        label: "Promotions & Discounts",
        icon: Percent,
        adminOnly: true,
        flag: "can_manage_promotions",
        keywords: "foc birthday tier threshold",
        blurb: "FOC items, birthday and threshold offers.",
      },
      {
        to: "/promotions",
        label: "Point Rules",
        icon: Sparkles,
        adminOnly: true,
        flag: "can_manage_promotions",
        hash: "points",
        keywords: "loyalty points per dollar policy",
        blurb: "Loyalty points earned per dollar spent.",
      },
      {
        to: "/coupons",
        label: "Coupon Campaigns",
        icon: TicketPercent,
        adminOnly: true,
        flag: "can_manage_promotions",
        keywords: "coupon voucher campaign claim link qr welcome member signup",
        blurb: "Digital coupon campaigns, claim links and voucher tracking.",
      },
    ],
  },
  {
    id: "bookings",
    label: "Bookings & Services",
    icon: CalendarClock,
    hubTo: "/bookings",
    blurb: "Job cards, deposits and service turnaround.",
    items: [
      {
        to: "/bookings",
        label: "Bookings / Pay Later",
        icon: CalendarClock,
        flag: "can_manage_bookings",
        keywords: "layaway reserve deposit balance due collect",
        blurb: "Deposits, balances due and collections.",
      },
      {
        to: "/pos/general-booking",
        label: "General Booking",
        icon: CalendarClock,
        flag: "can_manage_bookings",
        keywords: "appointment reservation service booking new",
        blurb: "Take a general service booking with a deposit.",
      },
      {
        to: "/pos/racket-service",
        label: "Racket Service",
        icon: ClipboardCheck,
        flag: "can_manage_bookings",
        keywords: "stringing racket job card tension grip",
        blurb: "Stringing job cards from drop-off to collection.",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    hubTo: "/inventory-hub",
    blurb: "Catalog, purchasing, transfers and approvals.",
    items: [
      {
        to: "/inventory",
        label: "Inventory Catalog",
        icon: Boxes,
        flag: "can_view_inventory",
        keywords: "stock products import",
        blurb: "Products, prices, stock counts and bulk import.",
      },
      {
        to: "/stock-operations",
        label: "Stock Operations",
        icon: ScanBarcode,
        flag: "can_adjust_stock",
        keywords: "count adjust scan barcode variance import",
        blurb: "Barcode physical counts, adjustments and bulk imports.",
      },
      {
        to: "/purchasing",
        label: "Purchasing",
        icon: ScanBarcode,
        flag: "can_receive_purchase_order",
        keywords: "po invoice receiving barcode",
        blurb: "Purchase orders and goods receiving.",
      },
      {
        to: "/receiving",
        label: "Goods Receiving",
        icon: ClipboardCheck,
        flag: "can_receive_transfer",
        keywords: "receive delivery count blind arrival post stock",
        blurb: "Count arriving deliveries in and post them to the shelf.",
      },
      {
        to: "/requests",
        label: "Stock Requests",
        icon: ListPlus,
        flag: "can_create_transfer",
        keywords: "request ask branch supply approval",
        blurb: "Ask another branch for stock and track every request.",
      },
      {
        to: "/transfers",
        label: "Stock Transfers",
        icon: ArrowLeftRight,
        flag: "can_create_transfer",
        keywords: "request move branch",
        blurb: "Move or request stock between branches.",
      },
      {
        to: "/suppliers",
        label: "Suppliers",
        icon: Truck,
        flag: "can_receive_purchase_order",
        keywords: "vendor supplier contact directory purchasing",
        blurb: "Central supplier directory used when receiving goods.",
      },
      {
        to: "/verifications",
        label: "Verification Log",
        icon: ShieldCheck,
        flag: "can_view_member_history",
        keywords: "otp verify code sms whatsapp email member",
        blurb: "Every one-time code sent to a member and whether it was confirmed.",
      },
      {
        to: "/approvals",
        label: "Pending Approvals",
        icon: ShieldCheck,
        keywords: "authorisation approval request override pin queue",
        blurb: "Decide the actions waiting on an authorisation.",
      },
    ],
  },
  {
    id: "people",
    label: "People",
    icon: Users,
    hubTo: "/customers",
    blurb: "Customers, members, staff and admin.",
    items: [
      {
        to: "/members",
        label: "Member Directory",
        icon: Users,
        flag: "can_add_member",
        keywords: "loyalty customer history",
        blurb: "Loyalty members, tiers and purchase history.",
      },
      {
        to: "/staff",
        label: "Staff Management",
        icon: UserCog,
        adminOnly: true,
        flag: "can_manage_staff",
        keywords:
          "employees users roles permissions cashier supervisor pin account matrix duty store",
        blurb: "Accounts, PINs, roles and the permission matrix.",
      },
      {
        to: "/admin",
        label: "Admin",
        icon: ShieldCheck,
        adminOnly: true,
        keywords: "administration tools console owner",
        blurb: "Administrator tools for the whole company.",
      },
    ],
  },
  {
    id: "company",
    label: "Company",
    icon: Building2,
    hubTo: "/admin",
    blurb: "Stores, live boards and the audit trail.",
    items: [
      {
        to: "/stores",
        label: "Locations / Warehouses",
        icon: Store,
        adminOnly: true,
        flag: "can_manage_locations",
        keywords: "branch store warehouse",
        blurb: "Every storefront and warehouse you operate.",
      },
      {
        to: "/all-shops",
        label: "All Shops Panel",
        icon: PackageSearch,
        flag: "can_view_inventory",
        keywords: "group branches multi store stock overview live",
        blurb: "Live takings and stock for every branch in one table.",
      },
      {
        to: "/dashboard",
        label: "Live Dashboard",
        icon: Activity,
        flag: "can_view_dashboard",
        keywords: "revenue profit margin peak hours charts kpi review flags",
        blurb: "Revenue, profit and peak hours as they happen.",
      },
      {
        to: "/analytics",
        label: "Live Business Board",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "all shops combined pie chart top items margin discount coupon share trend",
        blurb: "Every shop combined: top sellers, share, margin and giveaways.",
      },
      {
        to: "/audit",
        label: "Audit Logs & Activity",
        icon: ScanEye,
        adminOnly: true,
        flag: "can_view_audit_trail",
        keywords: "telemetry trail compliance logs sync",
        blurb: "Who did what, when, on which terminal.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    hubTo: "/reports",
    blurb: "Sales, coupons, activity and stock reporting.",
    items: [
      {
        to: "/reports",
        label: "Reports Centre",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "analytics hub summary",
        blurb: "All reporting in one place.",
      },
      {
        to: "/reports/sales",
        label: "Sales Summary",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "revenue tender discount tax cashier",
        blurb: "Revenue, discounts, tax and tender mix.",
      },
      {
        to: "/reports/items",
        label: "Item Sales History",
        icon: PackageSearch,
        flag: "can_view_sales_reports",
        keywords: "item line product sold cost margin profit date time cashier price",
        blurb: "Every item sold with cost price, margin and profit.",
      },
      {
        to: "/reports/stock",
        label: "Stock Adjustments",
        icon: PackageSearch,
        flag: "can_view_sales_reports",
        keywords: "stock check calibration variance damage loss shrinkage adjust",
        blurb: "Stock checks, damages, losses and variance.",
      },
      {
        to: "/reports/payments",
        label: "Payments by Cashier",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "payment cashier cash card machine tender split takings",
        blurb: "Every transaction taken, per cashier and tender.",
      },
      {
        to: "/reports/voids",
        label: "Voids & Refunds",
        icon: Activity,
        flag: "can_view_sales_reports",
        keywords: "void refund cancel line removed reason approval",
        blurb: "Who voided, cancelled or refunded, and why.",
      },
      {
        to: "/reports/history",
        label: "Edit History",
        icon: Activity,
        flag: "can_view_audit_trail",
        keywords: "audit trail immutable override void discount permission login attempt",
        blurb: "Permanent record of overrides, account and permission changes.",
      },
      {
        to: "/reports/activity",
        label: "Register Activity",
        icon: Activity,
        flag: "can_view_audit_trail",
        keywords: "hold resume void split drawer timeline",
        blurb: "Holds, voids, splits and drawer opens in order.",
      },
      {
        to: "/reports/business",
        label: "Retail Performance",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "profit margin velocity days cover slow mover cashier performance average bill",
        blurb: "Profit by product, stock movement speed and cashier takings.",
      },
      {
        to: "/reports/catalog",
        label: "Catalog Changes",
        icon: PackageSearch,
        flag: "can_view_sales_reports",
        keywords: "product price stock history timestamp",
        blurb: "Products added, prices and stock edited.",
      },
      {
        to: "/reports/analytics",
        label: "Business Analytics",
        icon: BarChart3,
        flag: "can_view_sales_reports",
        keywords: "chart graph top selling shop revenue daily monthly average savings profit",
        blurb: "Top sellers, shop revenue, trends, savings and profit.",
      },
      {
        to: "/reports/notifications",
        label: "Activity & Notifications",
        icon: Activity,
        flag: "can_view_audit_trail",
        keywords: "notification alert whatsapp sign in shift sale drawer feed",
        blurb: "Live event feed with WhatsApp delivery status and CSV export.",
      },
      {
        to: "/alerts",
        label: "Alerts History",
        icon: BellRing,
        flag: "can_view_audit_trail",
        keywords: "alerts warnings critical stock variance security history",
        blurb: "Search, filter and open every warning and critical system alert.",
      },
      {
        to: "/reports/coupons",
        label: "Coupon Usage",
        icon: TicketPercent,
        flag: "can_view_sales_reports",
        keywords: "coupon promotion discount bill item applied",
        blurb: "Every coupon applied, bill or item level.",
      },
    ],
  },
];

export const navItemKey = (i: NavItem) => `${i.to}#${i.hash ?? ""}?${i.section ?? ""}`;

/** Top-level entries pinned above the groups in the sidebar. */
export const standaloneNavItems: NavItem[] = [];
export { Store };

/**
 * Route access comes from the same navigation registry that decides whether a
 * link is visible. Only non-navigation settings routes need explicit entries.
 * Longest prefix wins so child settings pages may tighten their parent gate.
 */
const ROUTE_PERMISSION_OVERRIDES: Record<string, PermissionFlag> = {
  "/settings/terminals": "can_manage_terminals",
  "/settings/mobile-terminals": "can_manage_terminals",
  "/settings/sessions": "can_manage_terminals",
  "/settings/database": "can_manage_sync_backup",
  "/settings": "can_access_pos_settings",
};

const NAV_ROUTE_PERMISSIONS: Record<string, PermissionFlag> = Object.fromEntries(
  navGroups.flatMap((group) =>
    group.items
      .filter((item): item is NavItem & { flag: PermissionFlag } => Boolean(item.flag))
      .map((item) => [item.to, item.flag]),
  ),
);

export function routePermissionForPath(pathname: string): PermissionFlag | null {
  const routes = { ...NAV_ROUTE_PERMISSIONS, ...ROUTE_PERMISSION_OVERRIDES };
  const key =
    Object.keys(routes)
      .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0] ?? "";
  return routes[key] ?? null;
}
