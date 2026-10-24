import { z } from "zod";
export const sponsorshipInput = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().min(1).max(64),
    numbering: z.object({
      prefix: z.string().regex(/^[A-Z0-9-]{1,200}$/),
      minimum: z
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER - 1),
      padding: z.number().int().min(3).max(6),
    }),
    recipient: z.string().trim().min(2).max(160),
    contact: z.string().trim().max(160).default(""),
    purpose: z.string().trim().min(3).max(400),
    lines: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(100000),
            discountType: z.enum(["amount", "percent"]).default("amount"),
            discount: z.number().finite().nonnegative().default(0),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.lines.map((line) => line.productId)).size !== value.lines.length)
      ctx.addIssue({ code: "custom", message: "Choose each product once" });
  });
export type SponsorshipLine = {
  product_id: string;
  name: string;
  sku: string;
  barcode: string;
  quantity: number;
  unit_value: number;
  discount?: number;
  discount_type?: "amount" | "percent";
  discount_amount?: number;
  line_value?: number;
  unit_cost?: number;
};
export type SponsorshipRecord = {
  id: string;
  reference: string;
  store_id: string;
  store_name: string;
  recipient_name: string;
  recipient_contact: string;
  purpose: string;
  lines: SponsorshipLine[];
  total_value: number;
  document_hash: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  status: string;
  given_at: string | null;
  given_by: string | null;
  given_by_name: string | null;
  received_by: string | null;
  approved_by_name: string | null;
  authorization_mode?: "approval" | "direct";
  approval_status?: string;
  approval_note?: string;
};
export function sponsorshipApprovalPayload(record: SponsorshipRecord) {
  return {
    sponsorship_id: record.id,
    document_hash: record.document_hash,
    sponsorship_reference: record.reference,
  };
}
export function sponsorshipSnapshot(record: SponsorshipRecord) {
  const subtotal = record.lines.reduce((sum, line) => sum + line.quantity * line.unit_value, 0);
  const discount = record.lines.reduce((sum, line) => sum + (line.discount_amount ?? 0), 0);
  return {
    ticketId: record.reference.slice(0, 80),
    capturedAt: record.created_at,
    storeId: record.store_id,
    terminalId: "",
    cashier: record.created_by_name,
    lines: record.lines.map((line) => ({
      sku: line.product_id,
      name: line.name,
      qty: line.quantity,
      unitPrice: line.unit_value,
      discount: line.discount_amount ?? 0,
      lineTotal: line.line_value ?? line.unit_value * line.quantity,
    })),
    subtotal,
    discount,
    tax: 0,
    serviceCharge: 0,
    total: record.total_value,
    requestedValue: record.total_value,
    requestedLabel: `Sponsorship to ${record.recipient_name}`.slice(0, 120),
  };
}
export function visibleSponsorship(
  record: SponsorshipRecord,
  costAllowed: boolean,
): SponsorshipRecord {
  return {
    ...record,
    lines: record.lines.map((line) => {
      const { unit_cost, ...rest } = line;
      return costAllowed ? { ...rest, unit_cost } : rest;
    }),
  };
}

/** Draft display only. The database repeats price and discount validation. */
export function sponsorshipLineAmounts(
  price: number,
  quantity: number,
  discount: number,
  type: "amount" | "percent",
) {
  const gross = Math.round(price * quantity * 100) / 100;
  const reduction =
    Math.round((type === "percent" ? (gross * discount) / 100 : discount) * 100) / 100;
  return {
    gross,
    discount: reduction,
    total: Math.round((gross - reduction) * 100) / 100,
    valid:
      Number.isFinite(reduction) &&
      discount >= 0 &&
      reduction <= gross &&
      (type !== "percent" || discount <= 100),
  };
}
