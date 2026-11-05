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
