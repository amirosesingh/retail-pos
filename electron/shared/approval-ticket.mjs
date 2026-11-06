import { r2, lineDiscountTotal } from "./discount-math.mjs";
import { ticketDiscountApprovalPercent } from "./approval-authority.mjs";

/**
 * Validate the complete raw native bill before the existing privacy projection.
 * The caller's denominator is context, never independent approval authority.
 * Audit normalization below deliberately keeps its existing byte semantics.
 */
export function nativeTicketDiscountPercent(snapshot, entries) {
    if (!snapshot || !Array.isArray(snapshot.lines) || !snapshot.lines.length ||
        ![snapshot.cartDiscount, snapshot.promoDiscount].every(Number.isFinite) ||
        snapshot.cartDiscount < 0 || snapshot.promoDiscount < 0 ||
        !["amount", "percent"].includes(snapshot.cartDiscountType)) return null;
    const lineInputs = [];
    const expected = [];
    for (let index = 0; index < snapshot.lines.length; index++) {
        const line = snapshot.lines[index];
        if (!line || ![line.qty, line.unitPrice, line.discount, line.couponDiscount, line.lineTotal].every(Number.isFinite) ||
            line.discount < 0 || !["amount", "percent"].includes(line.discountType)) return null;
        const input = { price: line.unitPrice, qty: line.qty, discount: line.discount,
            discountType: line.discountType, couponDiscount: line.couponDiscount };
        if (line.lineTotal !== r2(input.price * input.qty - Math.sign(input.qty) * lineDiscountTotal(input))) return null;
        lineInputs.push(input);
        // Match the current register: returns/zero quantities request no item discount.
        if (line.discount > 0 && line.qty > 0) expected.push({ index, productId: line.sku, qty: line.qty,
            price: line.unitPrice, type: line.discountType, value: line.discount,
            base: Math.max(0, Math.abs(line.unitPrice) - Math.abs(line.couponDiscount) / Math.abs(line.qty)) });
    }
    const subtotal = r2(lineInputs.reduce((sum, line) => sum + line.price * line.qty, 0));
    const lineDiscount = r2(lineInputs.reduce((sum, line) => sum + lineDiscountTotal(line) * (line.qty < 0 ? -1 : 1), 0));
    const base = r2(subtotal - lineDiscount);
    // Same operations/order as cartTotals: automatic discounts remain separate
    // from the manual discount that is being approved.
    const billDiscount = r2(Math.min(Math.max(0, base), Math.max(0,
        r2(snapshot.cartDiscountType === "percent" ? base * (snapshot.cartDiscount || 0) / 100 : snapshot.cartDiscount || 0) + Math.max(0, r2(snapshot.promoDiscount || 0)))));
    if (snapshot.subtotal !== subtotal || snapshot.discount !== r2(lineDiscount + billDiscount)) return null;
    if (snapshot.cartDiscount > 0) expected.push({ index: -1, productId: "", qty: 1, price: 0,
        type: snapshot.cartDiscountType, value: snapshot.cartDiscount, base: Math.max(0, base) });
    if (!expected.length || expected.length !== entries.length || new Set(entries.map(entry => entry.index)).size !== entries.length) return null;
    if (expected.some(wanted => {
        const actual = entries.find(entry => entry.index === wanted.index);
        return !actual || Object.keys(wanted).some(key => actual[key] !== wanted[key]);
    })) return null;
    return ticketDiscountApprovalPercent(entries);
}

/** Exact existing bounded snapshot normalization/privacy projection; no I/O. */
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};
const text = (v, max = 200) => String(v ?? "").slice(0, max);
export function maskSnapshotPhone(value) {
    const raw = text(value, 60).trim();
    if (!raw)
        return "";
    if (raw.includes("•"))
        return raw;
    const visible = raw.slice(-4);
    return `${"•".repeat(Math.min(6, Math.max(2, raw.length - visible.length)))} ${visible}`;
}
export function maskSnapshotEmail(value) {
    const raw = text(value, 160).trim();
    if (!raw)
        return "";
    if (raw.includes("•"))
        return raw;
    const at = raw.indexOf("@");
    if (at <= 0)
        return `${raw.slice(0, 1)}•••`;
    return `${raw.slice(0, 1)}•••${raw.slice(at)}`;
}
export function normalizeSnapshot(input) {
    if (!input || typeof input !== "object")
        return null;
    const row = input;
    const rawLines = Array.isArray(row["lines"]) ? row["lines"] : [];
    const lines = rawLines.slice(0, 300).map((l) => {
        const line = (l ?? {});
        return {
            sku: text(line["sku"], 60),
            name: text(line["name"], 160),
            qty: num(line["qty"]),
            unitPrice: num(line["unitPrice"]),
            discount: num(line["discount"]),
            lineTotal: num(line["lineTotal"]),
            ...(line["priceOverridden"] === true ? { priceOverridden: true } : {}),
        };
    });
    const memberRow = (row["member"] ?? null);
    return {
        ticketId: text(row["ticketId"], 80),
        capturedAt: text(row["capturedAt"], 40) || new Date().toISOString(),
        storeId: text(row["storeId"], 64),
        terminalId: text(row["terminalId"], 64),
        cashier: text(row["cashier"], 120),
        ...(row["billNo"] ? { billNo: text(row["billNo"], 40) } : {}),
        lines,
        subtotal: num(row["subtotal"]),
        discount: num(row["discount"]),
        tax: num(row["tax"]),
        serviceCharge: num(row["serviceCharge"]),
        total: num(row["total"]),
        ...(row["requestedValue"] === undefined || row["requestedValue"] === null
            ? {}
            : { requestedValue: num(row["requestedValue"]) }),
        ...(row["requestedLabel"] ? { requestedLabel: text(row["requestedLabel"], 120) } : {}),
        ...(row["expectedTotal"] === undefined || row["expectedTotal"] === null
            ? {}
            : { expectedTotal: num(row["expectedTotal"]) }),
        member: memberRow
            ? {
                id: text(memberRow["id"], 80),
                ...(memberRow["code"] ? { code: text(memberRow["code"], 80) } : {}),
                name: text(memberRow["name"], 160),
                ...(memberRow["phone"] ? { phone: maskSnapshotPhone(memberRow["phone"]) } : {}),
                ...(memberRow["email"] ? { email: maskSnapshotEmail(memberRow["email"]) } : {}),
                ...(memberRow["tier"] ? { tier: text(memberRow["tier"], 60) } : {}),
                ...(memberRow["points"] === undefined || memberRow["points"] === null
                    ? {}
                    : { points: num(memberRow["points"]) }),
                ...(memberRow["totalSpend"] === undefined || memberRow["totalSpend"] === null
                    ? {}
                    : { totalSpend: num(memberRow["totalSpend"]) }),
            }
            : null,
    };
}
