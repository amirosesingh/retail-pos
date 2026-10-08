/**
 * Digital coupon campaigns and the single-use vouchers issued from them.
 *
 * Campaigns are managed in the backoffice; vouchers are issued by the public
 * join / claim pages and locked at the till. Every write that must not be
 * tampered with (issuing, redeeming) goes through a database function, so the
 * browser only ever holds the publishable key.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { r2 } from "@/core/types/pos-types";
import { keyset, nextCursor, PAGE_SIZE, type Cursor, type Page } from "./keyset";
import { describeError } from "./notify";
import { routedQuery } from "@/core/api/db-query";
import { commitOps } from "@/core/api/pos-db";
import { localDb } from "@/core/local-db/local-db";

const sb = supabaseExternal as unknown as SupabaseClient;

/** Outcome of a coupon write: never throws at the caller. */
export type CouponResult = { success: boolean; error?: string };

/** Log a swallowed read failure once, with the call that produced it. */
function logRead(where: string, _error: unknown) {
  if (import.meta.env.DEV) console.error(`[coupons] ${where} failed`);
}

export type DiscountKind = "PERCENTAGE" | "FIXED_AMOUNT";
export type CampaignScope = "BILL" | "CATEGORY" | "PRODUCT";
export type VoucherStatus = "ISSUED" | "REDEEMED" | "EXPIRED" | "DISABLED";

export type Campaign = {
  id: string;
  name: string;
  slug: string;
  discountType: DiscountKind;
  discountValue: number;
  scope: CampaignScope;
  /** category name or product id, depending on `scope` */
  scopeValue?: string | null;
  /** null / undefined means unlimited */
  maxClaims?: number | null;
  /** how many vouchers one member may hold for this campaign; null = unlimited */
  maxPerMember?: number | null;
  claimsCount: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  isWelcome: boolean;
  createdAt?: string;
};

export type Voucher = {
  id: string;
  tokenSlug: string;
  campaignId: string;
  memberId: string | null;
  status: VoucherStatus;
  issuedAt: string;
  redeemedAt?: string | null;
  redeemedBy?: string | null;
  storeId?: string | null;
  /** voucher-level expiry, overrides the campaign window when set */
  expiresAt?: string | null;
  issuedBy?: string | null;
  issuedSource?: "PUBLIC" | "MANUAL" | string | null;
  redeemedSaleId?: string | null;
  /** set when a manager switches the voucher off */
  disabledAt?: string | null;
  disabledBy?: string | null;
  disableReason?: string | null;
};

export type CouponEventType =
  | "CLAIMED"
  | "ISSUED_MANUAL"
  | "REDEEMED"
  | "BLOCKED"
  | "DISABLED"
  | "REENABLED";

export type CouponEvent = {
  id: string;
  type: CouponEventType;
  campaignId: string | null;
  campaignName: string;
  token: string | null;
  memberId: string | null;
  memberPhone: string | null;
  storeId: string | null;
  terminalId: string | null;
  staffName: string | null;
  staffRole: string | null;
  saleId: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Record<string, any>;

const toCampaign = (r: Row): Campaign => ({
  id: r.id,
  name: r.name ?? "",
  slug: r.slug ?? "",
  discountType: (r.discount_type as DiscountKind) ?? "PERCENTAGE",
  discountValue: Number(r.discount_value ?? 0),
  scope: (r.scope as CampaignScope) ?? "BILL",
  scopeValue: r.scope_value ?? null,
  maxClaims: r.max_claims ?? null,
  maxPerMember: r.max_per_member ?? null,
  claimsCount: Number(r.claims_count ?? 0),
  startsAt: r.starts_at ?? null,
  expiresAt: r.expires_at ?? null,
  isActive: Boolean(r.is_active),
  isWelcome: Boolean(r.is_welcome),
  createdAt: r.created_at ?? undefined,
});

const toRow = (c: Campaign): Row => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  discount_type: c.discountType,
  discount_value: c.discountValue,
  scope: c.scope,
  scope_value: c.scopeValue || null,
  max_claims: c.maxClaims ?? null,
  max_per_member: c.maxPerMember ?? null,
  claims_count: Number.isFinite(Number(c.claimsCount)) ? Number(c.claimsCount) : 0,
  starts_at: c.startsAt || null,
  expires_at: c.expiresAt || null,
  is_active: c.isActive,
  is_welcome: c.isWelcome,
});

const toVoucher = (r: Row): Voucher => ({
  id: r.id,
  tokenSlug: r.token_slug,
  campaignId: r.campaign_id,
  memberId: r.member_id ?? null,
  status: (r.status as VoucherStatus) ?? "ISSUED",
  issuedAt: r.issued_at,
  redeemedAt: r.redeemed_at ?? null,
  redeemedBy: r.redeemed_by ?? null,
  storeId: r.store_id ?? null,
  expiresAt: r.expires_at ?? null,
  issuedBy: r.issued_by ?? null,
  issuedSource: r.issued_source ?? null,
  redeemedSaleId: r.redeemed_sale_id ?? null,
  disabledAt: r.disabled_at ?? null,
  disabledBy: r.disabled_by ?? null,
  disableReason: r.disable_reason ?? null,
});

const toEvent = (r: Row): CouponEvent => ({
  id: r.id,
  type: (r.event_type as CouponEventType) ?? "CLAIMED",
  campaignId: r.campaign_id ?? null,
  campaignName: r.campaign_name ?? "",
  token: r.voucher_token ?? null,
  memberId: r.member_id ?? null,
  memberPhone: r.member_phone ?? null,
  storeId: r.store_id ?? null,
  terminalId: r.terminal_id ?? null,
  staffName: r.staff_name ?? null,
  staffRole: r.staff_role ?? null,
  saleId: r.sale_id ?? null,
  note: r.note ?? null,
  createdAt: r.created_at,
});

export const blankCampaign = (): Campaign => ({
  id: crypto.randomUUID(),
  name: "",
  slug: "",
  discountType: "PERCENTAGE",
  discountValue: 10,
  scope: "BILL",
  scopeValue: null,
  maxClaims: null,
  maxPerMember: 1,
  claimsCount: 0,
  startsAt: null,
  expiresAt: null,
  isActive: true,
  isWelcome: false,
});

/**
 * URL-safe slug from any campaign name. Pure string work — no database call,
 * so there is nothing here that can fail at runtime.
 */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export async function loadCampaigns(): Promise<Campaign[]> {
  try {
    const rows = await routedQuery("coupon_campaigns", { orderBy: { column: "created_at", ascending: false }, limit: 2000 });
    return rows.map((row) => toCampaign(row as Row));
  } catch (e) {
    logRead("loadCampaigns", e);
    return [];
  }
}

export async function saveCampaign(c: Campaign): Promise<CouponResult> {
  try {
    await commitOps("Saving coupon campaign", [{ kind: "upsert", table: "coupon_campaigns", rows: [toRow(c)] }]);
    return { success: true };
  } catch (e) {
    return { success: false, error: describeError(e, "Saving the campaign") };
  }
}

export async function deleteCampaign(id: string): Promise<CouponResult> {
  try {
    await commitOps("Deleting coupon campaign", [{ kind: "delete", table: "coupon_campaigns", match: { id } }]);
    return { success: true };
  } catch (e) {
    return { success: false, error: describeError(e, "Deleting the campaign") };
  }
}

export async function loadCampaignBySlug(slug: string): Promise<Campaign | null> {
  try {
    const rows = await routedQuery("coupon_campaigns", { match: { slug }, limit: 1 });
    return rows[0] ? toCampaign(rows[0] as Row) : null;
  } catch (e) {
    logRead("loadCampaignBySlug", e);
    return null;
  }
}

export async function loadVouchers(campaignId?: string): Promise<Voucher[]> {
  try {
    const rows = await routedQuery("issued_vouchers", { ...(campaignId ? { match: { campaign_id: campaignId } } : {}), orderBy: { column: "issued_at", ascending: false }, limit: 2000 });
    return rows.map((row) => toVoucher(row as Row));
  } catch (e) {
    logRead("loadVouchers", e);
    return [];
  }
}

export type VoucherView = {
  voucher: Voucher;
  campaign: Campaign;
  memberName: string;
  memberCode: string;
};

/**
 * Everything the public voucher page needs, in one round trip.
 *
 * The voucher table itself is closed to anonymous readers, so a shopper's
 * link resolves through a database function that can only ever return the
 * single voucher whose token was supplied.
 */
export async function loadVoucherByToken(token: string): Promise<VoucherView | null> {
  try {
    if (localDb()?.query) {
      const voucherRows = await routedQuery("issued_vouchers", {
        match: { token_slug: token },
        limit: 1,
      });
      const voucherRow = voucherRows[0] as Row | undefined;
      if (!voucherRow) return null;
      const [campaignRows, memberRows] = await Promise.all([
        routedQuery("coupon_campaigns", {
          match: { id: voucherRow.campaign_id },
          limit: 1,
        }),
        voucherRow.member_id
          ? routedQuery("members", {
              columns: "id,full_name,member_code",
              match: { id: voucherRow.member_id },
              limit: 1,
            })
          : Promise.resolve([]),
      ]);
      const campaignRow = campaignRows[0] as Row | undefined;
      if (!campaignRow) return null;
      const member = memberRows[0] as Row | undefined;
      return {
        voucher: toVoucher(voucherRow),
        campaign: toCampaign(campaignRow),
        memberName: String(member?.full_name ?? "Retail member"),
        memberCode: String(member?.member_code ?? ""),
      };
    }
    const res = await sb.rpc("voucher_by_token", { _token: token });
    if (res.error) throw new Error(res.error.message);
    const row = ((res.data as Row[] | null) ?? [])[0];
    if (!row?.voucher || !row?.campaign) return null;
    return {
      voucher: toVoucher(row.voucher as Row),
      campaign: toCampaign(row.campaign as Row),
      memberName: (row.member_name as string) || "Retail member",
      memberCode: (row.member_code as string) || "",
    };
  } catch (e) {
    logRead("loadVoucherByToken", e);
    return null;
  }
}

/** Member's live vouchers, campaign included, for the register. */
export async function loadMemberVouchers(memberId: string): Promise<VoucherView[]> {
  try {
    const [vouchers, memberRows] = await Promise.all([
      routedQuery("issued_vouchers", { match: { member_id: memberId, status: "ISSUED" }, orderBy: { column: "issued_at", ascending: false }, limit: 500 }),
      routedQuery("members", { columns: "id,full_name,member_code", match: { id: memberId }, limit: 1 }),
    ]);
    const campaignIds = [...new Set(vouchers.map((row) => String(row.campaign_id)))];
    const campaigns = campaignIds.length ? await routedQuery("coupon_campaigns", { in: { column: "id", values: campaignIds }, limit: 500 }) : [];
    const byCampaign = new Map(campaigns.map((row) => [String(row.id), row]));
    const member = memberRows[0];
    return vouchers
      .filter((r) => byCampaign.has(String(r.campaign_id)))
      .map((r) => ({
        voucher: toVoucher(r),
        campaign: toCampaign(byCampaign.get(String(r.campaign_id)) as Row),
        memberName: String(member?.full_name ?? ""),
        memberCode: String(member?.member_code ?? ""),
      }))
      .filter((v) => !isVoucherExpired(v.voucher, v.campaign));
  } catch (e) {
    logRead("loadMemberVouchers", e);
    return [];
  }
}

/** Columns the event trail actually renders — never `*`. */
const EVENT_COLUMNS =
  "id, event_type, campaign_id, campaign_name, voucher_token, member_id, member_phone, " +
  "store_id, terminal_id, staff_name, staff_role, sale_id, note, created_at";

/**
 * Audit trail: claims, manual issues, redemptions and blocked attempts.
 *
 * Paged with a keyset cursor so the trail stays fast however long it grows —
 * each page is one index seek on `(created_at, id)` rather than an offset walk.
 */
export async function loadCouponEvents(
  opts: { campaignId?: string; cursor?: Cursor; limit?: number } = {},
): Promise<Page<CouponEvent>> {
  const limit = opts.limit ?? PAGE_SIZE;
  if (typeof window !== "undefined" && (window as unknown as { pos?: unknown }).pos) {
    const rows = await routedQuery("coupon_events", {
      columns: EVENT_COLUMNS,
      ...(opts.campaignId ? { match: { campaign_id: opts.campaignId } } : {}),
      orderBy: { column: "created_at", ascending: false },
      ...(opts.cursor ? { cursor: { column: "created_at", value: opts.cursor.ts, id: opts.cursor.id } } : {}),
      limit,
    });
    return { rows: rows.map((row) => toEvent(row as Row)), cursor: nextCursor(rows, "created_at", limit), hasMore: rows.length >= limit };
  }
  let q = sb.from("coupon_events").select(EVENT_COLUMNS);
  if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
  const res = await keyset(q as never, "created_at", opts.cursor ?? null, limit);
  if ((res as { error?: { message: string } }).error) {
    throw new Error((res as { error: { message: string } }).error.message);
  }
  const rows = (((res as { data?: Row[] | null }).data ?? []) as Row[]);
  return {
    rows: rows.map(toEvent),
    cursor: nextCursor(rows, "created_at", limit),
    hasMore: rows.length >= limit,
  };
}

/* ------------------------------ analytics -------------------------------- */

export type CampaignStats = {
  campaign: Campaign;
  issued: number;
  claimedPublic: number;
  issuedManual: number;
  redeemed: number;
  redemptionRate: number;
  /** total value of bills that used one of this campaign's vouchers */
  revenue: number;
  /** discount given away on those bills */
  discount: number;
};

/**
 * Per-campaign performance over a date range. Revenue impact is read from the
 * real bills the redeemed vouchers were attached to, not estimated.
 */
export async function loadCampaignStats(range?: {
  from?: string;
  to?: string;
}): Promise<CampaignStats[]> {
  const [campaigns, vouchers] = await Promise.all([loadCampaigns(), loadVouchers()]);
  const from = range?.from ? new Date(range.from) : null;
  const to = range?.to ? new Date(range.to) : null;
  const inRange = (iso?: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const live = vouchers.filter((v) => inRange(v.issuedAt) || inRange(v.redeemedAt));
  const saleIds = live
    .map((v) => v.redeemedSaleId)
    .filter((s): s is string => Boolean(s));

  const bills = new Map<string, { total: number; discount: number }>();
  if (saleIds.length) {
    const res = await sb
      .from("sales")
      .select("bill_number, total_amount, discount_amount, coupon_discount")
      .in("bill_number", saleIds);
    for (const r of ((res.data as Row[] | null) ?? [])) {
      bills.set(r.bill_number, {
        total: Number(r.total_amount ?? 0),
        discount: Number(r.coupon_discount ?? r.discount_amount ?? 0),
      });
    }
  }

  return campaigns.map((campaign) => {
    const mine = live.filter((v) => v.campaignId === campaign.id);
    const redeemed = mine.filter((v) => v.status === "REDEEMED");
    let revenue = 0;
    let discount = 0;
    for (const v of redeemed) {
      const bill = v.redeemedSaleId ? bills.get(v.redeemedSaleId) : undefined;
      if (!bill) continue;
      revenue += bill.total;
      discount += bill.discount;
    }
    return {
      campaign,
      issued: mine.length,
      claimedPublic: mine.filter((v) => v.issuedSource !== "MANUAL").length,
      issuedManual: mine.filter((v) => v.issuedSource === "MANUAL").length,
      redeemed: redeemed.length,
      redemptionRate: mine.length ? (redeemed.length / mine.length) * 100 : 0,
      revenue: r2(revenue),
      discount: r2(discount),
    };
  });
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Turn rows into a CSV string and hand it to the browser as a download. */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------- rpc calls ------------------------------- */

const friendly: Record<string, string> = {
  CAMPAIGN_NOT_FOUND: "That coupon link is not valid.",
  CAMPAIGN_INACTIVE: "This promotion is not running right now.",
  CAMPAIGN_NOT_STARTED: "This promotion has not started yet.",
  CAMPAIGN_EXPIRED: "This promotion has ended.",
  CAMPAIGN_FULLY_CLAIMED: "All coupons for this promotion have been claimed.",
  NEW_MEMBER_NAME_REQUIRED: "NEW_MEMBER_NAME_REQUIRED",
  VOUCHER_NOT_FOUND: "That voucher code is not recognised.",
  VOUCHER_ALREADY_REDEEMED: "This voucher has already been used.",
  VOUCHER_EXPIRED: "This voucher has expired.",
  VOUCHER_DISABLED: "This voucher has been switched off and can no longer be used.",
  MEMBER_LIMIT_REACHED: "This member has already claimed the maximum for this campaign.",
};

const explain = (message: string) => {
  const key = Object.keys(friendly).find((k) => message.includes(k));
  return key ? friendly[key]! : message;
};

/** Issue (or re-fetch) this phone number's voucher for a campaign. */
export async function claimCampaign(input: {
  slug: string;
  phone: string;
  fullName?: string;
  email?: string;
}): Promise<string> {
  const res = await sb.rpc("coupon_claim", {
    _slug: input.slug,
    _phone: input.phone,
    _full_name: input.fullName ?? null,
    _email: input.email ?? null,
  });
  if (res.error) throw new Error(explain(res.error.message));
  return res.data as string;
}

/** Register a member from the public join page; returns a welcome token if any. */
export async function joinMember(input: {
  phone: string;
  fullName: string;
  email?: string;
}): Promise<string | null> {
  const res = await sb.rpc("member_welcome_claim", {
    _phone: input.phone,
    _full_name: input.fullName,
    _email: input.email ?? null,
  });
  if (res.error) throw new Error(explain(res.error.message));
  return (res.data as string | null) ?? null;
}

/** Atomically lock a voucher at the till. Throws if it is used or expired. */
export async function redeemVoucher(input: {
  token: string;
  saleId?: string;
  storeId?: string;
  staff?: string;
}): Promise<void> {
  if (localDb()?.writeBatch) {
    const view = await loadVoucherByToken(input.token);
    if (!view) throw new Error(friendly.VOUCHER_NOT_FOUND);
    if (view.voucher.status === "REDEEMED") throw new Error(friendly.VOUCHER_ALREADY_REDEEMED);
    if (view.voucher.status === "DISABLED") throw new Error(friendly.VOUCHER_DISABLED);
    if (isVoucherExpired(view.voucher, view.campaign)) throw new Error(friendly.VOUCHER_EXPIRED);
    const status = campaignStatus(view.campaign);
    if (status === "Scheduled") throw new Error(friendly.CAMPAIGN_NOT_STARTED);
    if (status === "Off" || status === "Expired") throw new Error(friendly.CAMPAIGN_INACTIVE);

    const now = new Date().toISOString();
    await commitOps("Redeeming voucher", [
      {
        kind: "update",
        table: "issued_vouchers",
        values: {
          status: "REDEEMED",
          redeemed_at: now,
          redeemed_by: input.staff ?? null,
          redeemed_sale_id: input.saleId ?? null,
          store_id: input.storeId ?? null,
        },
        // Including the old state prevents an already-redeemed local voucher
        // from being changed by a retry. The whole batch is one SQL transaction.
        match: { id: view.voucher.id, status: "ISSUED" },
      },
      {
        kind: "insert",
        table: "coupon_events",
        rows: [
          {
            id: crypto.randomUUID(),
            event_type: "REDEEMED",
            campaign_id: view.campaign.id,
            campaign_name: view.campaign.name,
            voucher_token: view.voucher.tokenSlug,
            member_id: view.voucher.memberId,
            store_id: input.storeId ?? null,
            staff_name: input.staff ?? null,
            sale_id: input.saleId ?? null,
            created_at: now,
          },
        ],
      },
    ]);
    return;
  }
  const res = await sb.rpc("voucher_redeem", {
    _token: input.token,
    _sale_id: input.saleId ?? null,
    _store_id: input.storeId ?? null,
    _staff: input.staff ?? null,
  });
  if (res.error) throw new Error(explain(res.error.message));
}

/** Backoffice: hand a voucher to a specific member, with an optional custom expiry. */
export async function issueVoucherManually(input: {
  slug: string;
  phone: string;
  fullName?: string;
  expiresAt?: string | null;
  staff?: string;
  role?: string;
  storeId?: string;
  ignoreLimit?: boolean;
}): Promise<string> {
  const res = await sb.rpc("coupon_issue_manual", {
    _slug: input.slug,
    _phone: input.phone,
    _full_name: input.fullName ?? null,
    _expires_at: input.expiresAt ?? null,
    _staff: input.staff ?? null,
    _role: input.role ?? null,
    _store: input.storeId ?? null,
    _ignore_limit: input.ignoreLimit ?? false,
  });
  if (res.error) throw new Error(explain(res.error.message));
  return res.data as string;
}

/* ------------------------------ status helpers ---------------------------- */

/** Backoffice: switch a voucher off (or back on). Used vouchers stay locked. */
export async function setVoucherStatus(input: {
  token: string;
  status: "ISSUED" | "DISABLED";
  reason?: string | null;
  staff?: string;
  role?: string;
  storeId?: string;
}): Promise<void> {
  const res = await sb.rpc("voucher_set_status", {
    _token: input.token,
    _status: input.status,
    _reason: input.reason ?? null,
    _staff: input.staff ?? null,
    _role: input.role ?? null,
    _store: input.storeId ?? null,
  });
  if (res.error) throw new Error(explain(res.error.message));
}

/** Effective, display-ready status for a voucher (expiry resolved live). */
export function voucherState(
  v: Voucher,
  c: Campaign,
  now = new Date(),
): "Available" | "Used" | "Expired" | "Disabled" {
  if (v.status === "REDEEMED") return "Used";
  if (v.status === "DISABLED") return "Disabled";
  if (isVoucherExpired(v, c, now)) return "Expired";
  return "Available";
}

export const isExpired = (c: Campaign, now = new Date()) =>
  Boolean(c.expiresAt && now > new Date(c.expiresAt));

/** A voucher's own expiry wins over the campaign window when it is set. */
export const voucherDeadline = (v: Voucher, c: Campaign) => v.expiresAt ?? c.expiresAt ?? null;

export const isVoucherExpired = (v: Voucher, c: Campaign, now = new Date()) => {
  const deadline = voucherDeadline(v, c);
  return Boolean(deadline && now > new Date(deadline));
};

export const isScheduled = (c: Campaign, now = new Date()) =>
  Boolean(c.startsAt && now < new Date(c.startsAt));

export const isFull = (c: Campaign) =>
  c.maxClaims != null && c.claimsCount >= c.maxClaims;

export function campaignStatus(c: Campaign, now = new Date()) {
  if (!c.isActive) return "Off" as const;
  if (isExpired(c, now)) return "Expired" as const;
  if (isScheduled(c, now)) return "Scheduled" as const;
  if (isFull(c)) return "Fully claimed" as const;
  return "Live" as const;
}

export const discountLabel = (c: Campaign) =>
  c.discountType === "PERCENTAGE" ? `${c.discountValue}% off` : `${c.discountValue.toFixed(2)} off`;

export const scopeLabel = (c: Campaign) =>
  c.scope === "BILL"
    ? "whole bill"
    : c.scope === "CATEGORY"
      ? `category “${c.scopeValue ?? ""}”`
      : "one product";

/**
 * Currency value a voucher takes off, given the cart lines it applies to.
 * `base` is the eligible amount (whole bill, category lines or one product).
 */
export const voucherValue = (c: Campaign, base: number) =>
  r2(
    Math.min(
      base,
      c.discountType === "PERCENTAGE" ? (base * c.discountValue) / 100 : c.discountValue,
    ),
  );
