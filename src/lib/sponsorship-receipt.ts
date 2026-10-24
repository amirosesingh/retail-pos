import type { SponsorshipRecord } from "./sponsorship";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
export function sponsorshipReceiptDetails(record: SponsorshipRecord, givenAtLabel: string) {
  if (record.status !== "issued" || !record.given_at)
    throw new Error("Only a recorded sponsorship handover can be printed");
  return `<div class="c b">SPONSORSHIP RECEIPT</div><div class="c muted">Products given without payment</div><hr>
    <table><tr><td>Reference</td><td class="r">${esc(record.reference)}</td></tr><tr><td>Given on</td><td class="r">${esc(givenAtLabel)}</td></tr><tr><td>From</td><td class="r">${esc(record.store_name)}</td></tr><tr><td>Recipient</td><td class="r b">${esc(record.recipient_name)}</td></tr><tr><td>Received by</td><td class="r">${esc(record.received_by)}</td></tr><tr><td>Issued by</td><td class="r">${esc(record.given_by_name)}</td></tr><tr><td>${record.authorization_mode === "direct" ? "Authorized by" : "Approved by"}</td><td class="r">${esc(record.approved_by_name)}</td></tr></table><hr>
    <table>${record.lines.map((line) => `<tr><td>${esc(line.name)}<div class="muted">${esc(line.sku)} · ${Number(line.unit_value).toFixed(2)} each${line.discount_amount ? ` · Discount ${Number(line.discount_amount).toFixed(2)}${line.discount_type === "percent" ? ` (${Number(line.discount)}%)` : ""}` : ""}</div></td><td class="r">${line.quantity}</td><td class="r">${Number(line.line_value ?? line.quantity * line.unit_value).toFixed(2)}</td></tr>`).join("")}</table><hr>
    <div class="r">Original value ${record.lines.reduce((sum, line) => sum + line.quantity * line.unit_value, 0).toFixed(2)}</div><div class="r">Discount ${record.lines.reduce((sum, line) => sum + (line.discount_amount ?? 0), 0).toFixed(2)}</div><div class="r b">Sponsored value ${Number(record.total_value).toFixed(2)}</div><div class="muted">${esc(record.purpose)}</div><hr><div>Recipient signature ____________________</div><div class="c muted">Keep this receipt as proof of handover.</div>`;
}
