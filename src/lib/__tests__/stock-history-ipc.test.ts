import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url), { createStockHistoryReader } = require("../../../electron/stock-history-ipc.cjs");
const actorId = "00000000-0000-4000-8000-000000000001", databaseGuid = "00000000-0000-4000-8000-000000000002";
const request = { branchId: "a", cutoff: "2026-11-06T00:00:00.0000000Z", timeZone: "Asia/Brunei" };
function fixture() {
  let epoch = 1, active = true, touched = 0, reads = 0;
  const person: any = { id: actorId, user_id: "cashier", role: "staff", role_slug: "cashier", store_id: "a", is_active: true, permissions: { can_view_inventory: true } };
  const terminal: any = { tokenId: "terminal-a", deviceUse: "operations", locationId: "a" }, events: string[] = [];
  let afterRead: (() => void) | null = null;
  const pool: any = { request: () => ({ input() { return this; }, async query() { reads++; const value = structuredClone(person); afterRead?.(); return { recordset: [value] }; } }) };
  class Request { input() { return this; } async query(sql: string) { return { recordset: sql.includes("database_guid") ? [{ database_guid: databaseGuid, schema_generation: "24:absent" }] : [] }; } }
  class Transaction { async begin() { events.push("begin"); } async commit() { events.push("commit"); } async rollback() { events.push("rollback"); } }
  const manager = { pool, sql: () => ({ Request, Transaction }) }, session = { hasPosAuthority: () => active, epoch: () => epoch,
    identity: () => ({ authorId: actorId, subject: "cashier", canonicalSubject: "cashier", source: "pos" }), touch: () => { touched++; } };
  const read = createStockHistoryReader({ manager, session, terminal: () => terminal, branch: () => "a", isPosSender: (event: any) => event === "pos", context: () => ["https://fixture.invalid"] });
  return { read, person, terminal, manager, events, revoke: () => { active = false; epoch++; }, after: (fn: () => void) => { afterRead = fn; }, counts: () => ({ reads,touched }) };
}
describe("Main-owned stock history read admission", () => {
  it("reports an absent optional schema truthfully without SQL or registration writes", async () => {
    const f = fixture(); expect(await f.read("pos",request)).toMatchObject({ ok: true, page: { status: "unavailable", reasons: ["SCHEMA_NOT_INSTALLED"], rows: [] } });
    expect(f.counts()).toEqual({ reads: 2,touched: 1 }); expect(f.events).toEqual(["begin","commit"]);
  });
  it("rejects other renderers before account reads or idle extension", async () => {
    const f = fixture(); expect(await f.read("customer",request)).toMatchObject({ ok: false,code: "PERMISSION_DENIED" }); expect(f.counts()).toEqual({ reads: 0,touched: 0 });
  });
  it.each(["branch", "inactive", "permission", "page", "export", "identity", "management", "extra field", "shift"])("denies current %s", async change => {
    const f = fixture(), input: any = { ...request };
    if (change === "branch") { f.person.role = "admin"; f.person.role_slug = "admin"; input.branchId = "b"; }
    if (change === "inactive") f.person.is_active = false;
    if (change === "permission") f.person.permissions = {};
    if (change === "page") f.person.permissions["page:inventory"] = false;
    if (change === "export") input.export = true;
    if (change === "identity") f.person.user_id = "another-cashier";
    if (change === "management") f.terminal.deviceUse = "management";
    if (change === "extra field") input.sql = "SELECT hidden";
    if (change === "shift") input.closedShiftId = actorId;
    expect(await f.read("pos",input)).toMatchObject({ ok: false }); expect(f.counts().touched).toBe(0);
  });
  it("rechecks handover after an awaited account read", async () => {
    const f = fixture(); f.after(f.revoke); expect(await f.read("pos",request)).toMatchObject({ ok: false,code: "ESTOCK_HISTORY_CONTEXT_CHANGED" }); expect(f.counts().touched).toBe(0);
  });
  it("rechecks newly revoked SQL authority before returning even an unavailable result", async () => {
    const f = fixture(); f.after(() => { f.person.is_active = false; });
    expect(await f.read("pos",request)).toMatchObject({ ok: false,code: "PERMISSION_DENIED" }); expect(f.events).toEqual(["begin","rollback"]);
  });
});
