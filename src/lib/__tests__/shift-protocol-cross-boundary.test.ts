import { afterAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// Opt-in Windows engine test. This runs real LocalDB and PGlite, but is NOT an
// installed Electron/IPC, physical device, live Supabase or author-signature test.
// All HTTP goes through the real sync API in-process; only the transport,
// device-registry identity and feed-page selection are isolated adapters.
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "synthetic-service", supabaseConfig: () => ({ url: "https://cloud.invalid", key: "synthetic-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { handleSyncRequest } from "../sync-endpoint.server";

const require = createRequire(import.meta.url);
const enabled = process.env.CODEX_SHIFT36_LOCALDB === "1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic CJS and SQL engine fixture boundary
type Row = Record<string, any>;
let local: Row | undefined, db: Row | undefined;
afterAll(async () => { vi.unstubAllGlobals(); try { await db?.close(); } finally { await local?.close(); } }, 60000);

describe.skipIf(!enabled)("opt-in actual native storage → worker → CloudClient → API → isolated PostgreSQL", () => {
  it("preserves an offline opening/sale/three-intent chain across a lost reply, cashier switch and child-only web download", async () => {
    const { createCloud, createLocal, mainCalls, graphNames } = require("../../../scripts/lib/shift-protocol-integration-fixture.cjs");
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
    const aggregates = new AggregateRepository(manager, repository), writer = new ShiftSyncJournal(repository);
    const reader = new ChangeReader(manager, registry), checkpoints = new CheckpointRepository(manager);
    let identity = { subject: "original-cashier" };
    const calls = mainCalls(repository, writer, branch, terminal, () => identity);
    const scalar = async (query: string, args: unknown[] = []) => Object.values((await db!.query(query, args)).rows[0])[0] as Row;
    const sqlRows = async (query: string) => (await manager.pool.request().query(query)).recordset;
    const outbound: Row[] = [], rpcCalls: Row[] = [], feed: Row[] = [];
    let loseOriginalReply = true;
    const rpc = async (name: string, args: Row) => {
      rpcCalls.push({ name, args: structuredClone(args) });
      const specs: Record<string, [string, string][]> = {
        pos_sync_push_aggregate: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_operations", "jsonb"]],
        pos_sync_push_shift_intent: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_operations", "jsonb"], ["p_shift_intent", "jsonb"]],
        pos_sync_push_batch: [["p_batch_id", "uuid"], ["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_table", "text"], ["p_rows", "jsonb"], ["p_changes", "jsonb"]],
        pos_sync_shift_graph: [["p_organization_id", "text"], ["p_branch_id", "text"], ["p_terminal_id", "text"], ["p_shift_id", "uuid"]],
      };
      if (name === "pos_sync_pull") {
        expect(args.p_branch_id).toBe(branch); expect(args.p_terminal_id).toBe(terminal);
        return feed.filter(row => row.cursor > args.p_after_cursor).slice(0, args.p_limit);
      }
      const spec = specs[name]; expect(spec, `Unexpected synthetic RPC ${name}`).toBeDefined();
      // Verify the ACTUAL serialized PostgREST named-argument set, including
      // explicit NULL operations for v3. The adapter never silently fills it.
      expect(Object.keys(args).sort()).toEqual(spec.map(([key]) => key).sort());
      const values = spec.map(([key, type]) => type === "jsonb" && args[key] !== null ? JSON.stringify(args[key]) : args[key]);
      return scalar(`SELECT public.${name}(${spec.map(([key, type], index) => `${key}=>$${index + 1}::${type}`).join(",")}) AS result`, values);
    };
    vi.stubGlobal("fetch", vi.fn(async (value: string | URL | Request, options?: RequestInit) => {
      const url = String(value);
      if (url === "https://pos.invalid/api/v1/pos/sync") {
        const body = JSON.parse(String(options?.body)); outbound.push(structuredClone(body));
        const response = await handleSyncRequest(new Request(url, options));
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
      const match = /^https:\/\/cloud\.invalid\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url);
      if (match) {
        try { return Response.json(await rpc(match[1], JSON.parse(String(options?.body)))); }
        catch (error) { return Response.json({ message: (error as Error).message, code: (error as Row).code }, { status: 400 }); }
      }
      throw new Error(`External/unexpected network is blocked: ${url}`);
    }));
    const cloud = new CloudClient({ connectionManager: manager, configStore: { get: () => "https://pos.invalid" },
      terminalStore: { read: () => ({ tokenId: terminal, locationId: branch, deviceUse: "operations", deviceBindingProof: proof, deviceClaimProof: proof }) } });
    const worker = new PushWorker({ reader, cloud, checkpoints, registry });

    const openedAt = "2026-11-02T01:00:00.000Z";
    const opening = await aggregates.commit("shift", { branchId: branch, terminalId: terminal, permissions: { can_open_shift: true }, operations: [{ kind: "upsert", table: "shifts", rows: [{
      id: shift, store_id: branch, terminal_id: terminal, terminal_name: "Synthetic till", opened_by_name: "original-cashier", opened_by_staff_id: "original-cashier", opened_by_role: "cashier",
      opened_at: openedAt, opening_float: 20, note: "", overdue: false, created_at: openedAt, updated_at: openedAt, status: "OPEN", state: "ACTIVE", row_version: 1,
    }] }] });
    const frozenOpen = await reader.frozenOpeningRows(opening.operationId, branch);
    await aggregates.commit("sale", { branchId: branch, terminalId: terminal, permissions: { can_process_sale: true }, operations: [{ kind: "insert", table: "sales", rows: [{
      id: sale, bill_number: "SYNTHETIC-OFFLINE-1", store_id: branch, shift_id: shift, cashier_name: "original-cashier", subtotal_amount: 80, total_amount: 80,
      discount_amount: 0, tax_amount: 0, payment_type: "cash", payments: [], points_earned: 0, points_redeemed: 0, is_exchange: false, is_refunded: false,
      paid_amount: 80, change_amount: 0, exchange_credit: 0, coupon_discount: 0, rounding_adjustment: 0, row_version: 1, created_at: openedAt,
    }] }] });
    await calls.startLocalShiftClose({ shiftId: shift, reason: "End of day", terminalId: terminal });
    await expect(calls.commitLocalShiftCashCount({ shiftId: shift, cash: 100, clientKey: "original-1", terminalId: terminal })).resolves.toMatchObject({ ok: true, state: "CLOSED" });
    identity = { subject: "authorized-admin" };
    await calls.commitLocalShiftRecount({ shiftId: shift, cash: 110, reason: "First recount", clientKey: "recount-1", terminalId: terminal });
    await calls.commitLocalShiftRecount({ shiftId: shift, cash: 120, reason: "Second recount", clientKey: "recount-2", terminalId: terminal });
    const savedIntents = await sqlRows("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;");
    expect(savedIntents).toHaveLength(3);
    const frozen = savedIntents.map((row: Row) => JSON.parse(row.payload_json));
    expect(frozen.map((value: Row) => value.kind)).toEqual(["ORIGINAL", "RECOUNT", "RECOUNT"]);
    expect(frozen[1].predecessorIntentId).toBe(frozen[0].intentId); expect(frozen[2].predecessorIntentId).toBe(frozen[1].intentId);
    expect(frozen.map((value: Row) => value.operations.find((op: Row) => op.table === "shift_cash_counts").rows.length)).toEqual([1, 2, 3]);
    expect(await reader.frozenOpeningRows(opening.operationId, branch)).toEqual(frozenOpen);
    identity = { subject: "different-current-cashier" };
    const queued = await reader.pendingAggregates(branch, 500);
    expect(queued.filter((entry: Row) => entry.aggregateId.toLowerCase() === frozen[0].intentId)).toHaveLength(1);
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
    expect(graph.tables.find((part: Row) => part.table === "shift_cash_counts").rows.map((row: Row) => row.counted_by_staff_id).sort()).toEqual(["authorized-admin", "authorized-admin", "original-cashier"].sort());
    expect(Number(await scalar("SELECT count(*) FROM public.sales"))).toBe(1);
    expect(Number(await scalar("SELECT count(*) FROM pos_sync_private.shift_intent_receipts"))).toBe(3);
    const sentIntents = outbound.filter(body => body.sqlServerAggregate?.shiftIntent);
    expect(sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.intentId === frozen[0].intentId)).toHaveLength(2);
    expect(sentIntents.every(body => !("operations" in body.sqlServerAggregate))).toBe(true);
    expect(sentIntents.filter(body => body.sqlServerAggregate.shiftIntent.intentId === frozen[0].intentId).map(body => body.sqlServerAggregate.shiftIntent.payloadJson)).toEqual([savedIntents[0].payload_json, savedIntents[0].payload_json]);
    const firstIntentIndex = outbound.findIndex(body => body.sqlServerAggregate?.shiftIntent);
    expect(outbound.slice(0, firstIntentIndex).some(body => body.sqlServerAggregate?.operations?.some((op: Row) => op.table === "sales" && op.rows.some((row: Row) => row.id === sale)))).toBe(true);
    expect(outbound.find(body => body.sqlServerAggregate?.operations?.some((op: Row) => op.table === "shifts"))?.sqlServerAggregate.operations.find((op: Row) => op.table === "shifts").rows[0]).toMatchObject({ status: "OPEN", state: "ACTIVE", closed_at: null });
    expect((await sqlRows("SELECT * FROM dbo.pos_sync_shift_baselines;")).length).toBe(0); // ACK never installs baseline.

    // Actual existing web correction SQL, with its authenticated web wrapper
    // outside this fixture. No new author-signature/financial-admission claim.
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
  }, 180000);
});
