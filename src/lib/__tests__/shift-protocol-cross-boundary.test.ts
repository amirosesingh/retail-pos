import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// Opt-in Windows engine test. This runs real LocalDB and PGlite, but is NOT an
// installed Electron/IPC, physical device, live Supabase or OS-vault test.
// All HTTP goes through the real sync API in-process; only the transport,
// device/Auth identity, encrypted test vault and protected-feed selection/privacy
// projection are synthetic adapters. Feed bytes/headers follow the current
// bounded contract; actual feed SQL projection has its own acceptance tests.
// Main session/role logic, key signing, enrollment handler, registry SQL and
// signed-intent admission are production implementations on synthetic identities.
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "synthetic-service", supabaseConfig: () => ({ url: "https://cloud.invalid", key: "synthetic-public" }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { Route } from "@/routes/api/v1/pos/shift-author-enroll";
import { handleSyncRequest } from "../sync-endpoint.server";

const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const enabled = process.env.CODEX_SHIFT36_LOCALDB === "1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic CJS and SQL engine fixture boundary
type Row = Record<string, any>;
let local: Row | undefined, db: Row | undefined, vault: Row | undefined;
afterEach(async () => { session.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); try { await db?.close(); } finally { try { await local?.close(); } finally { vault?.close(); local=undefined;db=undefined;vault=undefined; } } }, 60000);

describe.skipIf(!enabled)("opt-in actual native storage → worker → CloudClient → API → isolated PostgreSQL", () => {
  async function exerciseClosingProtocol(openingAlreadyAcknowledged: boolean, cashierCountsOriginal = false) {
    const { createCloud, createLocal, mainCalls, graphNames, createAuthorKeys } = require("../../../scripts/lib/shift-protocol-integration-fixture.cjs");
    const branch = randomUUID(), terminal = randomUUID(), shift = randomUUID(), sale = randomUUID(), proof = "a".repeat(64);
    db = await createCloud(branch, terminal); local = await createLocal(branch);
    const { manager, registry, repository } = local!;
    const { AggregateRepository } = require("../../../electron/db/repositories/aggregates.cjs");
    const { ShiftSyncJournal } = require("../../../electron/db/shift-sync-journal.cjs");
    const { ChangeReader } = require("../../../electron/sync/change-reader.cjs");
    const { CheckpointRepository } = require("../../../electron/sync/checkpoints.cjs");
    const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
    const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
    const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
    const aggregates = new AggregateRepository(manager, repository), writer = new ShiftSyncJournal(repository, { authorRequired: true });
    const reader = new ChangeReader(manager, registry), checkpoints = new CheckpointRepository(manager);
    const cashierId = randomUUID(), adminId = randomUUID();
    const permissions = { can_process_sale: true, can_close_shift: true, can_shift_cash_count: true, can_shift_cash_recount: true };
    const cashierPermissions = { ...permissions, can_shift_cash_recount: false };
    for (const [id, subject, role, flags] of [[cashierId, "original-cashier", "staff", cashierPermissions], [adminId, "authorized-admin", "admin", permissions]])
      await db!.query("INSERT INTO app_users(id,user_id,auth_user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,$2,$1,$3,$3,$4::jsonb,true,$5)", [id, subject, role, JSON.stringify(flags), branch]);
    const login = (authorId: string, subject: string, level: string, flags: Row, scope = branch, source = "pos") => {
      session.grant(level, subject, flags, source, scope); session.bindVerifiedAuthor(authorId, subject);
    };
    login(cashierId, "original-cashier", "staff", cashierPermissions);
    expect(session.hasLevel("admin")).toBe(false);
    const terminalConfig = { tokenId: terminal, locationId: branch, deviceUse: "operations", deviceBindingProof: proof, deviceClaimProof: proof };
    vault = createAuthorKeys();
    const { ShiftAuthorAuthority } = require("../../../electron/shift-authority.cjs");
    const newAuthority = () => new ShiftAuthorAuthority({ keys: vault!.keys, session, connectionManager: manager, terminal: () => terminalConfig,
      project: () => "https://cloud.invalid", branch: () => branch, backendUrl: () => "https://pos.invalid", fetcher: (...args: Parameters<typeof fetch>) => fetch(...args) });
    let authority = newAuthority(), calls = mainCalls(repository, writer, branch, terminal, session, authority);
    const scalar = async (query: string, args: unknown[] = []) => Object.values((await db!.query(query, args)).rows[0])[0] as Row;
    const sqlRows = async (query: string) => (await manager.pool.request().query(query)).recordset;
    const outbound: Row[] = [], rpcCalls: Row[] = [], feed: Row[] = [];
    let loseOriginalReply = true;
    const rpc = async (name: string, args: Row) => {
      rpcCalls.push({ name, args: structuredClone(args) });
      const specs: Record<string, [string, string][]> = {
        pos_sync_push_aggregate: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_operations", "jsonb"]],
        pos_sync_push_author_shift_intent: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_operations", "jsonb"], ["p_shift_intent", "jsonb"], ["p_shift_author", "jsonb"], ["p_author_authority", "jsonb"]],
        pos_sync_push_started_shift_intent: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_operations", "jsonb"], ["p_shift_intent", "jsonb"], ["p_shift_author", "jsonb"], ["p_author_authority", "jsonb"], ["p_closing_start", "jsonb"], ["p_start_authority", "jsonb"]],
        pos_sync_push_batch: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_table", "text"], ["p_rows", "jsonb"], ["p_changes", "jsonb"]],
        pos_sync_shift_graph: [["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_shift_id", "uuid"]],
      };
      if (name === "pos_sync_pull") {
        expect(args.p_branch_id).toBe(branch); expect(args.p_terminal_id).toBe(terminal);
        return feed.filter(row => row.cursor > args.p_after_cursor).slice(0, args.p_limit);
      }
      if (name === "pos_shift_author_enroll") return scalar("SELECT public.pos_shift_author_enroll($1::jsonb,$2)", [JSON.stringify(args.p_enrollment), args.p_subject]);
      if (name === "pos_shift_author_key") return scalar("SELECT public.pos_shift_author_key($1,$2,$3::uuid,$4::uuid)", [args.p_project_origin, args.p_terminal_id, args.p_author_id, args.p_key_id]);
      const spec = specs[name]; expect(spec, `Unexpected synthetic RPC ${name}`).toBeDefined();
      // Verify the ACTUAL serialized PostgREST named-argument set, including
      // explicit NULL operations for v3. The adapter never silently fills it.
      expect(Object.keys(args).sort()).toEqual(spec.map(([key]) => key).sort());
      const values = spec.map(([key, type]) => type === "jsonb" && args[key] !== null ? JSON.stringify(args[key]) : args[key]);
      return scalar(`SELECT public.${name}(${spec.map(([key, type], index) => `${key}=>$${index + 1}::${type}`).join(",")}) AS result`, values);
    };
    vi.stubGlobal("fetch", vi.fn(async (value: string | URL | Request, options?: RequestInit) => {
      const url = value instanceof Request ? value.url : String(value);
      const bodyText = options?.body ?? (value instanceof Request ? await value.clone().text() : undefined);
      if (url === "https://pos.invalid/api/v1/pos/shift-author-enroll") {
        const handler = (Route as unknown as { options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
        return handler({ request: new Request(url, { ...options, body: bodyText }) });
      }
      if (url === "https://cloud.invalid/auth/v1/user") return Response.json({ id: session.identity()?.authorId });
      if (url.startsWith("https://cloud.invalid/rest/v1/app_users?")) {
        const parsed = new URL(url), field = ["id", "user_id", "auth_user_id"].find(key => parsed.searchParams.has(key));
        if (!field) throw new Error("Fixture requires an explicit account selector");
        return Response.json((await db!.query(`SELECT * FROM app_users WHERE ${field}::text=$1`, [parsed.searchParams.get(field)!.slice(3)])).rows);
      }
      if (url === "https://pos.invalid/api/v1/pos/sync") {
        const body = JSON.parse(String(bodyText)); outbound.push(structuredClone(body));
        const response = await handleSyncRequest(new Request(url, { ...options, body: bodyText }));
        if (body.sqlServerAggregate?.shiftIntent?.kind === "ORIGINAL" && response.ok && loseOriginalReply) {
          loseOriginalReply = false;
          // Commit is real; only delivery of its response is lost.
          throw Object.assign(new Error("Synthetic committed response lost"), { code: "ETIMEDOUT" });
        }
        return response;
      }
      if (url.startsWith("https://cloud.invalid/rest/v1/terminal_tokens?"))
        return Response.json([{ id: terminal, platform: "pc", status: "used", location_id: branch, is_claimed: true, claim_proof: proof }]);
      if (url.startsWith("https://cloud.invalid/rest/v1/stores?")) return Response.json([{ id: branch }]);
      const match = /^https:\/\/cloud\.invalid\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url);
      if (match) {
        const args = JSON.parse(String(bodyText));
        if (match[1] === "pos_sync_feed_page_v1") {
          rpcCalls.push({ name: match[1], args: structuredClone(args) });
          expect(Object.keys(args).sort()).toEqual(["p_organization_id", "p_branch_id", "p_terminal_id", "p_after_cursor", "p_keep_commerce", "p_max_bytes"].sort());
          expect(args.p_branch_id).toBe(branch); expect(args.p_terminal_id).toBe(terminal);
          expect(args.p_max_bytes).toBe(2 * 1024 * 1024); expect(typeof args.p_keep_commerce).toBe("boolean");
          // The feed selection/privacy projection is synthetic, not execution
          // of pos_sync_feed_page_v1 SQL. The guarded API consumes real bounded
          // response bytes/attestation and the real client applies this page.
          const remaining = feed.filter(row => row.cursor > args.p_after_cursor), selected = remaining.slice(0, 10);
          const body = JSON.stringify(selected), bytes = new TextEncoder().encode(body).byteLength;
          expect(bytes).toBeLessThanOrEqual(args.p_max_bytes);
          return new Response(body, { headers: { "content-type": "application/json", "X-POS-Feed-Projection": "1", "X-POS-Feed-Bytes": String(bytes),
            "X-POS-Feed-Rows": String(selected.length), "X-POS-Feed-Continue": remaining.length > selected.length ? "1" : "0" } });
        }
        try { return Response.json(await rpc(match[1], args)); }
        catch (error) { return Response.json({ message: (error as Error).message, code: (error as Row).code }, { status: 400 }); }
      }
      throw new Error(`External/unexpected network is blocked: ${url}`);
    }));
    const cloud = new CloudClient({ connectionManager: manager, configStore: { get: () => "https://pos.invalid" },
      terminalStore: { read: () => terminalConfig } });
    let worker = new PushWorker({ reader, cloud, checkpoints, registry, validateAuthor: (value: Row) => authority.validatePending(value), validateClosingStart: (value: Row) => authority.validatePendingClosingStart(value) });
    expect(await authority.enrollOnline({ accessToken: "synthetic-author-access" })).toEqual({ ok: true });

    const openedAt = "2026-11-02T01:00:00.000Z";
    const opening = await aggregates.commit("shift", { branchId: branch, terminalId: terminal, permissions: { can_open_shift: true }, operations: [{ kind: "upsert", table: "shifts", rows: [{
      id: shift, store_id: branch, terminal_id: terminal, terminal_name: "Synthetic till", opened_by_name: "original-cashier", opened_by_staff_id: "original-cashier", opened_by_role: "cashier",
      opened_at: openedAt, opening_float: 20, note: "", overdue: false, created_at: openedAt, updated_at: openedAt, status: "OPEN", state: "ACTIVE", row_version: 1,
    }] }] });
    const frozenOpen = await reader.frozenOpeningRows(opening.operationId, branch);
    if (openingAlreadyAcknowledged) {
      // This is the reported ordering: cloud has already acknowledged OPEN
      // before the cashier saves any closing facts on the offline PC.
      await worker.run({branchId:branch,includeActivity:false});
      expect(await scalar("SELECT status FROM public.shifts WHERE id=$1",[shift])).toBe("OPEN");
      expect(await scalar("SELECT closed_at FROM public.shifts WHERE id=$1",[shift])).toBeNull();
      const openingJournal=await sqlRows("SELECT acknowledged_at FROM dbo.sync_change_journal;");
      expect(openingJournal.length).toBeGreaterThan(0);
      expect(openingJournal.every((row:Row)=>row.acknowledged_at!==null)).toBe(true);
      expect(Number(await scalar("SELECT count(*) FROM public.shift_cash_counts"))).toBe(0);
    }

    await aggregates.commit("sale", { branchId: branch, terminalId: terminal, permissions: { can_process_sale: true }, operations: [{ kind: "insert", table: "sales", rows: [{
      id: sale, bill_number: "SYNTHETIC-OFFLINE-1", store_id: branch, shift_id: shift, cashier_name: "original-cashier", subtotal_amount: 80, total_amount: 80,
      discount_amount: 0, tax_amount: 0, payment_type: "cash", payments: [], points_earned: 0, points_redeemed: 0, is_exchange: false, is_refunded: false,
      paid_amount: 80, change_amount: 0, exchange_credit: 0, coupon_discount: 0, rounding_adjustment: 0, row_version: 1, created_at: openedAt,
    }] }] });
    const closingFacts = () => sqlRows("SELECT (SELECT COUNT(*) FROM dbo.shift_cash_counts) counts,(SELECT COUNT(*) FROM dbo.shift_reconciliations) reconciliations,(SELECT COUNT(*) FROM dbo.shift_close_events) events,(SELECT COUNT(*) FROM dbo.shift_notifications) notifications,(SELECT COUNT(*) FROM dbo.pos_sync_shift_intents) intents,(SELECT COUNT(*) FROM dbo.sync_change_journal) journal;");
    const beforeDenied = await closingFacts();
    login(cashierId, "original-cashier", "staff", { ...cashierPermissions, can_close_shift: false, can_shift_cash_count: false });
    await expect(calls.startLocalShiftClose({ shiftId: shift, reason: "Denied cashier" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(calls.commitLocalShiftCashCount({ shiftId: shift, cash: 100 })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    login(adminId, "authorized-admin", "admin", permissions, randomUUID());
    expect(session.hasLevel("admin")).toBe(true);
    await expect(calls.commitLocalShiftCashCount({ shiftId: shift, cash: 100 })).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    login(adminId, "authorized-admin", "admin", permissions, branch, "manual");
    await expect(calls.commitLocalShiftCashCount({ shiftId: shift, cash: 100 })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    login(cashierId, "original-cashier", "staff", cashierPermissions);
    const staleAuthor = authority.capture("START_CLOSE"); session.clear();
    await expect(authority.prepare(staleAuthor)).rejects.toMatchObject({ code: "ESYNC_SHIFT_AUTHOR_CHANGED" });
    expect(await closingFacts()).toEqual(beforeDenied);
    login(cashierId, "original-cashier", "staff", cashierPermissions);
    await calls.startLocalShiftClose({ shiftId: shift, reason: "End of day", terminalId: terminal });
    const savedStarts = await sqlRows("SELECT * FROM dbo.pos_sync_shift_closing_starts;");
    expect(savedStarts).toHaveLength(1);
    const startProof = JSON.parse(savedStarts[0].proof_json);
    expect(startProof).toMatchObject({ authorId: cashierId, subject: "original-cashier" });
    expect(authority.validatePendingClosingStart(startProof)).toEqual(startProof);
    // Close/reopen the owned SQL connection and instantiate a new encrypted-key
    // store and authority. No OS process/device restart is claimed.
    await local!.restart(); vault!.keys = vault!.reopen();
    const originalAuthorId = cashierCountsOriginal ? cashierId : adminId;
    const originalSubject = cashierCountsOriginal ? "original-cashier" : "authorized-admin";
    login(originalAuthorId, originalSubject, cashierCountsOriginal ? "staff" : "admin", cashierCountsOriginal ? cashierPermissions : permissions);
    expect(session.hasLevel("admin")).toBe(!cashierCountsOriginal);
    authority = newAuthority();
    calls = mainCalls(repository, new ShiftSyncJournal(repository, { authorRequired: true }), branch, terminal, session, authority);
    expect(await authority.enrollOnline({ accessToken: "synthetic-admin-access" })).toEqual({ ok: true });
    expect(await sqlRows("SELECT * FROM dbo.pos_sync_shift_closing_starts;")).toEqual(savedStarts);
    expect(authority.validatePendingClosingStart(startProof)).toEqual(startProof);
    await expect(calls.commitLocalShiftCashCount({ shiftId: shift, cash: 100, clientKey: "original-1", terminalId: terminal })).resolves.toMatchObject({ ok: true, state: "CLOSED" });
    const beforeRecountDenied = await closingFacts();
    login(cashierId, "original-cashier", "staff", cashierPermissions);
    await expect(calls.commitLocalShiftRecount({ shiftId: shift, cash: 110, reason: "No recount permission", clientKey: "denied-recount", terminalId: terminal })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await closingFacts()).toEqual(beforeRecountDenied);
    login(adminId, "authorized-admin", "admin", permissions);
    expect(session.identity()).toMatchObject({ level: "admin", source: "pos", authorId: adminId });
    expect(await scalar("SELECT role FROM app_users WHERE id=$1", [adminId])).toBe("admin");
    authority = newAuthority(); calls = mainCalls(repository, new ShiftSyncJournal(repository, { authorRequired: true }), branch, terminal, session, authority);
    expect(await authority.enrollOnline({ accessToken: "synthetic-admin-access" })).toEqual({ ok: true });
    await calls.commitLocalShiftRecount({ shiftId: shift, cash: 110, reason: "First recount", clientKey: "recount-1", terminalId: terminal });
    await calls.commitLocalShiftRecount({ shiftId: shift, cash: 120, reason: "Second recount", clientKey: "recount-2", terminalId: terminal });
    const savedIntents = await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;");
    expect(savedIntents).toHaveLength(3);
    if(openingAlreadyAcknowledged){
      expect((await sqlRows("SELECT status FROM dbo.shifts;"))[0].status).toBe("CLOSED");
      expect(await scalar("SELECT status FROM public.shifts WHERE id=$1",[shift])).toBe("OPEN");
      expect(savedIntents.every((row:Row)=>row.acknowledged_at===null)).toBe(true);
      expect((await sqlRows("SELECT COUNT(*) pending FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL;"))[0].pending).toBeGreaterThan(0);
    }

    const frozen = savedIntents.map((row: Row) => JSON.parse(row.payload_json));
    expect(frozen.map((value: Row) => value.kind)).toEqual(["ORIGINAL", "RECOUNT", "RECOUNT"]);
    expect(frozen[1].predecessorIntentId).toBe(frozen[0].intentId); expect(frozen[2].predecessorIntentId).toBe(frozen[1].intentId);
    expect(frozen.map((value: Row) => value.operations.find((op: Row) => op.table === "shift_cash_counts").rows.length)).toEqual([1, 2, 3]);
    expect(await reader.frozenOpeningRows(opening.operationId, branch)).toEqual(frozenOpen);
    login(randomUUID(), "different-current-cashier", "staff", { can_process_sale: true });
    const queued = await reader.pendingAggregates(branch, 500);
    expect(queued.filter((entry: Row) => entry.aggregateId.toLowerCase() === frozen[0].intentId)).toHaveLength(1);
    const signed = await reader.protectedIntent(savedIntents[0].intent_id, branch);
    expect(signed.shiftAuthor).toMatchObject({ authorId: originalAuthorId, subject: originalSubject, action: "ORIGINAL" });
    expect(authority.validatePending(signed.shiftAuthor)).toEqual(signed.shiftAuthor);
    expect(() => authority.validatePending({ ...signed.shiftAuthor, keyId: randomUUID() })).toThrow();
    expect(signed.shiftClosingStart).toEqual(startProof);
    for (const intent of savedIntents.slice(1))
      expect((await reader.protectedIntent(intent.intent_id, branch)).shiftClosingStart).toBeNull();
    const wire = signed;
    // Send only the protocol's declared wire fields, exactly as PushWorker does.
    const shiftIntent = Object.fromEntries(["version", "intentId", "shiftId", "kind", "baseToken", "predecessorIntentId", "predecessorIntentHash", "payloadJson"].map(key => [key, wire[key]]));
    const receiptsBeforeDenial = Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_author_receipts"));
    for (const altered of [{ ...signed.shiftAuthor, signature: "A".repeat(86) }, { ...signed.shiftAuthor, authorId: originalAuthorId === cashierId ? adminId : cashierId }])
      await expect(cloud.pushAggregate({ batchId: signed.intentId, branchId: branch, shiftIntent, shiftAuthor: altered, shiftClosingStart: startProof })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    for (const altered of [{ ...startProof, signature: "A".repeat(86) }, { ...startProof, authorId: adminId }])
      await expect(cloud.pushAggregate({ batchId: signed.intentId, branchId: branch, shiftIntent,
        shiftAuthor: signed.shiftAuthor, shiftClosingStart: altered })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    const uploadOriginal = () => cloud.pushAggregate({ batchId: signed.intentId, branchId: branch, shiftIntent, shiftAuthor: signed.shiftAuthor, shiftClosingStart: startProof });
    if (openingAlreadyAcknowledged) {
      // These current-grant checks need an accepted cloud opening. The other
      // scenario deliberately keeps OPEN queued until the real worker drains it.
      await db!.query("UPDATE app_users SET permissions='{}'::jsonb WHERE id=$1", [originalAuthorId]);
      await expect(uploadOriginal()).rejects.toThrow("SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED");
      await db!.query("UPDATE app_users SET permissions=$2::jsonb,store_id=$3 WHERE id=$1", [originalAuthorId, JSON.stringify(cashierCountsOriginal ? cashierPermissions : permissions), randomUUID()]);
      await expect(uploadOriginal()).rejects.toThrow("SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED");
      await db!.query("UPDATE app_users SET store_id=$2 WHERE id=$1", [originalAuthorId, branch]);
    }
    expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_closing_start_receipts"))).toBe(0);
    expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_author_receipts"))).toBe(receiptsBeforeDenial);
    expect(await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")).toEqual(savedIntents);
    outbound.length = 0; // Subsequent assertions count the actual worker attempts only.
    const startRequestsBeforeWorker = rpcCalls.filter(call => call.name === "pos_sync_push_started_shift_intent").length;
    const recountRequestsBeforeWorker = rpcCalls.filter(call => call.name === "pos_sync_push_author_shift_intent").length;
    // Keep the actual driver's UUID casing; do not normalize the reader or
    // fixture to hide a worker identity-comparison regression.

    // Actual coordinator passes first drain older sale CT, then retry the exact
    // protected intent after the server committed but its reply was lost.
    let lostRepliesObserved = 0;
    for (let pass = 0; pass < 6; pass++) {
      try { await worker.run({ branchId: branch, includeActivity: false }); }
      catch (error) {
        if ((error as Error).message !== "Synthetic committed response lost") throw error;
        expect((error as Row).code).toBe("ETIMEDOUT"); lostRepliesObserved++;
        expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_intent_receipts"))).toBe(1);
        if(openingAlreadyAcknowledged)
          expect(await scalar("SELECT status FROM public.shifts WHERE id=$1",[shift])).toBe("CLOSED");

        expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_closing_start_receipts"))).toBe(1);
        await local!.restart(); vault!.keys = vault!.reopen(); authority = newAuthority();
        worker = new PushWorker({ reader: new ChangeReader(manager, registry), cloud, checkpoints: new CheckpointRepository(manager), registry,
          validateAuthor: (value: Row) => authority.validatePending(value), validateClosingStart: (value: Row) => authority.validatePendingClosingStart(value) });
        expect((await sqlRows("SELECT acknowledged_at FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;"))[0].acknowledged_at).toBeNull();
      }
      if ((await sqlRows("SELECT acknowledged_at FROM dbo.pos_sync_shift_intents;")).every((row: Row) => row.acknowledged_at)) break;
    }
    expect(lostRepliesObserved).toBe(1);
    const accepted = await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;");
    expect(accepted.every((row: Row) => row.acknowledged_at)).toBe(true);
    expect(accepted.map((row: Row) => row.payload_json)).toEqual(savedIntents.map((row: Row) => row.payload_json));
    const graph = await cloud.shiftGraph({ branchId: branch, shiftId: shift });
    const closedAtRaw = graph.closedAtRaw;
    expect(Number(graph.tables[0].rows[0].counted_cash)).toBe(120);
    expect(graph.tables.find((part: Row) => part.table === "shift_cash_counts").rows.map((row: Row) => row.counted_by_staff_id).sort()).toEqual([originalSubject, "authorized-admin", "authorized-admin"].sort());
    expect(graph.tables[0].rows[0].closing_started_by).toBe("original-cashier");
    const startEvents = graph.tables.find((part: Row) => part.table === "shift_close_events").rows.filter((row: Row) => row.event === "closing_started");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({ actor_staff_id: "original-cashier", actor_name: "original-cashier" });
    expect(Number(await scalar("SELECT count(*) FROM public.sales"))).toBe(1);
    expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_intent_receipts"))).toBe(3);
    const sentIntents = outbound.filter(body => body.sqlServerAggregate?.shiftIntent);
    expect(sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.intentId === frozen[0].intentId)).toHaveLength(2);
    expect(sentIntents.every(body => !("operations" in body.sqlServerAggregate))).toBe(true);
    expect(sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.intentId === frozen[0].intentId).map(body => body.sqlServerAggregate.shiftIntent.payloadJson)).toEqual([savedIntents[0].payload_json, savedIntents[0].payload_json]);
    expect(sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.intentId === frozen[0].intentId).every(body =>
      JSON.stringify(body.sqlServerAggregate.shiftClosingStart) === JSON.stringify(startProof))).toBe(true);
    expect(rpcCalls.filter(call => call.name === "pos_sync_push_started_shift_intent").length - startRequestsBeforeWorker).toBe(2);
    expect(rpcCalls.filter(call => call.name === "pos_sync_push_started_shift_intent").every(call =>
      call.args.p_closing_start.authorId === cashierId && call.args.p_shift_author.authorId === originalAuthorId)).toBe(true);
    const recountRequests = sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.kind === "RECOUNT");
    expect(recountRequests).toHaveLength(2);
    expect(recountRequests.every(body => !("shiftClosingStart" in body.sqlServerAggregate))).toBe(true);
    expect(rpcCalls.filter(call => call.name === "pos_sync_push_author_shift_intent").length - recountRequestsBeforeWorker).toBe(2);
    const registeredAuthors = rpcCalls.filter(call => call.name === "pos_shift_author_key").map(call => call.args.p_author_id);
    expect(registeredAuthors).toContain(cashierId); expect(registeredAuthors).toContain(adminId);
    const firstIntentIndex = outbound.findIndex(body => body.sqlServerAggregate?.shiftIntent);
    expect(outbound.slice(0, firstIntentIndex).some(body => body.sqlServerAggregate?.operations?.some((op: Row) => op.table === "sales" && op.rows.some((row: Row) => row.id === sale)))).toBe(true);
    const openingRetry=outbound.find(body => body.sqlServerAggregate?.operations?.some((op: Row) => op.table === "shifts"));
    if(openingAlreadyAcknowledged)expect(openingRetry).toBeUndefined();
    else expect(openingRetry?.sqlServerAggregate.operations.find((op: Row) => op.table === "shifts").rows[0]).toMatchObject({ status: "OPEN", state: "ACTIVE", closed_at: null });
    expect((await sqlRows("SELECT * FROM dbo.pos_sync_shift_baselines;")).length).toBe(0); // ACK never installs baseline.

    // Actual existing web correction SQL, with its authenticated web wrapper
    // outside this fixture. This does not claim web-route authentication coverage.
    await scalar("SELECT public.pos_admin_correct_closed_shift($1::uuid,130,NULL,NULL,'Synthetic web recount','web-admin','Web Admin',$2,$3)", [shift, terminal, randomUUID()]);
    const remote = await cloud.shiftGraph({ branchId: branch, shiftId: shift });
    expect(remote.closedAtRaw).toBe(closedAtRaw);
    const child = remote.tables.find((part: Row) => part.table === "shift_cash_counts").rows.find((row: Row) => row.counted_by_staff_id === "web-admin");
    expect(child).toBeDefined();
    feed.push({ cursor: 1, table_name: "shift_cash_counts", entity_id: JSON.stringify({ id: child.id }), operation: "insert", row_version: child.row_version, tombstone: false, row_data: child });
    const publish = vi.fn(), pull = new PullWorker({ connectionManager: manager, cloud, reader, registry, checkpoints, publish, conflicts: { reconcileAcknowledged: async () => {} } });
    // A genuine unuploaded local note remains a barrier. Do not suppress it
    // merely because older complete closing graphs were receipted.
    await manager.pool.request().input("shift", shift).query("UPDATE dbo.shifts SET note=N'Pending local note',row_version=row_version+1 WHERE id=@shift;");
    const priorBaseline = await sqlRows("SELECT * FROM dbo.pos_sync_shift_baselines;"), priorIntents = await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;");
    const pushCheckpoints = await sqlRows("SELECT * FROM dbo.sync_checkpoints WHERE direction=N'push' ORDER BY entity_type;");
    await expect(pull.run({ branchId: branch, skipMembership: true })).rejects.toMatchObject({ code: "ELOCAL_CT_PENDING" });
    expect(await checkpoints.get(branch, "__feed__", "pull")).toBeNull();
    expect(await sqlRows("SELECT * FROM dbo.pos_sync_shift_baselines;")).toEqual(priorBaseline);
    expect(await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")).toEqual(priorIntents);
    expect((await sqlRows("SELECT note,counted_cash FROM dbo.shifts;"))[0]).toMatchObject({ note: "Pending local note", counted_cash: 120 });
    expect(publish).not.toHaveBeenCalled();
    // Resolve only the synthetic note in the fixture, mark that exact test
    // transaction cloud-origin, and keep the original upload checkpoints.
    await manager.pool.request().input("shift", shift).query("WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.shifts SET note=N'',row_version=row_version+1 WHERE id=@shift;");
    await expect(pull.run({ branchId: branch, skipMembership: true })).resolves.toMatchObject({ conflicts: 0, deferredLocalChanges: false });
    expect((await sqlRows("SELECT counted_cash FROM dbo.shifts;"))[0].counted_cash).toBe(130);
    const baseline = (await sqlRows("SELECT * FROM dbo.pos_sync_shift_baselines;"))[0];
    expect(baseline.graph_token).toBe(remote.graphToken);
    expect(baseline.closed_at_raw).toBe(closedAtRaw);
    expect(JSON.parse(baseline.graph_json).tables.map((part: Row) => part.table)).toEqual(graphNames);
    expect((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor).toBe("1");
    expect(await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")).toEqual(priorIntents);
    expect(await sqlRows("SELECT * FROM dbo.sync_checkpoints WHERE direction=N'push' ORDER BY entity_type;")).toEqual(pushCheckpoints);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(rpcCalls.some(call => call.name === "pos_sync_shift_graph")).toBe(true);
    expect(rpcCalls.some(call => call.name === "pos_sync_feed_page_v1")).toBe(true);
    expect(rpcCalls.some(call => call.name === "pos_sync_pull")).toBe(false);
  }
  it("preserves separately signed starter/count authors through restart, lost reply, recounts and protected web adoption",()=>exerciseClosingProtocol(false),180000);
  it("uploads an offline closing after OPEN was already acknowledged, retaining complete signed work through a lost reply and retry",()=>exerciseClosingProtocol(true),180000);
  it("accepts an ordinary cashier closing and subsequent real Administrator recounts with current role/branch denials",()=>exerciseClosingProtocol(true, true),180000);
});
