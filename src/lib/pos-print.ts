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
import { roundingOf, showsRoundingLine } from "@/core/pricing/rounding";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import {
  canOpenDrawer,
  canPrintReceipts,
  drawerPulseBytes,
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
let taxCfg: TaxSettings = { enabled: true, rate: 5, mode: "exclusive" };
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
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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
      return { page: "30mm auto", width: "24mm", font: "8px", h1: "10px" };
    case "58mm":
      return { page: "58mm auto", width: "48mm", font: "10px", h1: "13px" };
    case "a4":
      return { page: "A4", width: "180mm", font: "13px", h1: "22px" };
    case "letter":
      return { page: "Letter", width: "170mm", font: "13px", h1: "22px" };
    default:
      return { page: "80mm auto", width: "72mm", font: "12px", h1: "15px" };
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
};

const fontCss = (f: FontStyleSettings) =>
  `font-family: ${FONT_STACKS[f.family] ?? FONT_STACKS.mono}; font-size: ${f.size}px; font-weight: ${
    f.bold ? 700 : 400
  }; letter-spacing: ${f.spacing}px;`;

/** Real QR code rendered as inline SVG — no network calls. */
export function qrSvg(value: string, size: number) {
  if (!value.trim()) return "";
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  let rects = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#000"/>`;
    }
  }
  return `<div class="c" style="margin-top:6px"><svg width="${size}" height="${size}" viewBox="0 0 ${count} ${count}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${count}" height="${count}" fill="#fff"/>${rects}</svg></div>`;
}

const customLines = (placement: "header" | "footer") =>
  (receiptCfg.customLines ?? [])
    .filter((l) => l.placement === placement && l.text.trim())
    .map((l) => renderReceiptText(l.text, tokenCtx).trim())
    .filter(Boolean)
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

/**
 * Real Code 39 barcode drawn as inline SVG.
 *
 * SVG shapes print through every driver, unlike CSS background colours which
 * Windows and browsers drop from printouts by default — that is why the bars
 * used to vanish and only the number came out.
 */
export function barcodeSvg(value: string, height = 44) {
  const clean = code39Text(value);
  if (!clean) return "";
  const NARROW = 2;
  const WIDE = 5;
  // Code 39 requires a blank quiet zone on both sides. Keep it inside the SVG
  // so browser and Windows print drivers cannot crop the first or last bars.
  const QUIET = NARROW * 10;
  let x = QUIET;
  let rects = "";
  const chars = `*${clean}*`.split("");
  chars.forEach((ch, idx) => {
    const pattern = CODE39[ch];
    if (!pattern) return;
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i] === "1" ? WIDE : NARROW;
      if (i % 2 === 0)
        rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
      x += w;
    }
    if (idx < chars.length - 1) x += NARROW; // inter-character gap
  });
  const width = x + QUIET;
  return `<div class="barcode"><svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#fff"/>${rects}</svg></div><div class="bc-text">${esc(
    clean,
  )}</div>`;
}

/** Code 39 patterns: 9 elements per character, 1 = wide, 0 = narrow. */
const CODE39: Record<string, string> = {
  "0": "000110100",
  "1": "100100001",
  "2": "001100001",
  "3": "101100000",
  "4": "000110001",
  "5": "100110000",
  "6": "001110000",
  "7": "000100101",
  "8": "100100100",
  "9": "001100100",
  A: "100001001",
  B: "001001001",
  C: "101001000",
  D: "000011001",
  E: "100011000",
  F: "001011000",
  G: "000001101",
  H: "100001100",
  I: "001001100",
  J: "000011100",
  K: "100000011",
  L: "001000011",
  M: "101000010",
  N: "000010011",
  O: "100010010",
  P: "001010010",
  Q: "000000111",
  R: "100000110",
  S: "001000110",
  T: "000010110",
  U: "110000001",
  V: "011000001",
  W: "111000000",
  X: "010010001",
  Y: "110010000",
  Z: "011010000",
  "-": "010000101",
  ".": "110000100",
  " ": "011000100",
  $: "010101000",
  "/": "010100010",
  "+": "010001010",
  "%": "000101010",
};

/** Strip anything Code 39 cannot represent. */
export function code39Text(value: string) {
  return value
    .toUpperCase()
    .split("")
    .filter((c) => c !== "*" && CODE39[c])
    .join("");
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

/**
 * Real printable band of the paper, in millimetres.
 *
 * A "58mm" roll only prints roughly 48mm of it, and an "80mm" roll about 72mm.
 * Laying the body out at the full paper width is what pushed the left-hand
 * column off the edge of 58mm slips.
 */
export function printableWidthMm(paper: PaperSize) {
  const prefs = getPrinterPrefs();
  const band =
    paper === "30mm"
      ? (prefs.printWidth?.["30mm"] ?? 24)
      : paper === "58mm"
        ? (prefs.printWidth?.["58mm"] ?? 48)
        : paper === "80mm"
          ? (prefs.printWidth?.["80mm"] ?? 72)
          : (PAPER_MM[paper] ?? 80);
  const m = printMargins();
  return Math.max(paper === "30mm" ? 8 : 20, band - m.left - m.right);
}

/** Left nudge for printers whose print head starts a few millimetres in. */
const printOffsetMm = () => getPrinterPrefs().printOffset ?? 0;

const shell = (title: string, body: string, autoPrint = true) => {
  const p = paperCss(receiptCfg.paper);
  const f = receiptCfg.fonts ?? defaultReceiptSettings.fonts;
  const m = printMargins();
  const paper = receiptCfg.paper;
  const slip = paper === "30mm" || paper === "58mm" || paper === "80mm";
  const width = printableWidthMm(paper);
  const bodyWidth = `${width}mm`;
  // Slips are pinned to the left of the printable band (plus any nudge) so
  // nothing can drift off the roll; sheets stay centred.
  const bodyMargin = slip ? `0 0 0 ${printOffsetMm()}mm` : "0 auto";
  return `<!doctype html><html><head>
<meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: ${p.page}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
  * { box-sizing: border-box; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { ${fontCss(f.body)} color: #000; margin: ${bodyMargin}; width: ${bodyWidth}; max-width: 100%; overflow-wrap: anywhere; }
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
  .r { text-align: right; }
  .b { font-weight: 700; }
  .big { font-size: 1.2em; }
  .tag { border: 1px solid #000; padding: 2px 4px; display: inline-block; margin-top: 4px; font-size: 0.8em; letter-spacing: 1px; }
  .barcode { margin-top: 6px; width: 100%; }
  .barcode svg { display: block; width: 100%; }
  .c svg { max-width: 100%; height: auto; }
  .bc-text { text-align: center; font-size: 0.85em; letter-spacing: 3px; margin-top: 2px; }
  @media print {
    html, body { width: ${bodyWidth}; margin: ${bodyMargin}; }
    .no-print { display: none !important; }
  }
  ${scopeReceiptCss(receiptCfg.css)}
</style></head><body><div class="${RECEIPT_SCOPE.slice(1)}">${body}</div>
${
  autoPrint
    ? `<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close()},400)}</script>`
    : ""
}
</body></html>`;
};

const header = (subtitle?: string) => {
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
  return `
  <div class="rcpt-head">
  ${logoAt("above-name")}
  <h1>${esc(receiptCfg.companyName || STORE.name)}</h1>
  ${logoAt("below-name")}
  </div>
  <div class="c muted">${esc(
    activeBranch ? `${activeBranch.name} (${activeBranch.code})` : STORE.line1,
  )}</div>
  ${renderReceiptText(receiptCfg.headerText || "", tokenCtx)
    .split("\n")
    .filter(Boolean)
    .map((l) => `<div class="c muted">${esc(l)}</div>`)
    .join("")}
  ${info.map((l) => `<div class="c muted">${esc(l)}</div>`).join("")}
  ${logoAt("after-details")}
  ${customLines("header")}
  ${qrBlock("header")}
  ${subtitle ? `<div class="c tag">${esc(subtitle)}</div>` : ""}
  <hr>`;
};

function saleBody(sale: Sale, member: Member | null, kind: ReceiptKind) {
  setTokens({
    ...placeTokens(),
    ...dateTokens(sale.createdAt),
    receipt_number: sale.receiptNo,
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
  const rows = sale.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}${l.credit ? ' <span class="tag">CREDIT</span>' : ""}<div class="muted">${l.qty} x ${fmt(l.price)}${
          l.discount
            ? ` - ${l.discountType === "percent" ? `${l.discount}%` : fmt(l.discount)} disc`
            : ""
        }</div></td>${
          hidePrices
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
          ? `<tr><td>Store Credit from Bill #${esc(sale.exchangeOfReceiptNo)}</td><td class="r">-${fmt(sale.exchangeCredit ?? 0)}</td></tr>`
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

  const memberBlock = member
    ? `<hr><div>Member ${esc(member.code)} · ${esc(member.name)}</div>
       ${
         receiptCfg.showPoints
           ? `<div class="muted">Tier ${member.tier} · Points earned ${sale.pointsEarned} · Balance ${member.points}</div>`
           : `<div class="muted">Tier ${member.tier}</div>`
       }`
    : "";

  return `${header(subtitle)}
    <table>
      <tr><td>Receipt</td><td class="r b">${esc(sale.receiptNo)}</td></tr>
      <tr><td>Date</td><td class="r">${new Date(sale.createdAt).toLocaleString()}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(sale.cashier)}</td></tr>
    </table>
    <hr>
    <table>${rows}</table>
    ${totals}
    ${memberBlock}
    <hr>
    ${
      kind === "gift"
        ? receiptCfg.showBarcode
          ? `<div class="c muted">GIFT RETURN CODE</div>${barcodeSvg(`GIFT-${sale.receiptNo}`)}`
          : `<div class="c muted">GIFT RETURN CODE ${esc(sale.receiptNo)}</div>`
        : kind === "kitchen"
          ? ""
          : `${receiptCfg.showBarcode ? barcodeSvg(sale.receiptNo) : ""}${
              sale.method === "card"
                ? `<div class="muted" style="margin-top:8px">Cardholder signature</div><div class="muted">______________________________</div>`
                : ""
            }`
    }
    <hr>
    <div class="c muted rcpt-foot">${
      kind === "gift"
        ? "Exchangeable within 30 days with this slip"
        : esc(renderReceiptText(receiptCfg.footerText || "", tokenCtx))
    }</div>
    ${customLines("footer")}
    ${qrBlock("footer")}
    <div class="c muted">${esc(sale.receiptNo)}</div>`;
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
  const active = sales.filter((s) => s.shiftId === shift.id && !s.refunded);
  const byMethod = ["cash", "card", "wallet", "points"].map((m) => ({
    m,
    n: active.filter((s) => s.method === m).length,
    v: active.filter((s) => s.method === m).reduce((a, s) => a + s.total, 0),
  }));
  const gross = active.reduce((a, s) => a + s.total, 0);
  const tax = active.reduce((a, s) => a + s.tax, 0);
  const cash = byMethod.find((b) => b.m === "cash")!.v;
  const expected = shift.openingFloat + cash;
  const counted = shift.countedCash ?? 0;
  return `${header(kind === "xreport" ? "X REPORT (MID-SHIFT)" : "Z REPORT (SHIFT CLOSE)")}
    <table>
      <tr><td>Cashier</td><td class="r">${esc(shift.cashier)}</td></tr>
      <tr><td>Opened</td><td class="r">${new Date(shift.openedAt).toLocaleString()}</td></tr>
      <tr><td>Closed</td><td class="r">${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : "—"}</td></tr>
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
                `<tr><td>${esc(s.receiptNo)}<div class="muted">${new Date(s.createdAt).toLocaleDateString()}</div></td><td class="r">${fmt(s.total)}</td></tr>`,
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
        ...(barcode ? { barcode: code39Text(barcode) } : {}),
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
    receiptCfg.showBarcode && kind !== "kitchen"
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
      <tr><td>Date</td><td class="r">${new Date().toLocaleString()}</td></tr>
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
  setTokens(bookingTokens(booking, member));
  const rows = booking.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}<div class="muted">${l.qty} x ${fmt(l.price)}</div></td><td class="r">${fmt((l.price - lineUnitDiscount(l)) * l.qty)}</td></tr>`,
    )
    .join("");
  const balance = bookingBalance(booking);
  const paidRows = booking.payments
    .map(
      (p) =>
        `<tr><td>${new Date(p.at).toLocaleDateString()} · ${esc(p.method.toUpperCase())}</td><td class="r">${fmt(p.amount)}</td></tr>`,
    )
    .join("");
  return `${header("BOOKING / PAY LATER SLIP")}
    <table>
      <tr><td>Booking</td><td class="r b">${esc(booking.ref)}</td></tr>
      <tr><td>Date</td><td class="r">${new Date(booking.createdAt).toLocaleString()}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(booking.cashier)}</td></tr>
      ${booking.customerName ? `<tr><td>Customer</td><td class="r">${esc(booking.customerName)}</td></tr>` : ""}
      ${booking.customerPhone ? `<tr><td>Phone</td><td class="r">${esc(booking.customerPhone)}</td></tr>` : ""}
    </table>
    <hr><table>${rows}</table>
    ${chargesBlock(booking)}
    <hr><table>
      <tr><td>Subtotal</td><td class="r">${fmt(booking.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="r">-${fmt(booking.discount)}</td></tr>
      ${receiptCfg.showTax ? `<tr><td>Tax</td><td class="r">${fmt(booking.tax)}</td></tr>` : ""}
      <tr class="b"><td>TOTAL</td><td class="r">${fmt(booking.total)}</td></tr>
    </table>
    <hr><div class="muted">Payments received</div>
    <table>${paidRows || `<tr><td class="muted">None</td><td class="r">${fmt(0)}</td></tr>`}
      <tr><td>Paid to date</td><td class="r">${fmt(booking.paid)}</td></tr>
      <tr class="b big"><td>BALANCE DUE</td><td class="r">${fmt(balance)}</td></tr>
    </table>
    <hr>
    <div class="c b">Collect &amp; settle by ${esc(new Date(booking.dueDate).toDateString())}</div>
    <div class="c muted">Goods are reserved until this date. Bring this slip to collect.</div>
    ${booking.note ? `<div class="c muted">${esc(booking.note)}</div>` : ""}
    ${jobCardBlock(booking)}
    ${termsBlock()}
    ${serviceTermsBlock()}
    ${booking.liabilityAccepted ? `<div class="c muted" style="font-size:9px">Accepted at intake by ${esc(booking.customerName || "customer")}</div>` : ""}
    ${signatureBlock(booking.customerName)}
    ${transferBlock(pay)}
    ${member ? `<hr><div>Member ${esc(member.code)} · ${esc(member.name)}</div>` : ""}
    <hr>${receiptCfg.showBarcode ? barcodeSvg(booking.ref) : ""}
    <div class="c muted rcpt-foot">${esc(renderReceiptText(receiptCfg.footerText || "", tokenCtx))}</div>
    ${customLines("footer")}
    <div class="c muted">${esc(booking.ref)}</div>`;
}

function bookingPaymentBody(booking: Booking, payment: BookingPayment) {
  setTokens({
    ...bookingTokens(booking, null),
    ...dateTokens(payment.at),
    payment_method: payment.method ?? "",
    received: fmt(payment.amount),
  });
  return `${header("PART PAYMENT RECEIPT")}
    <table>
      <tr><td>Booking</td><td class="r b">${esc(booking.ref)}</td></tr>
      <tr><td>Date</td><td class="r">${new Date(payment.at).toLocaleString()}</td></tr>
      <tr><td>Cashier</td><td class="r">${esc(payment.cashier)}</td></tr>
      ${booking.customerName ? `<tr><td>Customer</td><td class="r">${esc(booking.customerName)}</td></tr>` : ""}
    </table>
    <hr><table>
      <tr class="b big"><td>PAID NOW (${esc(payment.method.toUpperCase())})</td><td class="r">${fmt(payment.amount)}</td></tr>
      <tr><td>Booking total</td><td class="r">${fmt(booking.total)}</td></tr>
      <tr><td>Paid to date</td><td class="r">${fmt(booking.paid)}</td></tr>
      <tr class="b"><td>BALANCE DUE</td><td class="r">${fmt(bookingBalance(booking))}</td></tr>
    </table>
    <hr><div class="c">Collect &amp; settle by ${esc(new Date(booking.dueDate).toDateString())}</div>
    ${receiptCfg.bookingSlip?.termsOnPayment ? termsBlock() : ""}
    ${booking.job ? serviceTermsBlock() : ""}
    <hr><div class="c muted rcpt-foot">${esc(renderReceiptText(receiptCfg.footerText || "", tokenCtx))}</div>
    <div class="c muted">${esc(booking.ref)}</div>`;
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
    receiptCfg.showBarcode ? booking.ref : undefined,
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
  const charges = booking.charges ?? [];
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
    j.racketModel ? `<tr><td>Racket</td><td class="r">${esc(j.racketModel)}</td></tr>` : "",
    j.stringType ? `<tr><td>String</td><td class="r">${esc(j.stringType)}</td></tr>` : "",
    j.tensionMain || j.tensionCross
      ? `<tr class="b"><td>Tension (main / cross)</td><td class="r b">${esc(String(j.tensionMain ?? "—"))} / ${esc(String(j.tensionCross ?? j.tensionMain ?? "—"))} ${esc(unit)}</td></tr>`
      : "",
    j.grommetNotes
      ? `<tr><td>Grommet / grip</td><td class="r">${esc(j.grommetNotes)}</td></tr>`
      : "",
    j.droppedOffAt
      ? `<tr><td>Dropped off</td><td class="r">${esc(new Date(j.droppedOffAt).toLocaleString())}</td></tr>`
      : "",
    j.promisedAt
      ? `<tr><td>Ready by</td><td class="r b">${esc(new Date(j.promisedAt).toLocaleString())}</td></tr>`
      : "",
    booking.jobStatus
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
    j.jobNotes ? `<div class="muted">Notes: ${esc(j.jobNotes)}</div>` : ""
  }`;
}

/** Small tag tied to the racket itself while it waits on the rack. */
export function printJobTag(booking: Booking) {
  const j = booking.job;
  const unit = j?.tensionUnit ?? "lb";
  const body = `${header("RACKET JOB TAG")}
    <table>
      <tr><td>Job</td><td class="r b">${esc(booking.ref)}</td></tr>
      <tr><td>Customer</td><td class="r b">${esc(booking.customerName)}</td></tr>
      ${booking.customerPhone ? `<tr><td>Phone</td><td class="r">${esc(booking.customerPhone)}</td></tr>` : ""}
      ${j?.racketModel ? `<tr><td>Racket</td><td class="r">${esc(j.racketModel)}</td></tr>` : ""}
      ${j?.stringType ? `<tr><td>String</td><td class="r">${esc(j.stringType)}</td></tr>` : ""}
      ${
        j?.tensionMain || j?.tensionCross
          ? `<tr class="b big"><td>Tension</td><td class="r">${esc(String(j?.tensionMain ?? "—"))}/${esc(String(j?.tensionCross ?? j?.tensionMain ?? "—"))} ${esc(unit)}</td></tr>`
          : ""
      }
      ${j?.promisedAt ? `<tr><td>Ready by</td><td class="r b">${esc(new Date(j.promisedAt).toLocaleString())}</td></tr>` : ""}
      <tr><td>Status</td><td class="r">${esc((booking.jobStatus ?? "received").toUpperCase())}</td></tr>
    </table>
    ${j?.grommetNotes ? `<div class="muted">${esc(j.grommetNotes)}</div>` : ""}
    ${j?.jobNotes ? `<div class="muted">${esc(j.jobNotes)}</div>` : ""}
    <hr>${barcodeSvg(booking.ref)}
    <div class="c">${qrSvg(booking.ref, 96)}</div>
    ${serviceTermsBlock()}
    <div class="c muted">${esc(booking.ref)}</div>`;
  printHtml(`${booking.ref} job tag`, body, true, booking.ref);
}

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
      <tr><td>Date</td><td class="r">${new Date(transfer.createdAt).toLocaleString()}</td></tr>
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

/**
 * Cash drawer kick. Browsers cannot open a USB drawer directly, so we send the
 * standard ESC/POS pulse sequence (ESC p 0 25 250) through the receipt printer,
 * which is how drawers are wired in practice. If a local ESC/POS bridge agent is
 * installed it is used instead.
 */
export async function openCashDrawer(reason = "Cash drawer opened", shiftId?: string | null) {
  if (!canOpenDrawer()) {
    toast.error("Cash drawer not available on this device", {
      description: "The drawer opens through the receipt printer on the Windows till.",
    });
    return { ok: false, error: "Cash drawer not available on this device" };
  }
  const bytes = drawerPulseBytes();
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
      // Browser fallback: the pulse rides along on a tiny printed slip.
      const kick = String.fromCharCode(...bytes);
      browserPrint(
        shell(
          "drawer",
          `<pre style="font-size:1px;line-height:1px">${kick}</pre><div class="c muted">${esc(reason)}</div>`,
        ),
      );
      return { ok: true };
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
