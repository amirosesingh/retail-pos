/**
 * ESC/POS text renderer.
 *
 * Thermal printers print fastest and most reliably when they receive plain
 * text plus escape codes instead of a driver-rendered bitmap. This module
 * converts the receipt HTML the app already builds into a column-based text
 * slip and encodes it as ESC/POS bytes for the Windows RAW spooler path.
 */

const ESC = 0x1b;
const GS = 0x1d;

export type SlipLine = {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  big?: boolean;
};

/** Character encoding used for the bytes sent to the printer. */
export type SlipEncoding = "ascii" | "cp437" | "cp850" | "cp858" | "utf8";
/** Byte sequence that terminates each printed line. */
export type SlipLineEnding = "lf" | "crlf";

/** ESC t code-page selector for each supported encoding (utf8/ascii: none). */
const CODE_PAGE: Partial<Record<SlipEncoding, number>> = {
  cp437: 0,
  cp850: 2,
  cp858: 19,
};

/**
 * High-range characters shared by CP437/CP850/CP858. Only the symbols that
 * realistically appear on a receipt (currency, accents, box rules) are mapped;
 * anything else degrades to '?'.
 */
const CP437_HIGH: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  "¢": 0x9b,
  "£": 0x9c,
  "¥": 0x9d,
  ƒ: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  "¿": 0xa8,
  "½": 0xab,
  "¼": 0xac,
  "¡": 0xad,
  "«": 0xae,
  "»": 0xaf,
  "░": 0xb0,
  "─": 0xc4,
  "═": 0xcd,
  "°": 0xf8,
  "·": 0xfa,
  "²": 0xfd,
  "■": 0xfe,
};

const CP850_EXTRA: Record<string, number> = {
  ø: 0x9b,
  Ø: 0x9d,
  "×": 0x9e,
  "®": 0xa9,
  "©": 0xb8,
  "¤": 0xcf,
  ð: 0xd0,
  Ð: 0xd1,
  þ: 0xe7,
  Þ: 0xe8,
  µ: 0xe6,
  "±": 0xf1,
  "¾": 0xf3,
  "¶": 0xf4,
  "§": 0xf5,
  "÷": 0xf6,
  "¹": 0xfb,
  "³": 0xfc,
};

// CP858 is CP850 with the euro sign at 0xD5.
const CP858_EXTRA: Record<string, number> = { ...CP850_EXTRA, "€": 0xd5 };

function highMap(encoding: SlipEncoding): Record<string, number> {
  if (encoding === "cp850") return { ...CP437_HIGH, ...CP850_EXTRA };
  if (encoding === "cp858") return { ...CP437_HIGH, ...CP858_EXTRA };
  return CP437_HIGH;
}

function printerSafeText(s: string, encoding: SlipEncoding): string {
  if (encoding === "utf8") return s;
  // Receipt copy uses typographic punctuation, while many thermal printers
  // only expose a DOS code page. Preserve the meaning instead of printing ?.
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●]/g, "*")
    .replace(/·/g, " | ")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/×/g, "x")
    .replace(/−/g, "-")
    .replace(/\u00a0/g, " ");
}

/** Encode one string into printer bytes for the chosen encoding. */
export function encodeText(s: string, encoding: SlipEncoding): number[] {
  const safe = printerSafeText(s, encoding);
  if (encoding === "utf8") return Array.from(new TextEncoder().encode(safe));
  const map = encoding === "ascii" ? {} : highMap(encoding);
  const out: number[] = [];
  for (const ch of safe) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code < 0x80) out.push(code);
    else out.push(map[ch] ?? 0x3f);
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Fold a long string onto `cols` characters. */
function wrap(text: string, cols: number): string[] {
  const words = text.split(" ").filter(Boolean);
  if (!words.length) return [""];
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line.length) line = w;
    else if (line.length + 1 + w.length <= cols) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
    while (line.length > cols) {
      out.push(line.slice(0, cols));
      line = line.slice(cols);
    }
  }
  if (line.length) out.push(line);
  return out;
}

/** "Item name .......  12.00" two-column row. */
function columns(left: string, right: string, cols: number): string[] {
  if (!right) return wrap(left, cols);
  if (right.length >= cols - 1) return [...wrap(left, cols), ...wrap(right, cols)];
  const room = Math.max(1, cols - right.length - 1);
  const wrapped = wrap(left, room);
  const first = wrapped[0] ?? "";
  const head = first.padEnd(room, " ") + " " + right.padStart(right.length, " ");
  return [head.slice(0, cols), ...wrapped.slice(1)];
}

/** Convert one receipt HTML document into printable slip lines. */
export function htmlToSlip(
  html: string,
  cols: number,
  encoding: SlipEncoding = "utf8",
): SlipLine[] {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: SlipLine[] = [];
  const receiptText = (value: string) => collapse(printerSafeText(value, encoding));
  const push = (line: SlipLine) => {
    if (line.text.trim() === "" && lines[lines.length - 1]?.text.trim() === "") return;
    lines.push(line);
  };

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      const cls = child.className?.toString?.() ?? "";
      const centered = /\bc\b|\btag\b|\bbc-text\b/.test(cls) || tag === "h1";
      const bold = /\bb\b/.test(cls) || tag === "h1";

      if (tag === "hr") {
        push({ text: "-".repeat(cols) });
        continue;
      }
      if (tag === "script" || tag === "style" || tag === "svg") continue;
      if (tag === "table") {
        for (const row of Array.from(child.querySelectorAll("tr"))) {
          const cells = Array.from(row.children) as HTMLElement[];
          const rowBold = /\bb\b/.test(row.className?.toString?.() ?? "");
          const rowBig = /\bbig\b/.test(row.className?.toString?.() ?? "");
          const leftCell = cells[0];
          const rightCell = cells[1];
          const notes = leftCell
            ? Array.from(leftCell.querySelectorAll("div")).map((d) =>
                receiptText(d.textContent ?? ""),
              )
            : [];
          const leftMain = leftCell
            ? receiptText(
                Array.from(leftCell.childNodes)
                  .filter((n) => !(n instanceof HTMLElement && n.tagName === "DIV"))
                  .map((n) => n.textContent ?? "")
                  .join(" "),
              )
            : "";
          const right = rightCell ? receiptText(rightCell.textContent ?? "") : "";
          for (const l of columns(leftMain, right, cols))
            push({ text: l, bold: rowBold || rowBig });
          for (const n of notes.filter(Boolean))
            for (const l of wrap(n, cols - 2)) push({ text: `  ${l}` });
        }
        continue;
      }
      if (child.children.length && !["h1", "td", "span"].includes(tag)) {
        // Block wrapper: keep descending unless it only holds plain text.
        const onlyText = Array.from(child.children).every((c) =>
          ["span", "b", "i", "em", "strong"].includes(c.tagName.toLowerCase()),
        );
        if (!onlyText) {
          walk(child);
          continue;
        }
      }
      const text = receiptText(child.textContent ?? "");
      if (!text) continue;
      for (const l of wrap(text, cols))
        push({
          text: l,
          ...(centered ? { align: "center" as const } : {}),
          bold,
          big: tag === "h1",
        });
    }
  };

  walk(doc.body);
  while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
  return lines;
}

/** Encode slip lines as ESC/POS bytes (init, styling, feed, cut). */
export function slipToBytes(
  lines: SlipLine[],
  opts: {
    cut?: boolean;
    encoding?: SlipEncoding;
    lineEnding?: SlipLineEnding;
    /** Code 39 value printed as a real barcode at the end of the slip. */
    barcode?: string;
    /** Blank columns inserted at the start of every line (left margin). */
    indent?: number;
  } = {},
): number[] {
  const encoding = opts.encoding ?? "cp437";
  const eol = opts.lineEnding === "crlf" ? [0x0d, 0x0a] : [0x0a];
  const bytes: number[] = [ESC, 0x40]; // initialise
  const page = CODE_PAGE[encoding];
  if (page !== undefined) bytes.push(ESC, 0x74, page); // select character code table
  const pad = " ".repeat(Math.max(0, Math.min(8, opts.indent ?? 0)));
  const text = (s: string) => {
    for (const b of encodeText(s, encoding)) bytes.push(b);
  };

  for (const line of lines) {
    bytes.push(ESC, 0x61, line.align === "center" ? 1 : 0);
    bytes.push(ESC, 0x45, line.bold ? 1 : 0);
    bytes.push(GS, 0x21, line.big ? 0x11 : 0x00);
    text(line.align === "center" ? line.text : pad + line.text);
    bytes.push(...eol);
  }

  bytes.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00);
  const bc = (opts.barcode ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z\-.$/+% ]/g, "")
    .slice(0, 255);
  if (bc) {
    bytes.push(ESC, 0x61, 1); // centre
    bytes.push(GS, 0x68, 60); // barcode height
    bytes.push(GS, 0x77, 2); // module width
    bytes.push(GS, 0x48, 2); // print the number below the bars
    // Function B is length-prefixed and is understood by current Epson-compatible
    // printers and clones that ignore the older NUL-terminated command.
    bytes.push(GS, 0x6b, 69, bc.length); // Code 39, length-prefixed
    for (const b of encodeText(bc, "ascii")) bytes.push(b);
    bytes.push(...eol);
    bytes.push(ESC, 0x61, 0);
  }
  for (let i = 0; i < 4; i++) bytes.push(...eol);
  if (opts.cut !== false) bytes.push(GS, 0x56, 66, 0x00); // partial cut with feed
  return bytes;
}

/** Column count for a slip width. */
export function columnsForPaper(paper: string): number {
  return paper === "30mm" ? 16 : paper === "58mm" ? 32 : 42;
}

export function htmlToEscPos(
  html: string,
  paper: string,
  opts: {
    encoding?: SlipEncoding;
    lineEnding?: SlipLineEnding;
    barcode?: string;
    indent?: number;
    /** Override the printable column count (narrower paper / wider margins). */
    cols?: number;
  } = {},
): number[] {
  const cols = Math.max(
    paper === "30mm" ? 8 : 16,
    (opts.cols ?? columnsForPaper(paper)) - Math.max(0, opts.indent ?? 0),
  );
  return slipToBytes(htmlToSlip(html, cols, opts.encoding ?? "cp437"), opts);
}
