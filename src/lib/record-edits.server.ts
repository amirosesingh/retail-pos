/**
 * Server-only side of "editing something that was already posted".
 *
 * Two jobs: hold a posted record while its edit waits for a decision, and
 * keep an immutable before/after entry once the edit is actually made. Both
 * are written with the internal service key so a till can never mark a record
 * as approved, or rewrite its own history.
 */
type Row = Record<string, unknown>;

/** Which record book a row belongs to. */
export type RecordKind = "stock_count" | "purchase_order" | "sale";

const TABLE: Record<RecordKind, string> = {
  stock_count: "stock_count_drafts",
  purchase_order: "purchase_orders",
  sale: "sales",
};

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const { serviceRest } = await import("@/core/api/pos-relay.server");
  return serviceRest(path, init);
}

const idFilter = (id: string) => `id=eq.${encodeURIComponent(id)}`;

/** The hold currently on a record, if any. */
export async function readPendingEdit(
  kind: RecordKind,
  recordId: string,
): Promise<{ requestId: string | null; by: string | null; at: string | null } | null> {
  const res = await rest(
    `${TABLE[kind]}?select=pending_edit_request_id,pending_edit_by,pending_edit_at&${idFilter(recordId)}&limit=1`,
  );
  if (!res.ok) return null;
  const row = ((await res.json()) as Row[])[0];
  if (!row) return null;
  return {
    requestId: (row["pending_edit_request_id"] as string) ?? null,
    by: (row["pending_edit_by"] as string) ?? null,
    at: (row["pending_edit_at"] as string) ?? null,
  };
}

/**
 * Put a record on hold. It only ever succeeds when the record is free, so two
 * people cannot queue an edit of the same record at the same time.
 */
export async function setPendingEdit(input: {
  kind: RecordKind;
  recordId: string;
  requestId: string;
  by: string;
}): Promise<boolean> {
  const res = await rest(
    `${TABLE[input.kind]}?${idFilter(input.recordId)}&pending_edit_request_id=is.null`,
    {
      method: "PATCH",
      body: JSON.stringify({
        pending_edit_request_id: input.requestId,
        pending_edit_by: input.by,
        pending_edit_at: new Date().toISOString(),
      }),
      prefer: "return=representation",
    },
  );
  if (!res.ok) return false;
  return ((await res.json()) as Row[]).length > 0;
}

/** Release the hold — the edit was made, withdrawn, rejected or expired. */
export async function clearPendingEdit(kind: RecordKind, recordId: string): Promise<void> {
  await rest(`${TABLE[kind]}?${idFilter(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      pending_edit_request_id: null,
      pending_edit_by: null,
      pending_edit_at: null,
    }),
    prefer: "return=minimal",
  });
}

/** Release every hold that points at a request which is no longer pending. */
export async function releaseDecidedHold(requestId: string): Promise<void> {
  for (const table of Object.values(TABLE)) {
    await rest(`${table}?pending_edit_request_id=eq.${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        pending_edit_request_id: null,
        pending_edit_by: null,
        pending_edit_at: null,
      }),
      prefer: "return=minimal",
    }).catch(() => undefined);
  }
}

/** One immutable line of record history: what it was, and what it became. */
export async function writeRecordEdit(entry: {
  recordType: RecordKind;
  recordId: string;
  reference?: string | null;
  storeId?: string | null;
  terminalId?: string | null;
  actionKey: string;
  requestId?: string | null;
  editedBy?: string | null;
  editedByName?: string | null;
  authorizedBy?: string | null;
  authorizedByName?: string | null;
  modeUsed?: string | null;
  before: unknown;
  after: unknown;
  stockDeltas?: Record<string, number>;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await rest("record_edits", {
      method: "POST",
      body: JSON.stringify([
        {
          record_type: entry.recordType,
          record_id: entry.recordId,
          reference: entry.reference ?? null,
          store_id: entry.storeId ?? "",
          terminal_id: entry.terminalId ?? "",
          action_key: entry.actionKey,
          request_id: entry.requestId ?? null,
          edited_by: entry.editedBy ?? null,
          edited_by_name: entry.editedByName ?? null,
          authorized_by: entry.authorizedBy ?? null,
          authorized_by_name: entry.authorizedByName ?? null,
          mode_used: entry.modeUsed ?? null,
          before_value: entry.before ?? {},
          after_value: entry.after ?? {},
          stock_deltas: entry.stockDeltas ?? {},
          note: entry.note ?? null,
        },
      ]),
      prefer: "return=minimal",
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** One line of a record's edit history, in the shape the screens read. */
export type RecordEditRow = {
  id: string;
  record_type: string;
  record_id: string;
  reference: string | null;
  store_id: string | null;
  action_key: string;
  edited_by: string | null;
  edited_by_name: string | null;
  authorized_by: string | null;
  mode_used: string | null;
  before_value: string;
  after_value: string;
  stock_deltas: string;
  note: string | null;
  created_at: string;
};

const asText = (v: unknown): string =>
  v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);

/** History for one record, newest first. Nested values travel as JSON text. */
export async function listRecordEdits(
  kind: RecordKind,
  recordId: string,
): Promise<RecordEditRow[]> {
  const res = await rest(
    `record_edits?select=*&record_type=eq.${kind}&record_id=eq.${encodeURIComponent(recordId)}&order=created_at.desc&limit=50`,
  );
  if (!res.ok) return [];
  return ((await res.json()) as Row[]).map((r) => ({
    id: String(r["id"] ?? ""),
    record_type: String(r["record_type"] ?? ""),
    record_id: String(r["record_id"] ?? ""),
    reference: (r["reference"] as string) ?? null,
    store_id: (r["store_id"] as string) ?? null,
    action_key: String(r["action_key"] ?? ""),
    edited_by: (r["edited_by"] as string) ?? null,
    edited_by_name: (r["edited_by_name"] as string) ?? null,
    authorized_by: (r["authorized_by"] as string) ?? null,
    mode_used: (r["mode_used"] as string) ?? null,
    before_value: asText(r["before_value"]),
    after_value: asText(r["after_value"]),
    stock_deltas: asText(r["stock_deltas"]),
    note: (r["note"] as string) ?? null,
    created_at: String(r["created_at"] ?? ""),
  }));
}

/** Recent posted-record corrections for the management audit screen. */
export async function listRecentRecordEdits(
  storeId: string | null,
  limit = 200,
): Promise<RecordEditRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const branch = storeId ? `&store_id=eq.${encodeURIComponent(storeId)}` : "";
  const res = await rest(`record_edits?select=*${branch}&order=created_at.desc&limit=${safeLimit}`);
  if (!res.ok) return [];
  return ((await res.json()) as Row[]).map((r) => ({
    id: String(r["id"] ?? ""),
    record_type: String(r["record_type"] ?? ""),
    record_id: String(r["record_id"] ?? ""),
    reference: (r["reference"] as string) ?? null,
    store_id: (r["store_id"] as string) ?? null,
    action_key: String(r["action_key"] ?? ""),
    edited_by: (r["edited_by"] as string) ?? null,
    edited_by_name: (r["edited_by_name"] as string) ?? null,
    authorized_by: (r["authorized_by"] as string) ?? null,
    mode_used: (r["mode_used"] as string) ?? null,
    before_value: asText(r["before_value"]),
    after_value: asText(r["after_value"]),
    stock_deltas: asText(r["stock_deltas"]),
    note: (r["note"] as string) ?? null,
    created_at: String(r["created_at"] ?? ""),
  }));
}
