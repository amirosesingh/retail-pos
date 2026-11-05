import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { legacyRecoveryMessage } = require("../../../electron/security/legacy-shift-recovery-protocol.cjs");
const { rememberLegacyRecoveryReceipt, assertLegacyRecoveryReceipt } = require("../../../electron/sync/legacy-shift-recovery-receipt.cjs");
const names = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const terminal = id(1), branch = id(2), shift = id(3), author = id(4), key = id(5), recovery = id(6), count = id(7), recon = id(8), event = id(9);
const stamp = "2026-01-01T08:00:00.123456+00:00";
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
let db: PGlite;
const registry = loadRegistry();
const row = (name: string, data: Record<string, unknown>) => Object.assign(Object.fromEntries(registry.tables.find((t: any) => t.cloudTable === name).columns.map((c: any) => [c.cloudColumn, null])), data);
const core = readFileSync(new URL("../../../supabase/migrations/20261102082439_shift_closing_causal_intents.sql", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
function currentFunction(name: string) {
  const start = canonical.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), tail = canonical.slice(start);
  const tag = tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1]; if (start < 0 || !tag) throw Error("Missing real trigger function");
  const begin = tail.indexOf(tag), end = tail.indexOf(tag + ";", begin + tag.length); return tail.slice(0, end + tag.length + 1);
}
function helper(name: string) {
  const start = core.indexOf("CREATE OR REPLACE FUNCTION " + name + "("); if (start < 0) throw Error("Missing real helper");
  const body = core.indexOf("AS $fn$", start), end = core.indexOf("$fn$;", body + 8); if (body < 0 || end < 0) throw Error("Missing helper delimiter");
  return core.slice(start, end + 5);
}
beforeAll(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA pos_sync_private;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
   CREATE TABLE public.app_users(id uuid PRIMARY KEY,user_id text,is_active boolean,role text,role_slug text,store_id text);
   CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,platform text,status text,revoked_at timestamptz,is_claimed boolean,claimed_at timestamptz);
   CREATE TABLE pos_sync_private.shift_author_keys(key_id uuid PRIMARY KEY,author_id uuid,terminal_id text,project_origin text,subject text,revoked_at timestamptz);
   CREATE TABLE pos_sync_private.shift_intent_receipts(intent_id uuid,shift_id uuid);CREATE TABLE pos_sync_private.shift_author_receipts(intent_id uuid,shift_id uuid);
   CREATE SCHEMA fin62_history_preparation;CREATE TABLE fin62_history_preparation.protected_shifts(shift_id uuid,branch_id text);
   CREATE SCHEMA fin62_rollout_preparation;CREATE TABLE fin62_rollout_preparation.approvals(id uuid);
   CREATE FUNCTION public.pos_sync_validate_scope(o text,b text,t text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF o<>'fixture-org' OR b<>'${branch}' OR t<>'${terminal}' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;END$$;
   CREATE FUNCTION public.pos_sync_financial_capability(o text,b text,t text,s uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object('mode',COALESCE(NULLIF(current_setting('fixture.financial_mode',true),''),'disabled'),'shiftMode','legacy')$$;
   CREATE FUNCTION pos_sync_private.receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'RECEIPT_IMMUTABLE';END$$;`);
  for (const name of names) {
    const table = registry.tables.find((t: any) => t.cloudTable === name);
    await db.exec(`CREATE TABLE public.${name}(${table.columns.map((c: any) => `${c.cloudColumn} ${c.cloudType}${c.cloudColumn === "id" ? " PRIMARY KEY" : ""}`).join(",")});`);
  }
  for (const name of ["canonical_facts", "shift_graph", "graph_token", "download_projection", "validate_target", "validate_graph", "request_coverage"])
    await db.exec(helper("pos_sync_private." + name));
  await db.exec("CREATE TABLE public.held_orders(store_id text,shift_id text,status text);");
  for (const name of ["skip_stale_update", "bump_row_version", "shifts_guard_client_writes", "update_updated_at_column", "shifts_sync_status", "guard_shift_unfinished_tickets", "shift_records_immutable"])
    await db.exec(currentFunction(name));
  await db.exec(`CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
    CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version();
    CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
    CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status();
    CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets();
    CREATE UNIQUE INDEX fixture_original ON shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
    ${["shift_cash_counts", "shift_reconciliations", "shift_close_events"].map(name => `CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ${name} FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();`).join("\n")}`);
  const financialSource = readFileSync(new URL("../../../scripts/preparation/shift-financial-operation-history.sql", import.meta.url), "utf8");
  const financialStart = financialSource.indexOf("CREATE FUNCTION fin62_history_preparation.guard_shift_graph()"), financialEnd = financialSource.indexOf("END $$;", financialStart);
  expect(financialStart >= 0 && financialEnd > financialStart).toBe(true);
  await db.exec("CREATE TABLE fin62_history_preparation.graph_context(pid integer,xid xid8,branch_id text,shift_id uuid);");
  await db.exec(financialSource.slice(financialStart, financialEnd + "END $$;".length));
  await db.exec("CREATE TRIGGER prototype_fin62_shift_write_guard BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.guard_shift_graph();");
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261105063613_admin_attested_legacy_shift_recovery.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await db.exec("RESET ROLE;SET pos.shift_fn='';SET request.jwt.claim.role='service_role';SET fixture.financial_mode='disabled';TRUNCATE public.held_orders,pos_sync_private.legacy_shift_recovery_receipts,public.app_users,public.terminal_tokens,pos_sync_private.shift_author_keys,pos_sync_private.shift_intent_receipts,pos_sync_private.shift_author_receipts,fin62_history_preparation.protected_shifts;");
  for (const name of names) await db.exec(`TRUNCATE public.${name};`);
  await db.exec(`INSERT INTO public.app_users VALUES('${author}','reviewer-admin',true,'admin',NULL,'${branch}');
   INSERT INTO public.terminal_tokens VALUES('${terminal}','${branch}','pc','used',NULL,true,now());
   INSERT INTO pos_sync_private.shift_author_keys VALUES('${key}','${author}','${terminal}','https://project.fixture','reviewer-admin',NULL);`);
  const parent = row("shifts", { id: shift, store_id: branch, terminal_id: terminal, status: "OPEN", state: "ACTIVE", opened_at: stamp, created_at: stamp, updated_at: stamp, row_version: 1, overdue: false, opening_float: 100 });
  await db.query("INSERT INTO public.shifts SELECT * FROM jsonb_populate_record(NULL::public.shifts,$1::jsonb)", [JSON.stringify(parent)]);
});
afterAll(async () => { await db?.close(); });
async function graph() { return (await db.query<{ graph: any }>("SELECT pos_sync_private.shift_graph($1::uuid) graph", [shift])).rows[0].graph; }
async function fixture() {
  const witness = await graph(), local = structuredClone(witness), parent = local[0].rows[0];
  const money = { counted_cash: 100, counted_card: null, counted_digital: null, expected_cash: 100, expected_card: 0, expected_digital: 0,
    variance_cash: 0, variance_card: null, variance_digital: null, variance_total: 0, variance_status: "NO_VARIANCE" };
  Object.assign(parent, money, { status: "CLOSED", state: "CLOSED", closed_at: "2026-01-01T17:00:00.1234567Z", final_counted_cash: 100, closing_float: 100,
    closed_by_name: "legacy-cashier", closed_by_staff_id: "legacy-cashier", row_version: 3 });
  local[1].rows.push(row("shift_cash_counts", { id: count, store_id: branch, shift_id: shift, terminal_id: terminal, kind: "ORIGINAL", counted_cash: 100,
    counted_card: null, counted_digital: null, counted_by_staff_id: "legacy-cashier", counted_by_name: "legacy-cashier", created_at: stamp }));
  local[2].rows.push(row("shift_reconciliations", { id: recon, store_id: branch, shift_id: shift, count_id: count, ...money, created_at: stamp }));
  local[3].rows.push(row("shift_close_events", { id: event, store_id: branch, shift_id: shift, terminal_id: terminal, event: "reconciled", actor_name: "legacy-cashier", actor_staff_id: "legacy-cashier", created_at: stamp }));
  return { local, witness };
}
async function request(change?: (value: any) => void) {
  const f = await fixture(); change?.(f);
  const localGraphText = JSON.stringify(f.local), cloudGraphText = JSON.stringify(f.witness);
  const payload = { version: 1, recoveryId: recovery, branchId: branch, terminalId: terminal, shiftId: shift, evidenceHash: hash(localGraphText), cloudWitnessHash: hash(cloudGraphText),
    reason: "Administrator reviewed original offline closing", localGraphText, cloudGraphText, financialVerification: "UNVERIFIED_HISTORICAL" };
  const raw = JSON.stringify(payload);
  const unsigned = { version: 1, algorithm: "Ed25519", action: "LEGACY_CLOSING_RECOVERY_V1", keyId: key, authorId: author, subject: "reviewer-admin", projectOrigin: "https://project.fixture",
    terminalId: terminal, branchId: branch, shiftId: shift, recoveryId: recovery, payloadHash: hash(raw) };
  const proof = { ...unsigned, signature: sign(null, Buffer.from(legacyRecoveryMessage(unsigned)), generateKeyPairSync("ed25519").privateKey).toString("base64url") };
  return { raw, proof, authority: { allowed: true, authorId: author, subject: "reviewer-admin" } };
}
async function apply(r: Awaited<ReturnType<typeof request>>) {
  return (await db.query<{ result: any }>("SELECT public.pos_sync_recover_legacy_closing($1,$2,$3,$4,$5::jsonb,$6::jsonb) result", ["fixture-org", branch, terminal, r.raw, JSON.stringify(r.proof), JSON.stringify(r.authority)])).rows[0].result;
}
describe("isolated real PostgreSQL legacy recovery RPC", () => {
  it("brands the actual typed SQL receipt only after binding all accepted facts to the raw local claim", async () => {
    const r = await request(), result = await apply(r), payload = JSON.parse(r.raw);
    const event = { recoveryId: recovery, branchId: branch, terminalId: terminal, shiftId: shift, payloadJson: r.raw, payloadHash: hash(r.raw),
      evidenceHash: payload.evidenceHash, cloudWitnessHash: payload.cloudWitnessHash, proof: r.proof };
    const raw = JSON.stringify(result);
    const witness = rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent() {} });
    expect(assertLegacyRecoveryReceipt(witness, event).receiptJson).toBe(raw);
    // Accepted PostgreSQL time is microsecond precision; the original 100ns
    // claim remains immutable, rather than being falsely called byte-identical.
    expect(result.accepted_graph_text).toContain(".123457");
    expect(r.raw).toContain(".1234567Z");
  });
  it("recovers claimed cashier facts, retaining exact raw7digit claim and separate actualadmin provenance", async () => {
    const r = await request(), result = await apply(r); expect(result.provenance).toBe("ADMIN_REVIEWED_LEGACY"); expect(result.financial_verification).toBe("UNVERIFIED_HISTORICAL");
    expect((await graph())[0].rows[0].closed_by_staff_id).toBe("legacy-cashier");
    const saved = (await db.query<any>("SELECT * FROM pos_sync_private.legacy_shift_recovery_receipts")).rows[0];
    expect(saved.reviewer_subject).toBe("reviewer-admin"); expect(saved.payload_json).toContain(".1234567Z"); expect(result.accepted_token).toBe(result.current_token);
    expect((await db.query("SELECT * FROM pos_sync_private.shift_intent_receipts")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM pos_sync_private.shift_author_receipts")).rows).toHaveLength(0);
  });
  it("lostack duplicate retry afterrevocation reads accepted history without applying again", async () => {
    const r = await request(), first = await apply(r); await db.exec(`UPDATE app_users SET is_active=false;UPDATE pos_sync_private.shift_author_keys SET revoked_at=now();`);
    r.authority.allowed = false; expect((await apply(r)).accepted_token).toBe(first.accepted_token);
    expect((await db.query("SELECT * FROM pos_sync_private.legacy_shift_recovery_receipts")).rows).toHaveLength(1);
  });
  it("later accepted web correction stays authoritative duringoldreplay", async () => {
    const r = await request(), first = await apply(r);
    const saved = await graph(), newCount = { ...saved[1].rows[0], id: id(21), kind: "RECOUNT", counted_cash: 101, counted_by_staff_id: "reviewer-admin", counted_by_name: "reviewer-admin" };
    const newRecon = { ...saved[2].rows[0], id: id(22), count_id: id(21), counted_cash: 101, variance_cash: 1, variance_total: 1, variance_status: "OVER" };
    await db.query("INSERT INTO public.shift_cash_counts SELECT * FROM jsonb_populate_record(NULL::public.shift_cash_counts,$1::jsonb)", [JSON.stringify(newCount)]);
    await db.query("INSERT INTO public.shift_reconciliations SELECT * FROM jsonb_populate_record(NULL::public.shift_reconciliations,$1::jsonb)", [JSON.stringify(newRecon)]);
    await db.exec("SET pos.shift_fn='on';UPDATE public.shifts SET counted_cash=101,final_counted_cash=101,variance_cash=1,variance_total=1,variance_status='OVER';SET pos.shift_fn='';");
    const replay = await apply(r); expect(replay.superseded).toBe(true); expect(replay.accepted_token).toBe(first.accepted_token); expect(replay.graph.tables[0].rows[0].counted_cash).toBe(101);
    expect((await graph())[1].rows.find((c: any) => c.id === count).counted_cash).toBe(100);
  });
  it.each(["staff", "manager"])("rejects actual %s even with externally allowed authority", async role => {
    const r = await request(); await db.query("UPDATE public.app_users SET role=$1", [role]); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_ADMIN_REQUIRED"); expect((await graph())[0].rows[0].status).toBe("OPEN");
  });
  it("rejects revoked signer NEW write and never clears retained work", async () => { const r = await request(); await db.exec("UPDATE pos_sync_private.shift_author_keys SET revoked_at=now()"); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_ADMIN_REQUIRED"); });
  it("rejects protected FIN62 and approvedcohort admission", async () => {
    const r = await request(); await db.exec(`INSERT INTO fin62_history_preparation.protected_shifts VALUES('${shift}','${branch}')`); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_FINANCIAL_REQUIRED");
    await db.exec("TRUNCATE fin62_history_preparation.protected_shifts;SET fixture.financial_mode='required'"); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_FINANCIAL_REQUIRED");
  });
  it("fullOPENwitnessCAS rejects any cloudchange beforeDML", async () => { const r = await request(); await db.exec("UPDATE public.shifts SET note='new administrator fact'"); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_CLOUD_CHANGED"); });
  it("never overwrites a closing that appeared after review", async () => { const r = await request(); await db.exec("SET pos.shift_fn='on';UPDATE public.shifts SET state='CLOSED',status='CLOSED',closed_at=now();SET pos.shift_fn=''"); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_CLOUD_CHANGED"); });
  it("rejects childIDcollision and rolls back every other child/parent", async () => {
    const r = await request(); await db.exec(`INSERT INTO public.shift_cash_counts(id,shift_id,store_id) VALUES('${count}','${id(99)}','foreign')`);
    await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_CHILD_EXISTS"); expect((await graph())[0].rows[0].status).toBe("OPEN"); expect((await graph())[2].rows).toHaveLength(0);
  });
  it("rejects branch/terminalforgery and inventedfields without partialwrite", async () => {
    const r = await request(f => { f.local[1].rows[0].store_id = "foreign"; }); await expect(apply(r)).rejects.toThrow("SYNC_BRANCH_FORBIDDEN");
    const other = await request(f => { f.local[0].rows[0].invented_trust = true; }); await expect(apply(other)).rejects.toThrow("LEGACY_RECOVERY_GRAPH_INVALID");
  });
  it("saved tender arithmetic discrepancy is not approved merely by admin signature", async () => { const r = await request(f => { f.local[2].rows[0].variance_total = 999; }); await expect(apply(r)).rejects.toThrow(); });
  it("differentrawpayload underacceptedkey cannot replay", async () => { const r = await request(); await apply(r); r.raw += " "; r.proof.payloadHash = hash(r.raw); await expect(apply(r)).rejects.toThrow("LEGACY_RECOVERY_REPLAY_MISMATCH"); });
  it("receipt appendonly and anonymousRPC denied", async () => {
    await apply(await request()); await expect(db.exec("DELETE FROM pos_sync_private.legacy_shift_recovery_receipts")).rejects.toThrow("RECEIPT_IMMUTABLE");
    await db.exec("SET request.jwt.claim.role='anon'"); await expect(apply(await request())).rejects.toThrow("SYNC_FORBIDDEN");
  });
  it("canonical source matches the prepared migration and grants no anonymous access", async () => {
    const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const migration = readFileSync(new URL("../../../supabase/migrations/20261105063613_admin_attested_legacy_shift_recovery.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n").trim();
    expect(schema.split("-- LEGACY_SHIFT_RECOVERY_BEGIN\n")[1].split("\n-- LEGACY_SHIFT_RECOVERY_END")[0]).toBe(migration);
    const privileges = (await db.query<{ allowed: boolean }>("SELECT has_function_privilege('anon','public.pos_sync_recover_legacy_closing(text,text,text,text,jsonb,jsonb)','EXECUTE') allowed")).rows[0];
    expect(privileges.allowed).toBe(false);
  });
});
