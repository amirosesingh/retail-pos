import { z } from "zod";

const money = z.number().finite().nonnegative().max(100000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places");
export const missedBillInput = z.object({
  sessionToken: z.string().min(10).optional(), accessToken: z.string().optional(),
  terminalToken: z.string().optional(), cashierToken: z.string().optional(),
  storeId: z.string().trim().min(1).max(128), clientKey: z.string().uuid(),
  originalReference: z.string().trim().max(128), occurredAt: z.string().datetime({ offset: true }),
  cashierId: z.string().trim().min(1).max(64), originalShiftId: z.string().uuid().nullable(),
  reason: z.string().trim().min(3).max(500),
  stockHandling: z.enum(["deduct", "already_corrected"]), stockReason: z.string().trim().min(3).max(500),
  items: z.array(z.object({
    productId: z.string().uuid(), quantity: z.number().int().min(1).max(100000),
    unitPrice: money, unitCost: money, discountAmount: money, taxAmount: money,
  }).refine(item => item.discountAmount <= item.unitPrice * item.quantity, "Discount exceeds line amount")).min(1).max(500),
  payments: z.array(z.object({ method: z.enum(["cash", "card", "bank_transfer", "wallet"]), amount: money.refine(value => value > 0) })).min(1).max(20),
}).refine(input => new Set(input.items.map(item => item.productId.toLowerCase())).size === input.items.length, "Combine duplicate products into one line");
export type MissedBillInput = z.infer<typeof missedBillInput>;
