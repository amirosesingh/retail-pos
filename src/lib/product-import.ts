/**
 * The catalogue importer's thinking half.
 *
 * Everything here is plain data in, plain data out: read a spreadsheet's rows,
 * work out what each one means, decide which are new items and which top up an
 * existing one, and account for every single row that will not be saved.
 *
 * Nothing in this file touches the database, the screen or the network, so the
 * rules can be tested on their own and a large file can be worked through
 * without the till freezing.
 */
import type { Product } from "@/core/types/pos-types";
import { normaliseCode, productCodes } from "@/lib/product-lookup";

/** A row that passed every check and is ready to be saved. */
export type ImportRow = {
  /** 1-based line in the spreadsheet, counting the header, for messages. */
  line: number;
  barcode: string;
  name: string;
  price: number;
  cost: number;
  category: string;
  stock: number;
  customPoints: number;
  unit?: string;
  /** Database identity captured during validation, when this is an existing item. */
  existingProductId?: string;
  /** Authoritative SQL record found during batch validation. */
  existingProduct?: Product;
  /** Apply reviewed source values to an incomplete/conflicting existing item. */
  updateExisting?: boolean;
  /** Matches something already in the catalogue — a restock, not a new item. */
  existing: boolean;
  /** Stable key for this row, so a resumed import recognises what it saved. */
  key: string;
};

/** A row that will not be saved, with the reason in plain words. */
export type RejectedRow = {
  line: number;
  barcode: string;
  name: string;
  reason: string;
};

export type ParsedImport = {
  /** Rows read from the file, including the bad ones. */
  total: number;
  rows: ImportRow[];
  skipped: RejectedRow[];
};

export type ImportField =
  | "barcode"
  | "name"
  | "price"
  | "cost"
  | "category"
  | "unit"
  | "stock"
  | "customPoints";

export type ImportReviewStatus =
  | "ready"
  | "new_product"
  | "missing_information"
  | "conflict";

/**
 * Editable staging row shared by catalogue and purchasing imports. It keeps
 * source values, database values and validation issues separate so the UI can
 * ask only for fields that genuinely need attention.
 */
export type ImportReviewRow = {
  line: number;
  key: string;
  barcode: string;
  name: string;
  price: number | null;
  cost: number | null;
  category: string;
  unit: string;
  stock: number;
  customPoints: number;
  existingProductId?: string;
  existingProduct?: Product;
  status: ImportReviewStatus;
  missingFields: ImportField[];
  conflictFields: ImportField[];
  issue?: string;
  /** Set after the operator explicitly accepts edits for an existing record. */
  updateExisting: boolean;
  quantityRequired?: boolean;
};

export type ImportReview = {
  total: number;
  rows: ImportReviewRow[];
  blankRows: number;
};

/** Canonical import fields. Required flags mirror the product save workflow. */
export const PRODUCT_IMPORT_FIELDS: ReadonlyArray<{
  key: ImportField;
  label: string;
  required: boolean;
}> = [
  { key: "barcode", label: "Barcode", required: true },
  { key: "name", label: "Product", required: true },
  { key: "price", label: "Selling price", required: true },
  { key: "cost", label: "Cost", required: false },
  { key: "category", label: "Category", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "stock", label: "Quantity", required: false },
  { key: "customPoints", label: "Points", required: false },
] as const;

export const IMPORT_HEADERS = [
  "barcode",
  "name",
  "price",
  "cost",
  "category",
  "unit",
  "stock_quantity",
  "custom_points",
] as const;

/** Default rows per save. Small enough to stay responsive, large enough to be quick. */
export const DEFAULT_BATCH_SIZE = 200;

/** Failures that affect the whole import rather than one malformed row. */
export function isSystemicImportFailure(error: unknown): boolean {
  const value = error as { message?: string; code?: string; status?: number } | undefined;
  const message = String(value?.message ?? error ?? "").toLowerCase();
  const code = String(value?.code ?? "").toUpperCase();
  const status = Number(value?.status ?? 0);
  return (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    code === "PGRST301" ||
    /jwt|session expired|not signed in|authentication|permission denied|row-level security/.test(message) ||
    /failed to fetch|network|offline|timeout|timed out|econn|connection lost/.test(message) ||
    /sql server.*(?:unavailable|not connected)|database bridge unavailable|local transaction storage unavailable/.test(message)
  );
}

/**
 * Save a batch atomically, then isolate rejected rows by bisecting the batch.
 * This keeps one invalid database row from discarding every valid neighbour.
 */
export async function persistBatchWithIsolation<T>(
  rows: T[],
  save: (rows: T[]) => Promise<unknown>,
  onSaved: (rows: T[]) => void | Promise<void>,
  onFailed: (rows: T[], error: unknown) => void | Promise<void>,
  isolateFailures = true,
): Promise<void> {
  if (!rows.length) return;
  try {
    await save(rows);
    await onSaved(rows);
  } catch (error) {
    if (isolateFailures && rows.length > 1 && !isSystemicImportFailure(error)) {
      const middle = Math.ceil(rows.length / 2);
      await persistBatchWithIsolation(rows.slice(0, middle), save, onSaved, onFailed, true);
      await persistBatchWithIsolation(rows.slice(middle), save, onSaved, onFailed, true);
      return;
    }
    await onFailed(rows, error);
  }
}

const headerKey = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_");

const textValue = (value: unknown) => String(value ?? "").trim();

const equalText = (a: string | undefined, b: string | undefined) =>
  textValue(a).localeCompare(textValue(b), undefined, { sensitivity: "accent" }) === 0;

const equalNumber = (a: number | undefined, b: number | null) =>
  b === null || Math.abs(Number(a ?? 0) - b) < 0.000001;

/** Numbers arrive as "RM 12.50", "1,200" or blank; read what is really there. */
export function readNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** One spreadsheet row, indexed by tidy header name. */
function fieldReader(raw: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  for (const [h, v] of Object.entries(raw)) map.set(headerKey(h), v);
  return (name: string) => map.get(name);
}

function validateReviewRow(row: ImportReviewRow): ImportReviewRow {
  const missingFields: ImportField[] = [];
  if (!row.barcode.trim()) missingFields.push("barcode");
  if (!row.name.trim()) missingFields.push("name");
  if (row.price === null || row.price <= 0) missingFields.push("price");
  if (row.cost !== null && row.cost < 0) missingFields.push("cost");
  if (!Number.isFinite(row.stock) || row.stock < 0 || (row.quantityRequired && row.stock <= 0))
    missingFields.push("stock");

  let status: ImportReviewStatus;
  if (row.issue || row.conflictFields.length) status = "conflict";
  else if (missingFields.length) status = "missing_information";
  else status = row.existingProductId ? "ready" : "new_product";
  return { ...row, missingFields, status };
}

/** Revalidate one row after an inline edit or a bulk fill-down operation. */
export function updateReviewRow(
  row: ImportReviewRow,
  patch: Partial<Pick<ImportReviewRow, ImportField>>,
): ImportReviewRow {
  const changed = Object.keys(patch) as ImportField[];
  return validateReviewRow({
    ...row,
    ...patch,
    issue: changed.includes("barcode") ? undefined : row.issue,
    conflictFields: row.conflictFields.filter((field) => !changed.includes(field)),
    updateExisting: row.updateExisting || (!!row.existingProductId && changed.length > 0),
  });
}

/** Resolve every differing imported value against the current database row. */
export function resolveReviewConflict(
  row: ImportReviewRow,
  source: "database" | "import",
): ImportReviewRow {
  if (!row.existingProduct) return validateReviewRow({ ...row, conflictFields: [], issue: undefined });
  const existing = row.existingProduct;
  const patch: Partial<Pick<ImportReviewRow, ImportField>> = {};
  if (source === "database") {
    for (const field of row.conflictFields) {
      if (field === "name") patch.name = existing.name;
      if (field === "price") patch.price = existing.price;
      if (field === "cost") patch.cost = existing.cost;
      if (field === "category") patch.category = existing.category ?? "";
      if (field === "unit") patch.unit = existing.unit ?? "";
    }
  }
  return validateReviewRow({
    ...row,
    ...patch,
    issue: undefined,
    conflictFields: [],
    updateExisting: source === "import" && row.conflictFields.length > 0,
  });
}

/**
 * Build an editable review model without discarding incomplete rows. Existing
 * database values fill blanks; contradictory source values stay visible until
 * the operator chooses which side wins.
 */
export function planImportReview(
  records: Record<string, unknown>[],
  catalogue: Product[],
  options: { quantityRequired?: boolean } = {},
): ImportReview {
  const byCode = new Map<string, Product>();
  for (const product of catalogue) {
    for (const code of productCodes(product)) if (!byCode.has(code)) byCode.set(code, product);
  }

  const rows: ImportReviewRow[] = [];
  const seen = new Map<string, number>();
  let blankRows = 0;

  records.forEach((raw, index) => {
    const line = index + 2;
    const field = fieldReader(raw);
    const barcode = textValue(field("barcode") ?? field("sku") ?? field("code"));
    const importedName = textValue(field("name") ?? field("product") ?? field("description"));
    if (!barcode && !importedName) {
      blankRows += 1;
      return;
    }

    const key = normaliseCode(barcode);
    const existing = key ? byCode.get(key) : undefined;
    const importedPrice = readNumber(field("price") ?? field("selling_price") ?? field("retail"));
    const importedCost = readNumber(field("cost") ?? field("cost_price") ?? field("unit_cost"));
    const importedCategory = textValue(field("category"));
    const importedUnit = textValue(field("unit") ?? field("uom"));
    const stock = readNumber(
      field("stock_quantity") ?? field("quantity") ?? field("qty") ?? field("received"),
    );
    const duplicateLine = key ? seen.get(key) : undefined;
    if (key && duplicateLine === undefined) seen.set(key, line);

    const conflictFields: ImportField[] = [];
    if (existing) {
      if (importedName && !equalText(importedName, existing.name)) conflictFields.push("name");
      if (!equalNumber(existing.price, importedPrice)) conflictFields.push("price");
      if (!equalNumber(existing.cost, importedCost)) conflictFields.push("cost");
      if (importedCategory && !equalText(importedCategory, existing.category))
        conflictFields.push("category");
      if (importedUnit && !equalText(importedUnit, existing.unit)) conflictFields.push("unit");
    }

    rows.push(
      validateReviewRow({
        line,
        key: key || `line:${line}`,
        barcode,
        name: importedName || existing?.name || "",
        price: importedPrice ?? existing?.price ?? null,
        cost: importedCost ?? existing?.cost ?? null,
        category: importedCategory || existing?.category || "",
        unit: importedUnit || existing?.unit || "",
        stock: Math.max(0, Math.round(stock ?? 0)),
        customPoints: readNumber(field("custom_points")) ?? existing?.customPoints ?? 0,
        existingProductId: existing?.id,
        existingProduct: existing,
        status: "ready",
        missingFields: [],
        conflictFields,
        issue:
          duplicateLine === undefined
            ? undefined
            : `Duplicate barcode — the same code is already on line ${duplicateLine}`,
        updateExisting: false,
        quantityRequired: options.quantityRequired,
      }),
    );
  });

  return { total: records.length, rows, blankRows };
}

/** Convert a completed review row into the existing batched save contract. */
export function reviewRowToImport(row: ImportReviewRow): ImportRow | null {
  if (row.status === "missing_information" || row.status === "conflict") return null;
  if (row.price === null) return null;
  return {
    line: row.line,
    barcode: row.barcode.trim(),
    name: row.name.trim(),
    price: row.price,
    cost: row.cost ?? 0,
    category: row.category.trim(),
    stock: row.stock,
    customPoints: row.customPoints,
    existing: !!row.existingProductId,
    key: normaliseCode(row.barcode),
    existingProductId: row.existingProductId,
    existingProduct: row.existingProduct,
    unit: row.unit.trim() || undefined,
    updateExisting: row.updateExisting,
  };
}

/**
 * Turn raw spreadsheet rows into a saveable plan.
 *
 * Duplicate codes inside the same file are reported rather than saved twice,
 * and a row that matches a catalogue item is marked as a restock.
 */
export function planImport(records: Record<string, unknown>[], catalogue: Product[]): ParsedImport {
  // One pass over the catalogue builds the lookup, instead of scanning the
  // whole catalogue once per row.
  const byCode = new Map<string, Product>();
  for (const p of catalogue) {
    for (const code of productCodes(p)) if (!byCode.has(code)) byCode.set(code, p);
  }

  const rows: ImportRow[] = [];
  const skipped: RejectedRow[] = [];
  const seen = new Map<string, number>();

  records.forEach((raw, index) => {
    const line = index + 2; // header is line 1
    const field = fieldReader(raw);
    const barcode = String(field("barcode") ?? field("sku") ?? "").trim();
    const name = String(field("name") ?? "").trim();

    if (!barcode && !name) return; // a blank trailing line is not an error
    if (!barcode) {
      skipped.push({ line, barcode, name, reason: "Missing barcode" });
      return;
    }
    if (!name) {
      skipped.push({ line, barcode, name, reason: "Missing product name" });
      return;
    }

    const code = normaliseCode(barcode);
    const firstSeen = seen.get(code);
    if (firstSeen !== undefined) {
      skipped.push({
        line,
        barcode,
        name,
        reason: `Duplicate barcode — the same code is already on line ${firstSeen}`,
      });
      return;
    }

    const price = readNumber(field("price"));
    if (price === null) {
      skipped.push({ line, barcode, name, reason: "Missing price" });
      return;
    }
    if (price < 0) {
      skipped.push({ line, barcode, name, reason: "Price cannot be negative" });
      return;
    }
    const cost = readNumber(field("cost"));
    if (cost !== null && cost < 0) {
      skipped.push({ line, barcode, name, reason: "Cost cannot be negative" });
      return;
    }
    const stock = readNumber(field("stock_quantity")) ?? 0;
    if (!Number.isFinite(stock)) {
      skipped.push({ line, barcode, name, reason: "Invalid stock quantity" });
      return;
    }

    seen.set(code, line);
    rows.push({
      line,
      barcode,
      name,
      price,
      cost: cost ?? Number((price * 0.6).toFixed(2)),
      category: String(field("category") ?? "").trim() || "Imported",
      stock: Math.round(stock),
      customPoints: readNumber(field("custom_points")) ?? 0,
      existing: byCode.has(code),
      key: code,
    });
  });

  return { total: records.length, rows, skipped };
}

/** Split the plan into save-sized groups. */
export function batches<T>(items: T[], size = DEFAULT_BATCH_SIZE): T[][] {
  const safe = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += safe) out.push(items.slice(i, i + safe));
  return out;
}

/** What happened to a whole import, row for row. */
export type ImportOutcome = {
  importId: string;
  fileName: string;
  startedAt: string;
  finishedAt?: string;
  total: number;
  created: number;
  restocked: number;
  skipped: RejectedRow[];
  failed: RejectedRow[];
  /** Rows never attempted — the run stopped or was interrupted. */
  pending: RejectedRow[];
};

/** Reads back as a sentence, for the summary card and the toast. */
export function describeOutcome(o: ImportOutcome): string {
  const done = o.created + o.restocked;
  const left = o.failed.length + o.pending.length;
  return left
    ? `${done} of ${o.total} rows saved · ${left} still to sort out`
    : `${done} of ${o.total} rows saved`;
}

/** Every rejected row as a spreadsheet-friendly table. */
export function outcomeReportRows(o: ImportOutcome): string[][] {
  const rows: string[][] = [["line", "barcode", "name", "status", "reason"]];
  for (const r of o.skipped) rows.push([String(r.line), r.barcode, r.name, "skipped", r.reason]);
  for (const r of o.failed) rows.push([String(r.line), r.barcode, r.name, "failed", r.reason]);
  for (const r of o.pending) rows.push([String(r.line), r.barcode, r.name, "pending", r.reason]);
  return rows;
}

/** How the store should run a batch import. */
export type ImportProductsOptions = {
  /** Rows per save. */
  batchSize?: number;
  /** Row keys a previous, interrupted run already stored. */
  alreadyDone?: string[];
  /** Ties the audit entries of one run together. */
  importId?: string;
  /** Stop after the first failed batch instead of carrying on. */
  stopOnBatchFailure?: boolean;
  /** Purchasing validates/creates catalogue rows now and posts stock only when the invoice closes. */
  applyStock?: boolean;
  onProgress?: (done: number, total: number) => void;
  onBatchSaved?: (keys: string[], totals: { created: number; restocked: number }) => void;
};

export type ImportProductsResult = {
  created: number;
  restocked: number;
  failed: RejectedRow[];
  pending: RejectedRow[];
  /** Row keys genuinely stored in this run. */
  savedKeys: string[];
  /** Final product records for successful rows, used to link receiving lines. */
  savedProducts: Product[];
};

/** Plain wording for why a batch would not save. */
export function importFailureReason(error: unknown): string {
  const value = error as { message?: string; code?: string; status?: number } | undefined;
  const message = String(value?.message ?? error ?? "").trim();
  const lower = message.toLowerCase();
  if (!message) return "The database refused the batch without saying why";
  if (
    Number(value?.status ?? 0) === 401 ||
    String(value?.code ?? "").toUpperCase() === "PGRST301" ||
    /jwt|session expired|not signed in|authentication/.test(lower)
  )
    return "Your sign-in expired while saving. Sign in again, then resume this import";
  if (lower.includes("permission") || lower.includes("row-level security"))
    return "Not allowed to add products here";
  if (lower.includes("duplicate key") || lower.includes("unique"))
    return "A code in this batch is already used by another product";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("offline"))
    return "Connection lost while saving this batch";
  if (lower.includes("violates") || lower.includes("constraint"))
    return `The database rejected this batch: ${message}`;
  return message;
}
