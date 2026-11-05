import { formatMoney } from "./currency";
import { logger } from "./audit-log";
import { sendWhatsAppBill } from "./whatsapp-client";
import { listQueuedMessages, queueMessage, resolveMessage } from "./whatsapp-queue";
import { db } from "@/core/api/pos-db";
import { getPosCallerAuth } from "./pos-caller-auth";
import { looksOffline } from "./governance-offline";
import {
  PAYMENT_LABELS,
  bookingBalance,
  lineUnitDiscount,
  r2,
  type Booking,
  type Member,
  type Sale,
  type WhatsAppSettings,
} from "@/core/types/pos-types";

const cash = formatMoney;

/** Strip formatting and apply the default dialling code to local numbers. */
export function normalizeWhatsAppNumber(raw: string, countryCode: string) {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const cc = (countryCode || "").replace(/\D/g, "");
  if (raw.trim().startsWith("+") || (cc && digits.startsWith(cc))) return digits;
  return `${cc}${digits.replace(/^0+/, "")}`;
}

const itemLines = (sale: Sale) =>
  sale.lines
    .map((l) => {
      const each = r2(l.price - lineUnitDiscount(l));
      return `• ${l.name} ×${l.qty} — ${cash(r2(each * l.qty))}${l.foc ? " (free)" : ""}`;
    })
    .join("\n");

export function buildSaleMessage(
  sale: Sale,
  company: string,
  cfg: WhatsAppSettings,
): string {
  const parts = [cfg.greeting, "", `*${company}*`, `Bill ${sale.receiptNo}`];
  if (cfg.format === "itemized") parts.push("", itemLines(sale));
  parts.push(
    "",
    `Subtotal: ${cash(sale.subtotal)}`,
    ...(sale.discount ? [`Discount: -${cash(sale.discount)}`] : []),
    ...(sale.tax ? [`Tax: ${cash(sale.tax)}`] : []),
    ...((sale.roundingAdjustment ?? 0) < 0
      ? [`${sale.roundingLabel || "Extra Discount"}: -${cash(Math.abs(sale.roundingAdjustment ?? 0))}`]
      : []),
    `*Total: ${cash(sale.total)}*`,
    `Paid by ${PAYMENT_LABELS[sale.method]}${sale.change ? ` · change ${cash(sale.change)}` : ""}`,
    ...(sale.transferRef ? [`Transfer ref: ${sale.transferRef}`] : []),
    ...(sale.pointsEarned ? [`Points earned: ${sale.pointsEarned}`] : []),
    "",
    cfg.signoff,
  );
  return parts.filter((p) => p !== undefined).join("\n");
}

export function buildBookingMessage(
  booking: Booking,
  company: string,
  cfg: WhatsAppSettings,
): string {
  return [
    cfg.greeting,
    "",
    `*${company}*`,
    `Booking ${booking.ref}`,
    ...(cfg.format === "itemized"
      ? ["", booking.lines.map((l) => `• ${l.name} ×${l.qty}`).join("\n")]
      : []),
    "",
    `Booking total: ${cash(booking.total)}`,
    `Deposit paid: ${cash(booking.paid)}`,
    `*Balance due: ${cash(bookingBalance(booking))}*`,
    `Collect by: ${new Date(booking.dueDate).toDateString()}`,
    "",
    cfg.signoff,
  ].join("\n");
}

type SendArgs = {
  cfg: WhatsAppSettings;
  /** raw customer number (member profile or typed at the till) */
  to: string;
  body: string;
  /** what the message is about, for the activity trail */
  reference: string;
  member?: Member | null;
};

/** Sends the bill and writes a human-readable entry to the activity trail. */
export async function sendBillOnWhatsApp({ cfg, to, body, reference, member }: SendArgs) {
  if (!cfg.enabled) return { ok: false, error: "WhatsApp billing is switched off in Settings" };
  if (!cfg.phoneNumberId)
    return { ok: false, error: "Add your WhatsApp phone number ID in Settings" };
  const number = normalizeWhatsAppNumber(to, cfg.countryCode);
  if (!number) return { ok: false, error: "This customer has no WhatsApp number on file" };

  const park = async () => {
    const parked = queueMessage({ phoneNumberId: cfg.phoneNumberId, to: number, body, reference });
    await db.queueWhatsAppMessage({
      id: parked.id,
      phoneNumberId: parked.phoneNumberId,
      to: parked.to,
      body: parked.body,
      reference: parked.reference,
      queuedAt: parked.queuedAt,
    });
    logger.log("messaging", "WhatsApp bill queued (offline)", "messaging", {
      reference,
      to: number,
      customer: member?.name ?? null,
    });
    return { ok: true, queued: true as const };
  };

  // No connection: park the message and tell the cashier it will go out later.
  if (typeof navigator !== "undefined" && !navigator.onLine) return park();

  const res = await sendWhatsAppBill({
    data: { ...(await getPosCallerAuth()), phoneNumberId: cfg.phoneNumberId, to: number, body },
  }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));

  logger.log(
    "messaging",
    res.ok ? "Bill sent on WhatsApp" : "WhatsApp send failed",
    "messaging",
    {
      reference,
      to: number,
      customer: member?.name ?? null,
      format: cfg.format,
      error: res.ok ? null : ("error" in res ? res.error : "unknown"),
    },
  );
  if (res.ok) return { ok: true };
  const error = ("error" in res && res.error) || "Send failed";
  return looksOffline(error) ? park() : { ok: false, error };
}


/** Flush anything queued while the till was offline. */
export async function flushWhatsAppQueue() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0 };
  let sent = 0;
  for (const msg of listQueuedMessages()) {
    const res = await sendWhatsAppBill({
      data: {
        ...(await getPosCallerAuth()),
        phoneNumberId: msg.phoneNumberId,
        to: msg.to,
        body: msg.body,
      },
    }).catch(() => ({ ok: false as const }));
    if (!res.ok) break;
    resolveMessage(msg.id);
    await db.settleWhatsAppMessage(msg.id, true);
    sent += 1;
    logger.log("messaging", "Queued WhatsApp bill sent", "messaging", {
      reference: msg.reference,
      to: msg.to,
      queuedAt: msg.queuedAt,
    });
  }
  return { sent };
}
