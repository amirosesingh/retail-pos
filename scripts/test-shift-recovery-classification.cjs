"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyRetainedShiftGraph, TABLES, SUMMARY } = require("../electron/sync/shift-recovery-classification.cjs");
const { parseExactJson } = require("../electron/sync/shift-recovery-exact.cjs");
const SHIFT = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const TERMINAL = "33333333-3333-4333-8333-333333333333";
const COUNT = "44444444-4444-4444-8444-444444444444";
const RECON = "55555555-5555-4555-8555-555555555555";
const EVENT = "66666666-6666-4666-8666-666666666666";
const NOTICE = "77777777-7777-4777-8777-777777777777";
const ALERT = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";
const AT = "2026-11-02T12:00:00.1234567Z";
const EARLIER = "2026-11-02T01:00:00.1234567Z";
const NUMERIC = ["counted_cash", "counted_card", "counted_digital", "expected_cash", "expected_card", "expected_digital", "variance_cash", "variance_card", "variance_digital", "variance_total"];
const FIXED = { counted_cash: "100.00", counted_card: "20", counted_digital: "10", expected_cash: "95", expected_card: "20", expected_digital: "10", variance_cash: "5", variance_card: "0", variance_digital: "0", variance_total: "5", variance_status: "OVER" };
const makeColumns = entries => entries.map(([name, type]) => ({ cloudColumn: name, sqlServerColumn: name, cloudType: type, sqlServerType: type, primaryKey: name === "id" }));
function registry() {
  const base = [["id", "uuid"], ["store_id", "text"]];
  const children = [...base, ["shift_id", "uuid"]];
  const tracked = [["row_version", "bigint"], ["created_at", "timestamp with time zone"], ["updated_at", "timestamp with time zone"]];
  return { tables: [
    { cloudTable: "shifts", columns: makeColumns([...base, ["terminal_id", "text"], ["status", "text"], ["state", "text"], ["opened_at", "timestamp with time zone"], ["closed_at", "timestamp with time zone"], ...tracked,
      ...NUMERIC.map(key => [key, "numeric"]), ["final_counted_cash", "numeric"], ["closing_float", "numeric"], ["variance_status", "text"], ["note", "text"], ["overdue", "boolean"], ["closed_by_staff_id", "text"]]) },
    { cloudTable: "shift_cash_counts", columns: makeColumns([...children, ["kind", "text"], ...["cash", "card", "digital"].map(tender => [`counted_${tender}`, "numeric"]), ["denominations", "jsonb"], ["actor_staff_id", "text"], ...tracked]) },
    { cloudTable: "shift_reconciliations", columns: makeColumns([...children, ["count_id", "uuid"], ...NUMERIC.map(key => [key, "numeric"]), ["variance_status", "text"], ...tracked]) },
    { cloudTable: "shift_close_events", columns: makeColumns([...children, ["event", "text"], ["detail", "jsonb"], ...tracked]) },
    { cloudTable: "shift_notifications", columns: makeColumns([...children, ["channels", "jsonb"], ...tracked]) },
    { cloudTable: "shift_variance_alerts", columns: makeColumns([...children, ["reconciliation_id", "uuid"], ["message", "text"], ...tracked]) },
  ] };
}
function fixture() {
  const schema = registry();
  const row = (name, values) => Object.assign(Object.fromEntries(schema.tables.find(table => table.cloudTable === name).columns.map(column => [column.cloudColumn, null])), {
    store_id: BRANCH, ...(name === "shifts" ? {} : { shift_id: SHIFT }), row_version: "3", created_at: AT, updated_at: AT,
  }, values);
  const localTables = [
    { table: "shifts", rows: [row("shifts", { id: SHIFT, terminal_id: TERMINAL, status: "CLOSED", state: "CLOSED", opened_at: EARLIER, closed_at: AT, created_at: EARLIER, ...FIXED, final_counted_cash: "100", closing_float: "100", overdue: 0, closed_by_staff_id: "cashier-a" })] },
    { table: "shift_cash_counts", rows: [row("shift_cash_counts", { id: COUNT, kind: "ORIGINAL", counted_cash: "100", counted_card: "20", counted_digital: "10", denominations: '{"label":"saved"}', actor_staff_id: "cashier-a" })] },
    { table: "shift_reconciliations", rows: [row("shift_reconciliations", { id: RECON, count_id: COUNT, ...FIXED })] },
    { table: "shift_close_events", rows: [row("shift_close_events", { id: EVENT, event: "reconciled", detail: '{"count_id":"' + COUNT + '","source":"original"}' })] },
    { table: "shift_notifications", rows: [row("shift_notifications", { id: NOTICE, channels: '["in_app"]' })] },
    { table: "shift_variance_alerts", rows: [row("shift_variance_alerts", { id: ALERT, reconciliation_id: RECON, message: "Saved variance" })] },
  ];
  const cloudTables = structuredClone(localTables);
  for (const entry of cloudTables) for (const saved of entry.rows) {
    for (const column of schema.tables.find(table => table.cloudTable === entry.table).columns) {
      if (column.cloudType === "jsonb" && saved[column.cloudColumn] !== null) saved[column.cloudColumn] = JSON.parse(saved[column.cloudColumn]);
      if (column.cloudType === "boolean" && saved[column.cloudColumn] !== null) saved[column.cloudColumn] = Boolean(saved[column.cloudColumn]);
    }
  }
  return { registry: schema, branchId: BRANCH, shiftId: SHIFT, localTables, cloudTables };
}
const rows = (f, name, side = "localTables") => f[side].find(part => part.table === name).rows;
const parent = (f, side) => rows(f, "shifts", side)[0];
function expectPlan(f, kind, fields) {
  const before = JSON.stringify(f);
  const result = classifyRetainedShiftGraph(f);
  assert.equal(result.kind, kind);
  assert.equal(result.autoApply, false); assert.equal(result.needsReview, kind !== "exact");
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.changedParentFields));
  if (fields) assert.deepEqual(result.changedParentFields, [...fields].sort());
  assert.equal(JSON.stringify(f), before, "Classification cannot mutate either graph or registry");
  for (const raw of [SHIFT, BRANCH, TERMINAL, COUNT, "cashier-a"]) assert.equal(JSON.stringify(result).includes(raw), false);
  return result;
}
function expectRefusal(f, code = "ESYNC_GRAPH") {
  const before = JSON.stringify(f);
  assert.throws(() => classifyRetainedShiftGraph(f), error => error.code === code && error.table === "shifts" && !error.message.includes(SHIFT));
  assert.equal(JSON.stringify(f), before);
}
function open(f, side) {
  const target = parent(f, side);
  Object.assign(target, { status: "OPEN", state: "ACTIVE", closed_at: null, final_counted_cash: null, closing_float: null, variance_status: null, closed_by_staff_id: null });
  for (const field of NUMERIC) target[field] = null;
  for (const name of TABLES.slice(1)) rows(f, name, side).length = 0;
}

test("exact complete registered graph remains a non-mutating plan, never an upload authority", () => {
  expectPlan(fixture(), "exact", []);
});

test("legacy uncounted card/digital NULL facts remain exact without inventing zero", () => {
  const f = fixture();
  for (const side of ["localTables", "cloudTables"]) {
    for (const name of ["shifts", "shift_reconciliations", "shift_cash_counts"]) {
      const row = rows(f, name, side)[0]; row.counted_card = null; row.counted_digital = null;
      if (name !== "shift_cash_counts") { row.variance_card = null; row.variance_digital = null; }
    }
  }
  expectPlan(f, "exact", []);
  for (const key of SUMMARY) parent(f)[key] = null;
  expectPlan(f, "parent-summary-candidate");
  parent(f, "cloudTables").counted_card = "0";
  expectRefusal(f);
});
test("table ordering and child row ordering do not change exact identity", () => {
  const f = fixture();
  f.cloudTables.reverse();
  rows(f, "shift_notifications", "localTables").push({ ...rows(f, "shift_notifications")[0], id: OTHER });
  rows(f, "shift_notifications", "cloudTables").unshift({ ...rows(f, "shift_notifications", "cloudTables")[0], id: OTHER });
  expectPlan(f, "exact", []);
});
test("UUID casing and equivalent UTC offsets retain exact 100ns timestamps", () => {
  const f = fixture();
  for (const entry of f.cloudTables) for (const saved of entry.rows) {
    for (const key of ["id", "store_id", "shift_id", "count_id", "reconciliation_id", "terminal_id"]) if (saved[key]) saved[key] = saved[key].toUpperCase();
    for (const key of ["created_at", "updated_at", "closed_at"]) if (saved[key] === AT) saved[key] = "2026-11-02T20:00:00.1234567+08:00";
  }
  expectPlan(f, "exact", []);
});
test("lossless cloud numeric tokens and exact scientific decimal strings compare without Number rounding", () => {
  const f = fixture();
  for (const name of ["shifts", "shift_cash_counts", "shift_reconciliations"]) {
    const local = rows(f, name)[0], cloud = rows(f, name, "cloudTables")[0];
    local.counted_cash = "9007199254740993.123456789012";
    cloud.counted_cash = parseExactJson("9007199254740993.123456789012");
    if (name === "shifts") { local.final_counted_cash = local.counted_cash; cloud.final_counted_cash = cloud.counted_cash; }
  }
  parent(f).expected_card = "2e1"; parent(f, "cloudTables").expected_card = "20.000000000000";
  expectPlan(f, "exact", []);
});
test("JSON object ordering and exact JSON numerics are significant without binary coercion", () => {
  const f = fixture();
  rows(f, "shift_close_events")[0].detail = '{"b":9007199254740993,"a":[0.000000000001,null,true]}';
  rows(f, "shift_close_events", "cloudTables")[0].detail = parseExactJson('{"a":[1e-12,null,true],"b":9007199254740993}');
  expectPlan(f, "exact", []);
});
test("local SQL column aliases map to their registered cloud facts", () => {
  const f = fixture();
  const column = f.registry.tables.find(table => table.cloudTable === "shifts").columns.find(item => item.cloudColumn === "note");
  column.sqlServerColumn = "local_note";
  parent(f).local_note = parent(f).note; delete parent(f).note;
  expectPlan(f, "exact", []);
});

for (const fields of [[...SUMMARY], ["expected_cash"], ["variance_cash", "variance_total"]])
  test(`identical children and only missing saved summaries yield a candidate: ${fields.join(",")}`, () => {
    const f = fixture(); for (const field of fields) parent(f)[field] = null;
    parent(f, "cloudTables").row_version = "4"; parent(f, "cloudTables").updated_at = "2026-11-03T12:00:00.0000000Z";
    const result = expectPlan(f, "parent-summary-candidate", [...fields, "row_version", "updated_at"]);
    assert.equal(result.reasonCode, "SAVED_RECONCILIATION_PARENT_PROJECTION");
  });
test("summary projection does not admit unrelated parent facts", () => {
  const f = fixture(); parent(f).expected_cash = null; parent(f, "cloudTables").note = "administrator edit";
  expectPlan(f, "competing-closings-needs-review");
});
test("summary projection cannot replace a differing non-null financial value", () => {
  const f = fixture(); parent(f).expected_cash = "94";
  expectRefusal(f);
});
test("summary projection requires exact child IDs and history", () => {
  const f = fixture(); parent(f).expected_cash = null;
  rows(f, "shift_close_events", "cloudTables")[0].id = OTHER;
  expectPlan(f, "competing-closings-needs-review");
});
test("unrounded numeric differences in saved children do not become a summary candidate", () => {
  const f = fixture(); parent(f).expected_cash = null;
  rows(f, "shift_close_events")[0].detail = '{"amount":9007199254740992}';
  rows(f, "shift_close_events", "cloudTables")[0].detail = parseExactJson('{"amount":9007199254740993}');
  expectPlan(f, "competing-closings-needs-review");
});
test("a malformed remote parent is not accepted merely because its summaries are non-null", () => {
  const f = fixture(); parent(f).expected_cash = null; parent(f, "cloudTables").expected_cash = "9007199254740993.000000000001";
  expectRefusal(f);
});

for (const field of ["row_version", "updated_at"]) test(`parent-only ${field} drift is a metadata candidate, not a clock-based winner`, () => {
  const f = fixture(); parent(f, "cloudTables")[field] = field === "row_version" ? "1" : EARLIER;
  expectPlan(f, "metadata-only-candidate", [field]);
});
test("metadata candidate never considers child metadata equal by ignoring it", () => {
  const f = fixture(); rows(f, "shift_cash_counts", "cloudTables")[0].row_version = "8";
  expectPlan(f, "competing-closings-needs-review", []);
});
test("OPEN created_at 100ns-to-microsecond conversion is review-only", () => {
  const f = fixture(); open(f, "localTables"); open(f, "cloudTables");
  parent(f, "cloudTables").created_at = "2026-11-02T01:00:00.123457Z";
  const result = expectPlan(f, "metadata-only-candidate", ["created_at"]);
  assert.equal(result.reasonCode, "CREATED_AT_PRECISION_REVIEW");
});
test("OPEN created_at differences beyond the narrow precision candidate stay unverified", () => {
  const f = fixture(); open(f, "localTables"); open(f, "cloudTables");
  parent(f, "cloudTables").created_at = "2026-11-02T01:00:00.123458Z";
  expectPlan(f, "unverified-difference-needs-review", ["created_at"]);
});
test("protected opening or closing times are never reduced to millisecond equality", () => {
  for (const key of ["opened_at", "closed_at"]) {
    const f = fixture(); parent(f, "cloudTables")[key] = key === "opened_at" ? "2026-11-02T01:00:00.1234568Z" : "2026-11-02T12:00:00.1234568Z";
    expectPlan(f, "competing-closings-needs-review", [key]);
  }
});
test("parent note null and empty text are not conflated as metadata", () => {
  const f = fixture(); parent(f, "cloudTables").note = "";
  expectPlan(f, "competing-closings-needs-review", ["note"]);
});

test("legacy local CLOSED and clean cloud OPEN always requires review", () => {
  const f = fixture(); open(f, "cloudTables"); parent(f, "cloudTables").row_version = "1";
  const result = expectPlan(f, "legacy-local-closing-needs-review");
  assert.equal(result.needsReview, true); assert.equal(result.autoApply, false);
});
test("partly closing cloud work is not classified as a clean absent closing", () => {
  const f = fixture(); open(f, "cloudTables"); parent(f, "cloudTables").state = "CASH_COUNT_SUBMITTED";
  expectPlan(f, "unverified-difference-needs-review");
});
test("an unclosed cloud with saved child history is not an empty recovery destination", () => {
  const f = fixture(); open(f, "cloudTables");
  rows(f, "shift_close_events", "cloudTables").push(structuredClone(rows(f, "shift_close_events")[0]));
  rows(f, "shift_close_events", "cloudTables")[0].detail = { source: "closing already started" };
  expectPlan(f, "unverified-difference-needs-review");
});
test("competing ORIGINAL chains are never unioned or selected by higher revision", () => {
  const f = fixture(); rows(f, "shift_cash_counts", "cloudTables")[0].id = OTHER;
  rows(f, "shift_reconciliations", "cloudTables")[0].count_id = OTHER;
  parent(f).row_version = "9999";
  const result = expectPlan(f, "competing-closings-needs-review"); assert.equal(result.autoApply, false);
  assert.equal(rows(f, "shift_cash_counts").length, 1); assert.equal(rows(f, "shift_cash_counts", "cloudTables").length, 1);
});
test("local OPEN versus cloud closing remains review-only with expired local history", () => {
  const f = fixture(); open(f, "localTables"); expectPlan(f, "unverified-difference-needs-review");
});

for (const side of ["localTables", "cloudTables"]) {
  test(`${side}: cross-branch rows fail closed`, () => { const f = fixture(); rows(f, "shift_cash_counts", side)[0].store_id = OTHER; expectRefusal(f, "SYNC_BRANCH_FORBIDDEN"); });
  test(`${side}: wrong shift child fails closed`, () => { const f = fixture(); rows(f, "shift_close_events", side)[0].shift_id = OTHER; expectRefusal(f, "SYNC_BRANCH_FORBIDDEN"); });
  test(`${side}: duplicate ORIGINAL cash counts fail closed`, () => {
    const f = fixture(); rows(f, "shift_cash_counts", side).push({ ...rows(f, "shift_cash_counts", side)[0], id: OTHER }); expectRefusal(f);
  });
  test(`${side}: orphan reconciliation fails closed`, () => { const f = fixture(); rows(f, "shift_reconciliations", side)[0].count_id = OTHER; expectRefusal(f); });
  test(`${side}: orphan variance reference fails closed`, () => { const f = fixture(); rows(f, "shift_variance_alerts", side)[0].reconciliation_id = OTHER; expectRefusal(f); });
  test(`${side}: count/reconciliation tender discrepancy fails closed`, () => { const f = fixture(); rows(f, "shift_cash_counts", side)[0].counted_card = "20.000000000001"; expectRefusal(f); });
  test(`${side}: rounded JS numbers are never equality evidence`, () => { const f = fixture(); parent(f, side).expected_card = 20; expectRefusal(f); });
  test(`${side}: Date objects cannot hide lost submillisecond evidence`, () => { const f = fixture(); parent(f, side).opened_at = new Date(EARLIER); expectRefusal(f); });
  test(`${side}: missing registered nullable fact differs from explicit null`, () => { const f = fixture(); delete parent(f, side).note; expectRefusal(f); });
  test(`${side}: unregistered extra fields cannot be silently ignored`, () => { const f = fixture(); parent(f, side).future_financial_fact = "unrecognized"; expectRefusal(f); });
  test(`${side}: duplicate row IDs fail closed`, () => { const f = fixture(); rows(f, "shift_close_events", side).push(structuredClone(rows(f, "shift_close_events", side)[0])); expectRefusal(f); });
}
test("incomplete tables, duplicate tables and missing parent cannot be called exact", () => {
  for (const change of [f => f.localTables.pop(), f => { f.cloudTables[5] = f.cloudTables[4]; }, f => { rows(f, "shifts").length = 0; }]) {
    const f = fixture(); change(f); expectRefusal(f);
  }
});
test("invalid and inconsistent closed status fails closed", () => {
  const f = fixture(); parent(f).state = "ACTIVE"; expectRefusal(f);
});
test("NULL counted financial values cannot prove a complete closing", () => {
  const f = fixture(); rows(f, "shift_cash_counts")[0].counted_cash = null; rows(f, "shift_reconciliations")[0].counted_cash = null; parent(f).counted_cash = null; parent(f).final_counted_cash = null;
  expectRefusal(f);
});
test("registry missing protected fields is unsupported instead of silently ignoring them", () => {
  const f = fixture(); f.registry.tables[0].columns = f.registry.tables[0].columns.filter(column => column.cloudColumn !== "closed_at"); expectRefusal(f);
});
test("oversized histories and excessive JSON nesting fail closed", () => {
  const f = fixture(); rows(f, "shift_close_events")[0].detail = JSON.stringify({ data: "a".repeat(6 * 1024 * 1024) }); expectRefusal(f);
  const nested = fixture(); rows(nested, "shift_close_events")[0].detail = "[".repeat(70) + "null" + "]".repeat(70); expectRefusal(nested);
});
test("numeric JSON precision and NULL/string types remain distinct", () => {
  const f = fixture(); rows(f, "shift_close_events")[0].detail = '{"v":9007199254740993}'; rows(f, "shift_close_events", "cloudTables")[0].detail = { v: 9007199254740992 };
  expectRefusal(f);
  const other = fixture(); rows(other, "shift_close_events")[0].detail = '{"v":null}'; rows(other, "shift_close_events", "cloudTables")[0].detail = { v: "null" };
  expectPlan(other, "competing-closings-needs-review");
});
test("pure classification performs no SQL, author signing, receipt creation or checkpoint action", () => {
  const f = fixture(); let calls = 0;
  f.author = { sign() { calls++; throw Error("must not run"); } };
  f.cloud = { pushAggregate() { calls++; }, shiftGraph() { calls++; } };
  f.checkpoints = { save() { calls++; } };
  expectPlan(f, "exact", []); assert.equal(calls, 0);
});

for (const days of [90, 365]) {
  test(`${days}-day offline history expiry cannot expire retained closing evidence or authorize its upload`, () => {
    const f = fixture(); open(f, "cloudTables");
    const evidence = { pendingIntent: { action: "close", savedAt: AT }, historyExpired: true, offlineDays: days,
      authorRevoked: true, cloudAcknowledgement: null, downloadCursor: "committed-page-2" };
    f.recoveryContext = evidence;
    const before = structuredClone(evidence);
    for (let retry = 0; retry < 3; retry++) {
      expectPlan(f, "legacy-local-closing-needs-review");
      assert.deepEqual(evidence, before);
    }
    assert.equal(rows(f, "shift_cash_counts")[0].id, COUNT);
    assert.equal(rows(f, "shift_reconciliations")[0].count_id, COUNT);
  });
}

test("lost or duplicate acknowledgements and partial-download context cannot replace graph evidence", () => {
  const f = fixture();
  for (const acknowledgement of [null, "accepted", "accepted"]) {
    f.recoveryContext = { acknowledgement, downloadComplete: false, resumeCursor: "page-2", authorRevoked: true };
    expectPlan(f, "exact", []);
  }
  rows(f, "shift_cash_counts", "cloudTables")[0].id = OTHER;
  rows(f, "shift_reconciliations", "cloudTables")[0].count_id = OTHER;
  expectPlan(f, "competing-closings-needs-review");
});

test("sparse or accessor-backed JSON arrays fail closed without evaluating getters", () => {
  for (const accessor of [false, true]) {
    const f = fixture(); let calls = 0; const array = new Array(1);
    if (accessor) Object.defineProperty(array, "0", { enumerable: true, get() { calls++; return "unsafe"; } });
    rows(f, "shift_close_events", "cloudTables")[0].detail = array;
    assert.throws(() => classifyRetainedShiftGraph(f), error => error.code === "ESYNC_GRAPH");
    assert.equal(calls, 0);
  }
});
