import { formatTime as systemTime } from "@/lib/time-zone";
import { posCurrency } from "./currency";
import { formatDate as posDisplayDate, formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { receiptBarcode } from "./receipt-barcode";
import { sponsorshipReceiptDetails } from "./sponsorship-receipt";
import type { SponsorshipRecord } from "./sponsorship";
import { tenderTotals, shiftSalesOf } from "./shift-close";
import type {
  RoundingSettings,
  Member,
  Booking,
  BookingPayment,
  PaymentDetails,
  PaperSize,
  Product,
  FontStyleSettings,
  ReceiptOverride,
  ReceiptSettings,
  ReceiptLinePlacement,
  Sale,
  Shift,
  Store,
  TaxSettings,
  Transfer,
} from "@/core/types/pos-types";
import {
  bookingBalance,
  lineUnitDiscount,
  whatsappLink,
  TRANSFER_STATUS_LABELS,
} from "@/core/types/pos-types";
import { defaultReceiptSettings } from "./pos-seed";
import { normalizeReceiptLogoLayout } from "./receipt-logo";
import { normalizeReceiptHeaderLayout } from "./receipt-header";
import { readStoreGroups } from "./store-groups";
import { safeSectionFont, type ReceiptSectionKey, type ReceiptSectionStyle } from "./receipt-sections";
import { receiptDocumentLayout, type ReceiptDocumentKind } from "./receipt-documents";
import { roundingOf, showsRoundingLine } from "@/core/pricing/rounding";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import {
  canOpenDrawer,
  canPrintReceipts,
  getPrinterPrefs,
  protectedDrawerOpen,
  rawPulse,
  silentPrint,
} from "./receipt-printer";
import { columnsForPaper, htmlToEscPos } from "./escpos";
import { RECEIPT_SCOPE, scopeReceiptCss } from "./receipt-css";
import {
  renderReceiptText,
  SAMPLE_RECEIPT_CONTEXT,
  type ReceiptTokenContext,
} from "./receipt-template";

export const STORE = {
  name: "RETAIL",
  line1: "42 Harbour Street, Unit 3",
  line2: "Tel 555-0100 · VAT 88-2201194",
};

/** Branch currently printing; set by the app whenever the store is switched. */
let activeBranch: Store | null = null;
export function setPrintStore(store: Store | null) {
  activeBranch = store;
  receiptCfg = resolveReceiptCfg(globalReceiptCfg, store);
}

/** Receipt customizer + tax configuration, pushed in by the app shell. */
let globalReceiptCfg: ReceiptSettings = defaultReceiptSettings;
let receiptCfg: ReceiptSettings = defaultReceiptSettings;
let taxCfg: TaxSettings = { enabled: false, rate: 0, mode: "exclusive" };
/** Total-rounding rules, so the slip knows whether to show the courtesy line. */
let roundingCfg: RoundingSettings = roundingOf(undefined);

/** Merge the global receipt profile with any branch-level overrides. */
export function resolveReceiptCfg(receipt: ReceiptSettings, store?: Store | null): ReceiptSettings {
  const o: ReceiptOverride = store?.receiptOverrides ?? {};
  const clean = Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as ReceiptOverride;
  return { ...receipt, ...clean };
}

export function setPrintSettings(
  receipt: ReceiptSettings,
  tax: TaxSettings,
  rounding?: Partial<RoundingSettings>,
) {
  globalReceiptCfg = receipt;
  receiptCfg = resolveReceiptCfg(receipt, activeBranch);
  taxCfg = tax;
  roundingCfg = roundingOf(rounding);
}

/**
 * Values the dynamic receipt fields resolve against for the slip being built.
 * Each body function fills this in before the header or footer is rendered, so
 * a template line can never carry data from the previous print.
 */
let tokenCtx: ReceiptTokenContext = {};
const setTokens = (ctx: ReceiptTokenContext) => {
  tokenCtx = ctx;
};

/** Device identity shown on slips; pushed in by the terminal layer. */
let deviceIdentity: { deviceName?: string; terminalName?: string } = {};
export function setPrintDevice(identity: { deviceName?: string; terminalName?: string }) {
  deviceIdentity = identity ?? {};
}

const placeTokens = (): ReceiptTokenContext => ({
  device_name: deviceIdentity.deviceName ?? "",
  terminal_name: deviceIdentity.terminalName ?? deviceIdentity.deviceName ?? "",
  branch_name: activeBranch?.name ?? "",
  branch_code: activeBranch?.code ?? "",
});

const dateTokens = (iso?: string): ReceiptTokenContext => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: posDisplayDate(d),
    time: systemTime(d, { hour: "2-digit", minute: "2-digit" }),
  };
};

/** Preview helper: render templates with clearly-marked sample values. */
export function usePreviewTokens() {
  tokenCtx = { ...SAMPLE_RECEIPT_CONTEXT, ...placeTokens() };
}

/** Service & high-tension liability wording, pushed in from the booking rules. */
let serviceTermsText = "";
export function setServiceTerms(text: string) {
  serviceTermsText = (text ?? "").trim();
}

/** Fine print carried on job tags and settlement receipts. */
function serviceTermsBlock() {
  if (!serviceTermsText) return "";
  return `<hr><div class="muted" style="font-size:9px;line-height:1.25">
    <span class="b">Service &amp; high-tension liability:</span> ${esc(serviceTermsText)}
  </div>`;
}

/** Preview helper: render with an explicit, already-resolved profile. */
export function setPreviewReceiptCfg(receipt: ReceiptSettings, tax: TaxSettings) {
  receiptCfg = receipt;
  taxCfg = tax;
}

export const PAPER_LABELS: Record<PaperSize, string> = {
  "30mm": "TNM — 30 mm Thermal (Narrow)",
  "80mm": "ATNF — 80 mm Thermal (Standard)",
  "58mm": "58mm Thermal (Mini)",
  a4: "A4 Sheet",
  letter: "Letter",
};

/** @page + body geometry for each supported slip size. */
export function paperCss(paper: PaperSize) {
  switch (paper) {
    case "30mm":
      return { page: "30mm auto", width: "30mm", font: "8px", h1: "10px" };
    case "58mm":
      return { page: "58mm auto", width: "58mm", font: "10px", h1: "13px" };
    case "a4":
      return { page: "A4", width: "210mm", font: "13px", h1: "22px" };
    case "letter":
      return { page: "Letter", width: "216mm", font: "13px", h1: "22px" };
    default:
      return { page: "80mm auto", width: "80mm", font: "12px", h1: "15px" };
  }
}

export type ReceiptKind =
  | "sale"
  | "gift"
  | "duplicate"
  | "refund"
  | "kitchen"
  | "xreport"
  | "zreport"
  | "member"
  | "transfer";

const fmt = (n: number) => n.toFixed(2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONT_STACKS: Record<string, string> = {
  mono: `"IBM Plex Mono", ui-monospace, monospace`,
  sans: `"Helvetica Neue", Arial, sans-serif`,
  serif: `Georgia, "Times New Roman", serif`,
  arial: `Arial, Helvetica, sans-serif`,
  verdana: `Verdana, Geneva, sans-serif`,
  tahoma: `Tahoma, Verdana, sans-serif`,
  georgia: `Georgia, "Times New Roman", serif`,
  times: `"Times New Roman", Times, serif`,
  courier: `"Courier New", Courier, monospace`,
};

const sectionSlot = (key: ReceiptSectionKey, html: string) => `<section data-receipt-slot="${key}">${html}</section>`;

/** Only allowlisted styles and escaped text reach the print renderer. */
function renderDocumentSections(html: string, document: ReceiptDocumentKind) {
  const config = receiptCfg.documentSections?.[document];
  const extra = Array.isArray(config?.extra) ? config.extra.slice(0, 100) : [];
  const seen = new Set<string>();
  const styled = (body: string, style: ReceiptSectionStyle | undefined, className: string, fallback = receiptCfg.fonts?.body ?? defaultReceiptSettings.fonts.body) => {
    if (!style?.font) return body;
    const font = safeSectionFont(style.font, fallback);
    const css = `font-family:${FONT_STACKS[font.family]};font-size:${font.size}px!important;font-weight:${font.bold ? 700 : 400};letter-spacing:${font.spacing}px;`;
    return `<div class="${className}"><style>.${className},.${className} :is(div,td,th,p,h1,h2,span){${css}}</style>${body}</div>`;
  };
  return html.replace(/<section data-receipt-slot="([a-z]+)">([\s\S]*?)<\/section>/g, (_match, raw: string, body: string) => {
    const key = raw as ReceiptSectionKey;
    const style = config?.styles?.[key];
    if (body.trim() && typeof style?.heading === "string") {
      const title = esc(renderReceiptText(style.heading, tokenCtx));
      const old = key === "terms" ? "TERMS &amp; CONDITIONS" : key === "liability" ? "Service &amp; high-tension liability:" : key === "job" ? "RACKET JOB CARD" : null;
      if (old && body.includes(old)) body = body.replace(old, title);
      else if (title) body = `<div class="c b">${title}</div>${body}`;
    }
    if (body.trim() && key !== "header" && key !== "footer" && typeof style?.text === "string" && style.text.trim()) body += renderReceiptText(style.text, tokenCtx).split(/\r?\n/).map(line => `<div>${esc(line)}</div>`).join("");
    let result = styled(body, style, `rsec-${document}-${key}`, receiptCfg.fonts?.[key === "header" ? "header" : key === "footer" ? "footer" : "body"] ?? defaultReceiptSettings.fonts.body);
    if (!seen.has(key)) extra.forEach((item, index) => {
      if (!item || item.enabled === false || item.after !== key) return;
      const heading = typeof item.heading === "string" ? esc(renderReceiptText(item.heading, tokenCtx)) : "";
      const text = typeof item.text === "string" ? renderReceiptText(item.text, tokenCtx).split(/\r?\n/).map(line => `<div>${esc(line)}</div>`).join("") : "";
      if (heading || text) result += styled(`<hr>${heading ? `<div class="c b">${heading}</div>` : ""}${text}`, item, `rsec-${document}-extra-${index}`);
    });
    seen.add(key);
    return result;
  });
}

const fontCss = (f: FontStyleSettings) =>
  `font-family: ${FONT_STACKS[f.family] ?? FONT_STACKS.mono}; font-size: ${f.size}px; font-weight: ${
    f.bold ? 700 : 400
  }; letter-spacing: ${f.spacing}px;`;

/** Real QR code rendered as inline SVG — no network calls. */
export function qrSvg(value: string, size: number) {
  if (!value.trim()) return "";
  const qr = qrcode(0, "M");
  try { qr.addData(value); qr.make(); }
  catch { return '<div class="c muted">QR unavailable: shorten the saved QR link or text.</div>'; }
  const count = qr.getModuleCount();
  let rects = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#000"/>`;
    }
  }
  return `<div class="c" style="margin-top:6px"><svg width="${size}" height="${size}" viewBox="-4 -4 ${count + 8} ${count + 8}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect x="-4" y="-4" width="${count + 8}" height="${count + 8}" fill="#fff"/>${rects}</svg></div>`;
}

const customLines = (placement: ReceiptLinePlacement) =>
  (receiptCfg.customLines ?? [])
    .filter((l) => l.placement === placement && l.text.trim())
    .map((l) => renderReceiptText(l.text, tokenCtx).trim())
    .filter(Boolean)
    .flatMap(text => text.split(/\r?\n/))
    .map((text) => `<div class="c muted">${esc(text)}</div>`)
    .join("");

/** QR block if it belongs at the given placement. */
const qrBlock = (placement: "header" | "footer") =>
  receiptCfg.qr?.enabled && receiptCfg.qr.placement === placement
    ? qrSvg(
        receiptCfg.qr.value,
        // Never wider than the printable band (~3.78px per millimetre).
        Math.min(receiptCfg.qr.size || 96, Math.round(printableWidthMm(receiptCfg.paper) * 3.6)),
      )
    : "";

/** The driver and raw printer use the same compact, width-bounded scan image. */
export function barcodeSvg(value: string, height = 44) {
  if (!value) return "";
  const bitmap = receiptBarcode(value, Math.floor(printableWidthMm(receiptCfg.paper) * 8), Math.round(height * 203 / 96));
  if (!bitmap) return `<div class="bc-text">${esc(value)}</div>`;
  let rects = "";
  // Code 128 rows are identical; draw bars once rather than thousands of pixel rectangles.
  const step = bitmap.kind === "code128" ? bitmap.height : 1;
  for (let y = 0; y < bitmap.height; y += step) {
    let x = 0;
    while (x < bitmap.width) {
      if (!bitmap.pixels[y * bitmap.width + x]) { x++; continue; }
      const start = x;
      while (x < bitmap.width && bitmap.pixels[y * bitmap.width + x]) x++;
      rects += `<rect x="${start}" y="${y}" width="${x - start}" height="${step}" fill="#000"/>`;
    }
  }
  const widthMm = bitmap.width / 8;
  return `<div class="barcode" data-symbology="${bitmap.kind}"><svg width="${widthMm}mm" viewBox="0 0 ${bitmap.width} ${bitmap.height}" preserveAspectRatio="xMidYMid meet" style="width:${widthMm}mm;max-width:100%;height:auto;margin:0 auto" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${bitmap.width}" height="${bitmap.height}" fill="#fff"/>${rects}</svg></div><div class="bc-text">${esc(value)}</div>`;
}

const PAPER_MM: Record<PaperSize, number> = {
  "30mm": 30,
  "58mm": 58,
  "80mm": 80,
  a4: 210,
  letter: 216,
};

/** Terminal-configured page margins, in millimetres. */
function printMargins() {
  const m = getPrinterPrefs().margins ?? { top: 4, right: 4, bottom: 4, left: 4 };
  return m;
}

/** Selected paper width less the configured page margins, without a second width reduction. */
export function printableWidthMm(paper: PaperSize) {
  const m = printMargins();
  return Math.max(1, (PAPER_MM[paper] ?? 80) - m.left - m.right);
}

const shell = (title: string, body: string, autoPrint = true) => {
  const p = paperCss(receiptCfg.paper);
  const f = receiptCfg.fonts ?? defaultReceiptSettings.fonts;
  const m = printMargins();
  const paper = receiptCfg.paper;
  const width = printableWidthMm(paper);
  const bodyWidth = `${width}mm`;
  return `<!doctype html><html><head>
<meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: ${p.page}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
  * { box-sizing: border-box; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { ${fontCss(f.body)} color: #000; margin: 0 auto; padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; width: ${PAPER_MM[paper]}mm; max-width: 100%; overflow-wrap: anywhere; }
  .rcpt-head { ${fontCss(f.header)} }
  .rcpt-foot { ${fontCss(f.footer)} }
  h1 { ${fontCss(f.header)} font-size: ${Math.round(f.header.size * 1.25)}px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; }
  .muted { font-size: 0.85em; }
  .logo { margin: 2px 0 4px; }
  .logo span { display: inline-block; border: 2px solid #000; border-radius: 4px; padding: 3px 8px; font-weight: 700; letter-spacing: 3px; font-size: 1.1em; }
  .logo img { display: inline-block; max-width: 100%; object-fit: contain; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  ${paper === "30mm" ? "td { display: block; width: 100%; overflow-wrap: anywhere; }" : ""}
  .r { text-align: right; white-space: nowrap; word-break: keep-all; overflow-wrap: normal; font-variant-numeric: tabular-nums; }
  td.r { width: 1%; padding-left: 4px; }
  .b { font-weight: 700; }
  .big { font-size: 1.2em; }
  .tag { border: 1px solid #000; padding: 2px 4px; display: inline-block; margin-top: 4px; font-size: 0.8em; letter-spacing: 1px; }
  .barcode { margin-top: 6px; width: 100%; }
  .barcode svg { display: block; width: 100%; }
  .c svg { max-width: 100%; height: auto; }
  .bc-text { text-align: center; font-size: 0.85em; letter-spacing: 3px; margin-top: 2px; }
  @media print {
    html { width: auto; }
    body { width: ${bodyWidth}; margin: 0 auto; padding: 0; }
    .no-print { display: none !important; }
  }
  ${scopeReceiptCss(receiptCfg.css)}
</style></head><body><div class="${RECEIPT_SCOPE.slice(1)}">${body}<div class="c muted" style="margin-top:4px">Currency: ${esc(posCurrency())}</div></div>
${
  autoPrint
    ? `<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close()},400)}</script>`
    : ""
}
</body></html>`;
};

const header = (subtitle?: string, document?: ReceiptDocumentKind) => {
  const initials = (receiptCfg.companyName || STORE.name)
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9&]/g, "")[0] ?? "")
    .join("")
    .slice(0, 4)
    .toUpperCase();
  const info = [
    receiptCfg.phone ? `Tel ${receiptCfg.phone}` : "",
    receiptCfg.taxNumber ? `VAT / Tax No. ${receiptCfg.taxNumber}` : "",
    receiptCfg.regNumber ? `Reg. No. ${receiptCfg.regNumber}` : "",
    receiptCfg.website || "",
  ].filter(Boolean);
  const logoLayout = normalizeReceiptLogoLayout(receiptCfg.logoLayout);
  const logo = receiptCfg.showLogo
    ? receiptCfg.logo
      ? `<div class="logo" style="text-align:${logoLayout.alignment}"><img src="${esc(receiptCfg.logo)}" alt="" style="width:${logoLayout.widthPercent}%;max-height:${logoLayout.maxHeightMm}mm"></div>`
      : `<div class="logo" style="text-align:${logoLayout.alignment}"><span>${esc(initials || "POS")}</span></div>`
    : "";
  const logoAt = (position: ReceiptSettings["logoLayout"]["position"]) =>
    logoLayout.position === position ? logo : "";
  const heading = normalizeReceiptHeaderLayout(receiptCfg.headerLayout);
  const groups = readStoreGroups();
  const groupId = activeBranch?.groupId;
  const clusterName = groupId && Array.isArray(groups) ? groups.find(group => group.id === groupId)?.name ?? "" : "";
  const cluster = heading.showCluster && clusterName ? `<div class="c receipt-cluster">${esc(clusterName)}</div>` : "";
  const clusterAt = (position: typeof heading.clusterPosition) => heading.clusterPosition === position ? cluster : "";
  const storeName = activeBranch ? `${activeBranch.name}${heading.showStoreCode ? ` (${activeBranch.code})` : ""}` : STORE.line1;
  return `
  <div class="rcpt-head">
  ${logoAt("above-name")}
  ${clusterAt("above-company")}
  ${heading.showCompany ? `<h1>${esc(receiptCfg.companyName || STORE.name)}</h1>` : ""}
  ${clusterAt("below-company")}
  ${logoAt("below-name")}
  </div>
  ${heading.showStore ? `<div class="c muted receipt-store">${esc(storeName)}</div>` : ""}
  ${clusterAt("after-store")}
  ${renderReceiptText((document ? receiptCfg.documentSections?.[document]?.styles?.header?.text : undefined) ?? receiptCfg.headerText ?? "", tokenCtx)
    .split("\n")
    .filter(Boolean)
    .map((l) => `<div class="c muted">${esc(l)}</div>`)
    .join("")}
  ${info.map((l) => `<div class="c muted">${esc(l)}</div>`).join("")}
  ${logoAt("after-details")}
  ${customLines("header")}
  ${!document || receiptDocumentLayout(receiptCfg.documentLayouts, document).showQr ? qrBlock("header") : ""}
  ${subtitle ? `<div class="c tag">${esc(subtitle)}</div>` : ""}
  <hr>`;
};

function saleBody(sale: Sale, member: Member | null, kind: ReceiptKind) {
  const layout = receiptDocumentLayout(receiptCfg.documentLayouts, "sale");
  setTokens({
    ...placeTokens(),
    ...dateTokens(sale.createdAt),
    receipt_number: sale.correctedAt ? `Corrected ${sale.receiptNo}` : sale.receiptNo,
    cashier: sale.cashier ?? "",
    customer_name: member?.name ?? "",
    customer_code: member?.code ?? "",
    item_count: String(sale.lines.reduce((a, l) => a + l.qty, 0)),
    subtotal: fmt(sale.subtotal),
    discount: fmt(sale.discount),
    tax: fmt(sale.tax),
    total: fmt(sale.total),
    payment_method: sale.method ?? "",
    received: fmt(sale.paid),
    change: fmt(sale.change),
    booking_ref: sale.bookingRef ?? "",
  });
  const hidePrices = kind === "gift" || kind === "kitchen";
  const subtitle =
    kind === "gift"
      ? "GIFT RECEIPT"
      : kind === "duplicate"
        ? "DUPLICATE COPY"
        : kind === "refund"
          ? "REFUND / CREDIT NOTE"
          : kind === "kitchen"
            ? "KITCHEN ORDER TICKET"
            : undefined;
  const sign = kind === "refund" ? -1 : 1;
  const receiptLines = sale.exchangeOfReceiptNo
    ? [...sale.lines.filter(line => line.credit), ...sale.lines.filter(line => !line.credit)]
    : sale.lines;
  const rows = receiptLines
    .map(
      (l, index) =>
        `${sale.exchangeOfReceiptNo && (index === 0 || receiptLines[index - 1].credit !== l.credit)
          ? `<tr><td colspan="2" class="b">${l.credit ? "ITEMS RETURNED FOR EXCHANGE" : "REPLACEMENT ITEMS"}</td></tr>` : ""}<tr><td>${esc(l.name)}${l.credit ? ' <span class="tag">EXCHANGED / RETURNED</span>' : ""}<div class="muted">${layout.showQuantities ? Math.abs(l.qty) : ""}${layout.showQuantities && layout.showUnitPrices ? " x " : ""}${layout.showUnitPrices ? fmt(l.price) : ""}${
          l.discount
            ? ` - ${l.discountType === "percent" ? `${l.discount}%` : fmt(l.discount)} disc`
            : ""
        }</div></td>${
          hidePrices || !layout.showLineTotals
            ? ""
            : `<td class="r">${fmt(sign * (l.price - lineUnitDiscount(l)) * l.qty)}</td>`
        }</tr>`,
    )
    .join("");

  const totals = hidePrices
    ? ""
    : `<hr><table>
      <tr><td>Subtotal</td><td class="r">${fmt(sign * sale.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="r">-${fmt(sale.discount)}</td></tr>
      ${
        sale.couponCode
          ? `<tr><td>Voucher ${esc(sale.couponCode)}${
              sale.couponName ? `<div class="muted">${esc(sale.couponName)}</div>` : ""
            }</td><td class="r">-${fmt(sale.couponDiscount ?? 0)}</td></tr>${
              sale.couponRemaining && sale.couponRemaining > 0
                ? `<tr><td class="muted">Voucher balance left</td><td class="r muted">${fmt(sale.couponRemaining)}</td></tr>`
                : ""
            }`
          : ""
      }
      ${
        sale.exchangeOfReceiptNo
          ? `<tr><td>Exchange credit</td><td class="r">-${fmt(sale.exchangeCredit ?? 0)}</td></tr>`
          : ""
      }
      ${
        // Tax is settings-driven: no row at all when tax is off or the bill
        // carries none.
        receiptCfg.showTax && taxCfg.enabled && sale.tax
          ? `<tr><td>Tax ${taxCfg.rate}%${taxCfg.mode === "inclusive" ? " incl." : ""}</td><td class="r">${fmt(sign * sale.tax)}</td></tr>`
          : ""
      }
      ${
        // Courtesy rounding line: only when the customer paid LESS and the
        // merchant chose to show it. A round-up applies silently.
        showsRoundingLine(sale.roundingAdjustment, roundingCfg)
          ? `<tr><td>${esc(sale.roundingLabel || roundingCfg.receiptLabel)}</td><td class="r">-${fmt(Math.abs(sale.roundingAdjustment ?? 0))}</td></tr>`
          : ""
      }
      <tr class="b big"><td>TOTAL</td><td class="r">${fmt(sign * sale.total)}</td></tr>
      <tr><td>${esc(sale.method.toUpperCase())}</td><td class="r">${fmt(sign * sale.paid)}</td></tr>
      <tr><td>Change</td><td class="r">${fmt(sale.change)}</td></tr>
    </table>`;

  const memberBlock = member && layout.showCustomer
    ? `<hr><div>Member ${esc(member.code)} · ${esc(member.name)}</div>
       ${
         receiptCfg.showPoints
           ? `<div class="muted">Tier ${member.tier} · Points earned ${sale.pointsEarned} · Balance ${member.points}</div>`
           : `<div class="muted">Tier ${member.tier}</div>`
       }`
    : "";

  return renderDocumentSections(`${sectionSlot("header", header(subtitle, "sale"))}
    ${sale.exchangeOfReceiptNo ? `<div class="c b big">EXCHANGE RECEIPT</div>` : ""}
    ${sectionSlot("details", `<table>
      <tr><td>Receipt</td><td class="r b">${sale.correctedAt ? "Corrected " : ""}${esc(sale.receiptNo)}</td></tr>
      ${sale.exchangeOfReceiptNo ? `<tr><td>Original receipt</td><td class="r b">${esc(sale.exchangeOfReceiptNo)}</td></tr>` : ""}
      <tr><td>Date</td><td class="r">${posDisplayDateTime(new Date(sale.createdAt))}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(sale.cashier)}</td></tr>
    </table>`)}
    <hr>
    ${customLines("before-items")}
    ${sectionSlot("items", `<table>${rows}</table>`)}
    ${customLines("before-totals")}
    ${sectionSlot("totals", totals)}
    ${customLines("after-totals")}
    ${sectionSlot("footer", `${memberBlock}
    <hr>
    ${
      kind === "gift"
        ? receiptCfg.showBarcode && layout.showBarcode
          ? `<div class="c muted">GIFT RETURN CODE</div>${barcodeSvg(`GIFT-${sale.receiptNo}`)}`
          : `<div class="c muted">GIFT RETURN CODE ${esc(sale.receiptNo)}</div>`
        : kind === "kitchen"
          ? ""
          : `${receiptCfg.showBarcode && layout.showBarcode ? barcodeSvg(sale.receiptNo) : ""}${
              sale.method === "card"
                ? `<div class="muted" style="margin-top:8px">Cardholder signature</div><div class="muted">______________________________</div>`
                : ""
            }`
    }
    <hr>
    <div class="c muted rcpt-foot">${
      kind === "gift"
        ? "Exchangeable within 30 days with this slip"
        : esc(renderReceiptText(receiptCfg.documentSections?.sale?.styles?.footer?.text ?? receiptCfg.footerText ?? "", tokenCtx))
    }</div>
    ${customLines("footer")}
    ${layout.showQr ? qrBlock("footer") : ""}
    <div class="c muted">${esc(sale.receiptNo)}</div>`)} `, "sale");
}

export type ShiftReportAccess = {
  financialSummary: boolean;
  paymentBreakdown: boolean;
  expected: boolean;
  counted: boolean;
  variance: boolean;
};

const fullShiftReportAccess: ShiftReportAccess = {
  financialSummary: true,
  paymentBreakdown: true,
  expected: true,
  counted: true,
  variance: true,
};

function shiftBody(
  shift: Shift,
  sales: Sale[],
  kind: "xreport" | "zreport",
  access: ShiftReportAccess = fullShiftReportAccess,
) {
  const active = shiftSalesOf(shift, sales);
  const byMethod = tenderTotals(shift, sales).map(t => ({m:t.method,n:t.count,v:t.value}));
  const gross = active.reduce((a, s) => a + s.total, 0);
  const tax = active.reduce((a, s) => a + s.tax, 0);
  const cash = byMethod.find((b) => b.m === "cash")!.v;
  const expected = shift.expectedCash ?? shift.openingFloat + cash;
  const counted = shift.countedCash ?? 0;
  return `${header(kind === "xreport" ? "X REPORT (MID-SHIFT)" : "Z REPORT (SHIFT CLOSE)")}
    <table>
      <tr><td>Cashier</td><td class="r">${esc(shift.cashier)}</td></tr>
      <tr><td>Opened</td><td class="r">${posDisplayDateTime(new Date(shift.openedAt))}</td></tr>
      <tr><td>Closed</td><td class="r">${shift.closedAt ? posDisplayDateTime(new Date(shift.closedAt)) : "—"}</td></tr>
    </table><hr>
    ${
      access.financialSummary
        ? `<table>
      <tr><td>Transactions</td><td class="r">${active.length}</td></tr>
      ${
        access.paymentBreakdown
          ? byMethod
              .map(
                (b) =>
                  `<tr><td>${b.m.toUpperCase()} (${b.n})</td><td class="r">${fmt(b.v)}</td></tr>`,
              )
              .join("")
          : ""
      }
      <tr><td>Tax collected</td><td class="r">${fmt(tax)}</td></tr>
      <tr class="b big"><td>GROSS</td><td class="r">${fmt(gross)}</td></tr>
    </table><hr>`
        : ""
    }
    ${
      access.expected || access.counted || access.variance
        ? `<table>
      ${
        access.expected
          ? `<tr><td>Opening float</td><td class="r">${fmt(shift.openingFloat)}</td></tr>
      <tr><td>Expected drawer</td><td class="r">${fmt(expected)}</td></tr>`
          : ""
      }
      ${access.counted ? `<tr><td>Counted</td><td class="r">${fmt(counted)}</td></tr>` : ""}
      ${access.variance ? `<tr class="b"><td>Variance</td><td class="r">${fmt(counted - expected)}</td></tr>` : ""}
    </table>`
        : ""
    }
    ${shift.note ? `<hr><div class="muted">Note: ${esc(shift.note)}</div>` : ""}
    ${
      kind === "xreport"
        ? `<hr><div class="c muted">System-generated snapshot — cannot be edited</div>`
        : `<hr><div class="c muted">Signature ______________________</div>`
    }`;
}

function memberBody(member: Member, sales: Sale[]) {
  const mine = sales.filter((s) => s.memberId === member.id).slice(0, 12);
  return `${header("MEMBER STATEMENT")}
    <table>
      <tr><td>Member</td><td class="r b">${esc(member.code)}</td></tr>
      <tr><td>Name</td><td class="r">${esc(member.name)}</td></tr>
      <tr><td>Tier</td><td class="r">${member.tier}</td></tr>
      <tr><td>Points</td><td class="r b">${member.points}</td></tr>
      <tr><td>Lifetime spend</td><td class="r">${fmt(member.totalSpend)}</td></tr>
    </table><hr>
    <table>${
      mine.length
        ? mine
            .map(
              (s) =>
                `<tr><td>${esc(s.receiptNo)}<div class="muted">${posDisplayDate(new Date(s.createdAt))}</div></td><td class="r">${fmt(s.total)}</td></tr>`,
            )
            .join("")
        : `<tr><td class="muted">No purchases recorded yet</td></tr>`
    }</table>
    <hr><div class="c muted">Present this slip to redeem points</div>`;
}

/**
 * Route one document to the printer.
 *
 * Desktop `dialog` mode  -> normal Windows print dialog through the driver.
 * Desktop `direct` mode  -> same driver rendering, no dialog.
 * Desktop `thermal` mode -> ESC/POS text through the RAW spooler (slips only).
 * Browser                -> classic hidden iframe with the print dialog.
 */
export type PrintResult = { ok: boolean; handled: boolean; error?: string };

async function printHtml(
  title: string,
  body: string,
  slip = true,
  barcode?: string,
): Promise<PrintResult> {
  if (!canPrintReceipts()) {
    toast.error("Printing not available on this device", {
      description: "Receipts print from the Windows till or a browser with a printer attached.",
    });
    return { ok: false, handled: false, error: "Printing is not available on this device." };
  }
  const desktopHtml = shell(title, body, false);
  const paper = receiptCfg.paper;
  const mode = getPrinterPrefs().printMode ?? "dialog";
  const thermal =
    slip && (paper === "30mm" || paper === "80mm" || paper === "58mm") && mode === "thermal";

  try {
    if (thermal) {
      const prefs = getPrinterPrefs();
      const ref = paper === "30mm" ? 24 : paper === "58mm" ? 50 : 72;
      const printable = printableWidthMm(paper);
      const cols = Math.max(
        paper === "30mm" ? 8 : 16,
        Math.floor(columnsForPaper(paper) * Math.min(1, printable / ref)),
      );
      const bytes = htmlToEscPos(desktopHtml, paper, {
        encoding: prefs.encoding ?? "cp437",
        lineEnding: prefs.lineEnding ?? "lf",
        cols,
        ...(barcode ? { barcode, barcodeWidthDots: Math.floor(printable * 8) } : {}),
      });
      const res = await rawPulse(bytes);
      if (res.handled) {
        if (!res.ok) toast.error("Printing failed", { description: res.error });
        return res;
      }
    }
    const printed = await silentPrint(desktopHtml, paper, mode !== "direct");
    if (!printed.handled) {
      const ok = browserPrint(shell(title, body));
      return {
        ok,
        handled: ok,
        ...(ok ? {} : { error: "The browser print window could not be opened." }),
      };
    }
    if (!printed.ok) toast.error("Printing failed", { description: printed.error });
    return printed;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "The printer did not accept the receipt.";
    toast.error("Printing failed", {
      description: message,
    });
    return { ok: false, handled: true, error: message };
  }
}

function browserPrint(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) return false;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => frame.remove(), 4000);
  return true;
}

export function printSaleReceipt(sale: Sale, member: Member | null, kind: ReceiptKind = "sale") {
  printHtml(
    `${sale.receiptNo} ${kind}`,
    saleBody(sale, member, kind),
    true,
    receiptCfg.showBarcode && receiptDocumentLayout(receiptCfg.documentLayouts, "sale").showBarcode && kind !== "kitchen"
      ? kind === "gift"
        ? `GIFT-${sale.receiptNo}`
        : sale.receiptNo
      : undefined,
  );
}

export function printShiftReport(
  shift: Shift,
  sales: Sale[],
  kind: "xreport" | "zreport",
  access: ShiftReportAccess = fullShiftReportAccess,
) {
  return printHtml(kind, shiftBody(shift, sales, kind, access));
}

/** Short sample slip used by the printer settings "Test receipt" button. */
export function printTestReceipt() {
  const width = printableWidthMm(receiptCfg.paper);
  // Edge ruler: if the first or last tick is missing, the slip is clipped.
  const ticks = Array.from({ length: Math.floor(width / 5) + 1 }, (_, i) => i * 5)
    .map(
      (mmv) => `<span style="display:inline-block;width:5mm">${mmv % 10 === 0 ? "|" : "."}</span>`,
    )
    .join("");
  const body = `${header("TEST RECEIPT")}
    <table>
      <tr><td>Printer test</td><td class="r b">OK</td></tr>
      <tr><td>Date</td><td class="r">${posDisplayDateTime(new Date())}</td></tr>
      <tr><td>Print width</td><td class="r">${width}mm</td></tr>
    </table>
    <hr>
    <div class="muted" style="white-space:nowrap;overflow:hidden">${ticks}</div>
    <div class="muted">|&lt;— edge ruler, both ends must be visible —&gt;|</div>
    <hr>
    <table>
      <tr><td>Sample item<div class="muted">1 x 10.00</div></td><td class="r">10.00</td></tr>
      <tr class="b big"><td>TOTAL</td><td class="r">10.00</td></tr>
    </table>
    <hr>
    <div class="c muted">If you can read this, printing works.</div>`;
  printHtml("Printer test", body);
}

export function printMemberStatement(member: Member, sales: Sale[]) {
  printHtml(`${member.code} statement`, memberBody(member, sales), false);
}

/* ------------------------------ bookings ------------------------------ */

function transferBlock(pay: PaymentDetails | null) {
  if (!pay) return "";
  const rows = [
    pay.bankName ? `<tr><td>Bank</td><td class="r">${esc(pay.bankName)}</td></tr>` : "",
    pay.accountName
      ? `<tr><td>Account name</td><td class="r">${esc(pay.accountName)}</td></tr>`
      : "",
    pay.accountNumber
      ? `<tr><td>Account no.</td><td class="r b">${esc(pay.accountNumber)}</td></tr>`
      : "",
    pay.whatsapp ? `<tr><td>WhatsApp</td><td class="r">${esc(pay.whatsapp)}</td></tr>` : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  const link = whatsappLink(pay.whatsapp);
  return `<hr><div class="c tag">PAY BY TRANSFER</div>
    <table>${rows.join("")}</table>
    ${pay.note ? `<div class="c muted">${esc(pay.note)}</div>` : ""}
    ${link ? `<div class="c" style="margin-top:6px">${qrSvg(link, 90)}<div class="muted">Scan to chat on WhatsApp</div></div>` : ""}`;
}

/** Terms & conditions block, printed under the job card when enabled. */
function termsBlock() {
  const cfg = receiptCfg.bookingSlip;
  const text = (cfg?.terms ?? "").trim();
  if (!cfg?.showTerms || !text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<div class="muted">${esc(l)}</div>`)
    .join("");
  return `<hr><div class="c b">TERMS &amp; CONDITIONS</div>${lines}`;
}

/** Customer signature rule with the name and a date line. */
function signatureBlock(customerName: string) {
  const cfg = receiptCfg.bookingSlip;
  if (!cfg?.showSignature) return "";
  const caption = (cfg.signatureCaption ?? "").trim();
  return `<hr>
    ${caption ? `<div class="muted">${esc(caption)}</div>` : ""}
    <div style="margin-top:26px;border-top:1px solid #000"></div>
    <div class="muted">Customer signature${customerName ? ` — ${esc(customerName)}` : ""}</div>
    <div style="margin-top:20px;border-top:1px solid #000"></div>
    <div class="muted">Date</div>`;
}

const bookingTokens = (booking: Booking, member: Member | null): ReceiptTokenContext => ({
  ...placeTokens(),
  ...dateTokens(booking.createdAt),
  receipt_number: booking.ref,
  booking_ref: booking.ref,
  cashier: booking.cashier ?? "",
  customer_name: member?.name ?? booking.customerName ?? "",
  customer_code: member?.code ?? "",
  item_count: String(booking.lines.reduce((a, l) => a + l.qty, 0)),
  subtotal: fmt(booking.subtotal),
  discount: fmt(booking.discount),
  tax: fmt(booking.tax),
  total: fmt(booking.total),
  deposit: fmt(booking.paid),
  balance: fmt(bookingBalance(booking)),
  collection_date: booking.dueDate ?? "",
});

function bookingBody(booking: Booking, member: Member | null, pay: PaymentDetails | null) {
  const document = booking.job ? "racket-customer" : "booking";
  const layout = receiptDocumentLayout(receiptCfg.documentLayouts, document);
  setTokens(bookingTokens(booking, member));
  const rows = booking.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}<div class="muted">${layout.showQuantities ? l.qty : ""}${layout.showQuantities && layout.showUnitPrices ? " x " : ""}${layout.showUnitPrices ? fmt(l.price) : ""}</div></td>${layout.showLineTotals ? `<td class="r">${fmt((l.price - lineUnitDiscount(l)) * l.qty)}</td>` : ""}</tr>`,
    )
    .join("");
  const balance = bookingBalance(booking);
  const paidRows = booking.payments
    .map(
      (p) =>
        `<tr><td>${posDisplayDate(new Date(p.at))} · ${esc(p.method.toUpperCase())}</td><td class="r">${fmt(p.amount)}</td></tr>`,
    )
    .join("");
  return renderDocumentSections(`${sectionSlot("header", header("BOOKING / PAY LATER SLIP", document))}
    ${sectionSlot("details", `<table>
      <tr><td>Booking</td><td class="r b">${esc(booking.ref)}</td></tr>
      <tr><td>Date</td><td class="r">${posDisplayDateTime(new Date(booking.createdAt))}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(booking.cashier)}</td></tr>
      ${layout.showCustomer && booking.customerName ? `<tr><td>Customer</td><td class="r">${esc(booking.customerName)}</td></tr>` : ""}
      ${layout.showPhone && booking.customerPhone ? `<tr><td>Phone</td><td class="r">${esc(booking.customerPhone)}</td></tr>` : ""}
    </table>`)}
    <hr>${sectionSlot("items", `<table>${rows}</table>`)}
    ${sectionSlot("services", chargesBlock(booking))}
    ${sectionSlot("totals", `<hr><table>
      <tr><td>Subtotal</td><td class="r">${fmt(booking.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="r">-${fmt(booking.discount)}</td></tr>
      ${
        receiptCfg.showTax && taxCfg.enabled && booking.tax
          ? `<tr><td>Tax ${taxCfg.rate}%${taxCfg.mode === "inclusive" ? " incl." : ""}</td><td class="r">${fmt(booking.tax)}</td></tr>`
          : ""
      }
      <tr class="b"><td>TOTAL</td><td class="r">${fmt(booking.total)}</td></tr>
    </table>`)}
    ${sectionSlot("payments", `<hr><div class="muted">Payments received</div>
    <table>${layout.showPaymentHistory ? paidRows || `<tr><td class="muted">None</td><td class="r">${fmt(0)}</td></tr>` : ""}
      <tr><td>Paid to date</td><td class="r">${fmt(booking.paid)}</td></tr>
      <tr class="b big"><td>BALANCE DUE</td><td class="r">${fmt(balance)}</td></tr>
    </table>`)}
    ${sectionSlot("collection", `${layout.showDueDate ? `<hr><div class="c b">Collect &amp; settle by ${esc(posDisplayDate(booking.dueDate))}</div><div class="c muted">Goods are reserved until this date. Bring this slip to collect.</div>` : ""}
    ${layout.showNotes && booking.note ? `<div class="c muted">${esc(booking.note)}</div>` : ""}
    `)}
    ${sectionSlot("job", jobCardBlock(booking))}
    ${sectionSlot("terms", termsBlock())}
    ${sectionSlot("liability", serviceTermsBlock())}
    ${booking.liabilityAccepted ? `<div class="c muted" style="font-size:9px">Accepted at intake by ${esc(booking.customerName || "customer")}</div>` : ""}
    ${sectionSlot("signature", signatureBlock(booking.customerName))}
    ${sectionSlot("footer", `${transferBlock(pay)}
    ${layout.showCustomer && member ? `<hr><div>Member ${esc(member.code)} · ${esc(member.name)}</div>` : ""}
    <hr>${receiptCfg.showBarcode && layout.showBarcode ? barcodeSvg(booking.ref) : ""}
    <div class="c muted rcpt-foot">${esc(renderReceiptText(receiptCfg.documentSections?.[document]?.styles?.footer?.text ?? receiptCfg.footerText ?? "", tokenCtx))}</div>
    ${customLines("footer")}
    ${layout.showQr ? qrBlock("footer") : ""}
    <div class="c muted">${esc(booking.ref)}</div>`)} `, document);
}

function bookingPaymentBody(booking: Booking, payment: BookingPayment) {
  const document = booking.job ? "racket-customer" : "booking";
  setTokens({
    ...bookingTokens(booking, null),
    ...dateTokens(payment.at),
    payment_method: payment.method ?? "",
    received: fmt(payment.amount),
  });
  return renderDocumentSections(`${sectionSlot("header", header("PART PAYMENT RECEIPT", document))}
    ${sectionSlot("details", `<table>
      <tr><td>Booking</td><td class="r b">${esc(booking.ref)}</td></tr>
      <tr><td>Date</td><td class="r">${posDisplayDateTime(new Date(payment.at))}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(payment.cashier)}</td></tr>
      ${booking.customerName ? `<tr><td>Customer</td><td class="r">${esc(booking.customerName)}</td></tr>` : ""}
    </table>`)}
    ${sectionSlot("payments", `<hr><table>
      <tr class="b big"><td>PAID NOW (${esc(payment.method.toUpperCase())})</td><td class="r">${fmt(payment.amount)}</td></tr>
      <tr><td>Booking total</td><td class="r">${fmt(booking.total)}</td></tr>
      <tr><td>Paid to date</td><td class="r">${fmt(booking.paid)}</td></tr>
      <tr class="b"><td>BALANCE DUE</td><td class="r">${fmt(bookingBalance(booking))}</td></tr>
    </table>`)}
    ${sectionSlot("collection", `<hr><div class="c">Collect &amp; settle by ${esc(posDisplayDate(booking.dueDate))}</div>`)}
    ${sectionSlot("terms", receiptCfg.bookingSlip?.termsOnPayment ? termsBlock() : "")}
    ${sectionSlot("liability", booking.job ? serviceTermsBlock() : "")}
    ${sectionSlot("footer", `<hr><div class="c muted rcpt-foot">${esc(renderReceiptText(receiptCfg.documentSections?.[document]?.styles?.footer?.text ?? receiptCfg.footerText ?? "", tokenCtx))}</div>
    <div class="c muted">${esc(booking.ref)}</div>`)} `, document);
}

export function printBookingSlip(
  booking: Booking,
  member: Member | null,
  pay: PaymentDetails | null,
) {
  printHtml(
    `${booking.ref} booking`,
    bookingBody(booking, member, pay),
    true,
    receiptCfg.showBarcode && receiptDocumentLayout(receiptCfg.documentLayouts, booking.job ? "racket-customer" : "booking").showBarcode ? booking.ref : undefined,
  );
}

export function printBookingPayment(booking: Booking, payment: BookingPayment) {
  printHtml(`${booking.ref} payment`, bookingPaymentBody(booking, payment));
}

/** Job-card details, printed under the booking slip for string jobs. */
function jobCardBlock(booking: Booking) {
  return jobCardRows(booking);
}

/** Itemised intake charges (labour / string / grip / add-ons), when captured. */
function chargesBlock(booking: Booking) {
  // Stocked materials appear in the booked-item table; show only the
  // remaining service charges here so the slip never lists them twice.
  const stockLineIds = new Set(booking.lines.map(line => line.productId));
  const charges = (booking.charges ?? []).filter(charge => !charge.productId || !stockLineIds.has(charge.productId));
  if (!charges.length) {
    return booking.serviceFee
      ? `<table><tr><td>${esc(booking.serviceName || "Service")}</td><td class="r">${fmt(booking.serviceFee)}</td></tr></table>`
      : "";
  }
  const rows = charges
    .map((c) => `<tr><td>${esc(c.name || c.kind)}</td><td class="r">${fmt(c.price)}</td></tr>`)
    .join("");
  return `<hr><div class="muted">Job charges</div><table>${rows}</table>`;
}

function jobCardRows(booking: Booking) {
  const j = booking.job;
  const layout = receiptDocumentLayout(receiptCfg.documentLayouts, "racket-customer");
  if (!j) return "";
  const unit = j.tensionUnit ?? "lb";
  const timing: Record<string, string> = {
    now: "Paid up front",
    deposit: "Deposit taken",
    collection: "Settle on collection",
  };
  const rows = [
    booking.serviceName
      ? `<tr><td>Service</td><td class="r">${esc(booking.serviceName)}</td></tr>`
      : "",
    layout.showRacket && j.racketModel ? `<tr><td>Racket</td><td class="r">${esc(j.racketModel)}</td></tr>` : "",
    layout.showString && j.stringType ? `<tr><td>String</td><td class="r">${esc(j.stringType)}</td></tr>` : "",
    layout.showTension && (j.tensionMain || j.tensionCross)
      ? `<tr class="b"><td>Tension (main / cross)</td><td class="r b">${esc(String(j.tensionMain ?? "—"))} / ${esc(String(j.tensionCross ?? j.tensionMain ?? "—"))} ${esc(unit)}</td></tr>`
      : "",
    layout.showNotes && j.grommetNotes
      ? `<tr><td>Grommet / grip</td><td class="r">${esc(j.grommetNotes)}</td></tr>`
      : "",
    j.droppedOffAt
      ? `<tr><td>Dropped off</td><td class="r">${esc(posDisplayDateTime(new Date(j.droppedOffAt)))}</td></tr>`
      : "",
    layout.showDueDate && j.promisedAt
      ? `<tr><td>Ready by</td><td class="r b">${esc(posDisplayDateTime(new Date(j.promisedAt)))}</td></tr>`
      : "",
    layout.showJobStatus && booking.jobStatus
      ? `<tr><td>Status</td><td class="r">${esc(booking.jobStatus.toUpperCase())}</td></tr>`
      : "",
    booking.paymentTiming
      ? `<tr><td>Payment</td><td class="r">${esc(timing[booking.paymentTiming] ?? booking.paymentTiming)}</td></tr>`
      : "",
    j.notifyWhatsApp ? `<tr><td>Notify</td><td class="r">WhatsApp when ready</td></tr>` : "",
  ]
    .filter(Boolean)
    .join("");
  if (!rows) return "";
  return `<hr><div class="c b">RACKET JOB CARD</div><table>${rows}</table>${
    layout.showNotes && j.jobNotes ? `<div class="muted">Notes: ${esc(j.jobNotes)}</div>` : ""
  }`;
}

/** Small tag tied to the racket itself while it waits on the rack. */
function jobTagBody(booking: Booking) {
  setTokens(bookingTokens(booking, null));
  const j = booking.job;
  const layout = receiptDocumentLayout(receiptCfg.documentLayouts, "racket-staff");
  const unit = j?.tensionUnit ?? "lb";
  const body = `${sectionSlot("header", header("RACKET JOB TAG", "racket-staff"))}
    ${sectionSlot("job", `<table>
      <tr><td>Job</td><td class="r b">${esc(booking.ref)}</td></tr>
      ${layout.showCustomer ? `<tr><td>Customer</td><td class="r b">${esc(booking.customerName)}</td></tr>` : ""}
      ${layout.showPhone && booking.customerPhone ? `<tr><td>Phone</td><td class="r">${esc(booking.customerPhone)}</td></tr>` : ""}
      ${layout.showRacket && j?.racketModel ? `<tr><td>Racket</td><td class="r">${esc(j.racketModel)}</td></tr>` : ""}
      ${layout.showString && j?.stringType ? `<tr><td>String</td><td class="r">${esc(j.stringType)}</td></tr>` : ""}
      ${
        layout.showTension && (j?.tensionMain || j?.tensionCross)
          ? `<tr class="b big"><td>Tension</td><td class="r">${esc(String(j?.tensionMain ?? "—"))}/${esc(String(j?.tensionCross ?? j?.tensionMain ?? "—"))} ${esc(unit)}</td></tr>`
          : ""
      }
      ${layout.showDueDate && j?.promisedAt ? `<tr><td>Ready by</td><td class="r b">${esc(posDisplayDateTime(new Date(j.promisedAt)))}</td></tr>` : ""}
      ${layout.showJobStatus ? `<tr><td>Status</td><td class="r">${esc((booking.jobStatus ?? "received").toUpperCase())}</td></tr>` : ""}
    </table>
    ${layout.showNotes && j?.grommetNotes ? `<div class="muted">${esc(j.grommetNotes)}</div>` : ""}
    ${layout.showNotes && j?.jobNotes ? `<div class="muted">${esc(j.jobNotes)}</div>` : ""}
    `)}
    ${sectionSlot("footer", `${(receiptCfg.documentSections?.["racket-staff"]?.styles?.footer?.text ?? "").split(/\r?\n/).map(line => `<div>${esc(renderReceiptText(line, tokenCtx))}</div>`).join("")}<hr>${layout.showBarcode ? barcodeSvg(booking.ref) : ""}
    <div class="c">${layout.showQr ? qrSvg(booking.ref, 96) : ""}</div>
    `)}
    ${sectionSlot("liability", serviceTermsBlock())}
    <div class="c muted">${esc(booking.ref)}</div>`;
  return renderDocumentSections(body, "racket-staff");
}

export function jobTagPreview(booking: Booking) { return shell(booking.ref, jobTagBody(booking), false); }
export function printJobTag(booking: Booking) { printHtml(`${booking.ref} job tag`, jobTagBody(booking), true, receiptDocumentLayout(receiptCfg.documentLayouts, "racket-staff").showBarcode ? booking.ref : undefined); }

export function bookingSlipPreview(
  booking: Booking,
  member: Member | null,
  pay: PaymentDetails | null,
) {
  return shell(booking.ref, bookingBody(booking, member, pay), false);
}

/** Full HTML document for on-screen preview (no auto-print). */
export function saleReceiptPreview(sale: Sale, member: Member | null, kind: ReceiptKind) {
  return shell(sale.receiptNo, saleBody(sale, member, kind), false);
}

export function shiftReportPreview(shift: Shift, sales: Sale[]) {
  return shell("Z report", shiftBody(shift, sales, "zreport"), false);
}

function transferBody(transfer: Transfer, products: Product[], from: Store, to: Store) {
  const label = transfer.kind === "request" ? "STOCK REQUEST NOTE" : "STOCK TRANSFER NOTE";
  const lines = transfer.items.map((item) => ({
    item,
    product: products.find((p) => p.id === item.productId) ?? null,
  }));
  const units = transfer.items.reduce((a, i) => a + i.qty, 0);
  const value = lines.reduce((a, l) => a + (l.product?.cost ?? 0) * l.item.qty, 0);
  return `${header(label)}
    <table>
      <tr><td>Reference</td><td class="r b">${esc(transfer.ref)}</td></tr>
      <tr><td>Date</td><td class="r">${posDisplayDateTime(new Date(transfer.createdAt))}</td></tr>
      <tr><td>Status</td><td class="r">${esc((TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status).toUpperCase())}</td></tr>
      <tr><td>Raised by</td><td class="r">${esc(transfer.createdBy)}</td></tr>
    </table><hr>
    <table>
      <tr><td>From</td><td class="r">${esc(from.name)} (${esc(from.code)})</td></tr>
      <tr><td>To</td><td class="r">${esc(to.name)} (${esc(to.code)})</td></tr>
    </table><hr>
    <table>
      ${lines
        .map(
          (l) => `<tr><td>${esc(l.product?.name ?? "Unknown item")}
            <div class="muted">${esc(l.product?.sku ?? "")} · ${fmt(l.product?.cost ?? 0)} ea</div></td>
          <td class="r b big">${l.item.qty}</td></tr>`,
        )
        .join("")}
    </table><hr>
    <table>
      <tr><td>Lines / units</td><td class="r">${lines.length} / ${units}</td></tr>
      <tr class="b"><td>Value</td><td class="r">${fmt(value)}</td></tr>
    </table>
    ${transfer.note ? `<hr><div class="muted">Note: ${esc(transfer.note)}</div>` : ""}
    <hr>
    <div class="muted">Dispatched by ______________________</div>
    <div class="muted">Received by  ______________________</div>
    <div class="c muted">${esc(transfer.ref)}</div>`;
}

export function printTransferNote(transfer: Transfer, products: Product[], from: Store, to: Store) {
  printHtml(transfer.ref, transferBody(transfer, products, from, to), false);
}
export function printSponsorshipReceipt(record: SponsorshipRecord) {
  const details = sponsorshipReceiptDetails(
    record,
    posDisplayDateTime(new Date(record.given_at ?? "")),
  );
  // Custom header fields must belong to this document, never the previous sale.
  setTokens({
    ...placeTokens(),
    ...dateTokens(record.given_at ?? record.created_at),
    receipt_number: record.reference,
    cashier: record.given_by_name ?? record.created_by_name,
    customer_name: record.recipient_name,
    branch_name: record.store_name,
    branch_code: activeBranch?.id === record.store_id ? activeBranch.code : "",
    item_count: String(record.lines.reduce((sum, line) => sum + line.quantity, 0)),
    subtotal: fmt(record.lines.reduce((sum, line) => sum + line.unit_value * line.quantity, 0)),
    discount: fmt(record.lines.reduce((sum, line) => sum + (line.discount_amount ?? 0), 0)),
    tax: fmt(0),
    total: fmt(record.total_value),
    payment_method: "Sponsorship",
    received: fmt(0),
    change: fmt(0),
  });
  return printHtml(record.reference, header() + details, true);
}

/**
 * Cash drawer kick through the protected native printer bridge. The main
 * process sends the raw ESC/POS pulse to the configured receipt printer.
 * Browser print dialogs cannot transport a drawer pulse.
 */
export async function openCashDrawer(reason = "Cash drawer opened", shiftId?: string | null) {
  if (!canOpenDrawer()) {
    toast.error("Cash drawer not available on this device", {
      description: "The drawer opens through the receipt printer on the Windows till.",
    });
    return { ok: false, error: "Cash drawer not available on this device" };
  }
  return protectedDrawerOpen(reason, shiftId)
    .then((res) => {
      if (res.handled) {
        // Desktop shell: never print a slip — that is the symptom, not a fallback.
        if (!res.ok) {
          toast.error("Drawer did not open", {
            description:
              res.error ||
              "The printer refused the raw drawer pulse. Check the printer selection in Receipt printer settings.",
          });
        }
        return { ok: res.ok, ...(res.error ? { error: res.error } : {}) };
      }
      return { ok: false, error: "The native cash drawer connection is unavailable." };
    })
    .catch((error: unknown) => {
      toast.error("Drawer did not open", {
        description: error instanceof Error ? error.message : "The printer connection failed.",
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The printer connection failed.",
      };
    });
}
