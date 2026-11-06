import { canCrossBranches } from "@/core/api/relay-policy.server";
import { canRetrieveHistoricalReceipt } from "./receipt-history-permission";
import { alignVerifiedScopeIds } from "./verified-scope-ids";
/**
 * Shared handler for the POS sync relay.
 *
 * Mounted at `/api/v1/pos/sync` (canonical) and at the legacy
 * `/api/public/sync` path, which shipped tills still call. Both run exactly
 * the same authorisation: prove the caller, resolve their branch and
 * permissions on the server, then commit only what those allow.
 */
import { z } from "zod";
import { syncAggregateSchema } from "./sync-shift-intent.server";

const opSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("insert"),
    table: z.string().min(1).max(64),
    rows: z.array(z.record(z.string(), z.unknown())).max(500),
  }),
  z.object({
    kind: z.literal("upsert"),
    table: z.string().min(1).max(64),
    rows: z.array(z.record(z.string(), z.unknown())).max(500),
    onConflict: z.string().max(120).optional(),
  }),
  z.object({
    kind: z.literal("update"),
    table: z.string().min(1).max(64),
    values: z.record(z.string(), z.unknown()),
    match: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("delete"),
    table: z.string().min(1).max(64),
    match: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("rpc"),
    table: z.string().min(1).max(64),
    // Only routines the relay knows about are accepted, and it re-checks the
    // caller's branch and permission before running one.
    fn: z.enum([
      "pos_sale_commit",
      "sale_refund",
      "shift_cash_count_submit",
      "stock_transfer_approve",
      "stock_transfer_dispatch",
      "stock_transfer_dispatch_atomic",
      "stock_transfer_receive",
      "stock_transfer_verify",
    ]),
    args: z.record(z.string(), z.unknown()),
  }),
]);

const bodySchema = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
  deviceClaimProof: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  managementSyncBranches: z.literal(true).optional(),
  ops: z.array(opSchema).max(50).optional(),
  sqlServerBatch: z
    .object({
      batchId: z.string().uuid(),
      organizationId: z.string().min(1).max(128),
      branchId: z.string().min(1).max(128),
      table: z
        .string()
        .regex(/^[a-z_][a-z0-9_]*$/)
        .max(64),
      rows: z.array(z.record(z.string(), z.unknown())).max(2000),
      changes: z.array(z.record(z.string(), z.unknown())).max(2000),
    })
    .optional(),
  sqlServerAggregate: syncAggregateSchema.optional(),
  sqlServerStockHistory:z.object({version:z.literal(1),branchId:z.string().min(1).max(128),terminalId:z.string().min(1).max(128),
    rows:z.array(z.object({id:z.string().uuid(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/),payloadJson:z.string().min(2).max(126976),authorProofJson:z.string().min(2).max(16384).optional(),sourceCohortJson:z.string().min(2).max(65536).optional()}).strict()).min(1).max(8),
  }).strict().optional(),
  sqlServerStockFrontier:z.discriminatedUnion('action',[
    z.object({version:z.literal(1),action:z.literal('challenge'),branchId:z.string().min(1).max(128),terminalId:z.string().min(1).max(128),
      challengeId:z.string().uuid(),authorId:z.string().uuid(),keyId:z.string().uuid()}).strict(),
    z.object({version:z.literal(1),action:z.literal('accept'),branchId:z.string().min(1).max(128),terminalId:z.string().min(1).max(128),
      frontierJson:z.string().min(2).max(8192),proofJson:z.string().min(2).max(8192)}).strict(),
  ]).optional(),
  sqlServerLegacyRecovery: z.object({
    organizationId: z.string().min(1).max(128),
    branchId: z.string().min(1).max(128),
    payloadJson: z.string().min(2).max(256 * 1024),
    attestation: z.unknown(),
  }).strict().optional(),
  sqlServerFinancialCapability:z.object({organizationId:z.string().min(1).max(128),branchId:z.string().min(1).max(128),shiftId:z.string().uuid().optional()}).strict().optional(),
  sqlServerFinancialEvent:z.object({organizationId:z.string().min(1).max(128),branchId:z.string().min(1).max(128),operationJson:z.string().min(2).max(6*1024*1024),proof:z.unknown()}).strict().optional(),
  sqlServerFinancialBasis:z.object({organizationId:z.string().min(1).max(128),branchId:z.string().min(1).max(128),shiftId:z.string().uuid()}).strict().optional(),
  sqlServerFinancialObservation:z.object({organizationId:z.string().min(1).max(128),branchId:z.string().min(1).max(128),operationJson:z.string().min(2).max(16384)}).strict().optional(),
  sqlServerShiftGraph: z.object({
    organizationId: z.string().min(1).max(128), branchId: z.string().min(1).max(128), shiftId: z.string().uuid(),
  }).strict().optional(),
  sqlServerPull: z
    .object({
      organizationId: z.string().min(1).max(128),
      branchId: z.string().min(1).max(128),
      cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      limit: z.number().int().min(10).max(2000),
    })
    .optional(),
  sqlServerBootstrap: z
    .object({
      organizationId: z.string().min(1).max(128),
      branchId: z.string().min(1).max(128),
      table: z
        .string()
        .regex(/^[a-z_][a-z0-9_]*$/)
        .max(64),
      cursor: z.string().max(512).nullable(),
      historyDays: z.number().int().min(30).max(7300),
      limit: z.number().int().min(10).max(2000),
    })
    .optional(),
  sqlServerCounts: z
    .object({
      organizationId: z.string().min(1).max(128),
      branchId: z.string().min(1).max(128),
      historyDays: z.number().int().min(30).max(7300),
    })
    .optional(),
  sqlServerTelemetry: z
    .object({
      terminal_id: z.string().min(1).max(128),
      store_id: z.string().min(1).max(128),
      terminal_name: z.string().max(160).nullable(),
      branch_code: z.string().max(64).nullable(),
      session_status: z.enum(["signed_in", "idle"]).nullable(),
      staff_name: z.string().max(160).nullable(),
      staff_role: z.string().max(64).nullable(),
      db_mode: z.string().max(32),
      connection_status: z.string().max(32),
      storage_engine: z.literal("sqlserver"),
      pending_count: z.number().int().nonnegative(),
      conflict_count: z.number().int().nonnegative(),
      failed_count: z.number().int().nonnegative(),
      last_synced_at: z.string().datetime().nullable(),
      last_push_at: z.string().datetime().nullable(),
      last_pull_at: z.string().datetime().nullable(),
      app_version: z.string().max(64),
      platform: z.string().max(64).nullable(),
      sql_server_state: z.string().max(64),
      database_name: z.string().max(128).nullable(),
      schema_version: z.number().int().nonnegative().nullable(),
      sync_phase: z.string().max(64).nullable(),
      current_table: z.string().max(128).nullable(),
      last_seen_at: z.string().datetime(),
    })
    .optional(),
  oldReceipt: z
    .object({ lookup: z.string().min(1).max(128), branchId: z.string().min(1).max(128) })
    .optional(),
  read: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("transferRequestApprovalState"), requestId: z.string().uuid() }),
      z.object({ kind: z.literal("activeShift"), storeId: z.string().min(1).max(64) }),
      z.object({ kind: z.literal("stores") }),
      z.object({ kind: z.literal("health") }),
    ])
    .optional(),
});

async function boundedRecoveryBody(request: Request): Promise<string> {
  const limit = 256 * 1024;
  const oversized = () => Object.assign(new Error("The recovery request exceeds 256 KiB."), { code: "PAYLOAD_TOO_LARGE" });
  if (Number(request.headers.get("content-length")) > limit) throw oversized();
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing recovery body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, raw = "";
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel().catch(() => undefined); throw oversized(); }
      raw += decoder.decode(part.value, { stream: true });
    }
    return raw + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function handleSyncRequest(request: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  let exactFinancialOperations = false;
  try {
    // This header only LOWERS the existing generic limit. It grants no identity
    // or permission; all device, reviewer and branch guards still run below.
    const raw = request.headers.get("x-pos-legacy-recovery") === "1" ? await boundedRecoveryBody(request) : await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024)
      return Response.json(
        { ok: false, code: "PAYLOAD_TOO_LARGE", error: "The sync batch exceeds 8 MiB." },
        { status: 413 },
      );
    body = bodySchema.parse(JSON.parse(raw));
    if (body.sqlServerLegacyRecovery && request.headers.get("x-pos-legacy-recovery") !== "1")
      throw new Error("Missing bounded recovery transport");
    if (body.sqlServerAggregate?.financialLedgerProjection) {
      // Validate with the established schema first. Restore only numeric leaves
      // inside its accepted row/change records; never restore stripped operation
      // fields or replace trusted branch/actor normalization later in the flow.
      const { parseExactJson, isExactNumber } = await import("../../electron/sync/shift-recovery-exact.mjs");
      const exact = parseExactJson(raw, { maxBytes: 8 * 1024 * 1024, maxDepth: 128 }) as Record<string, unknown>;
      const rawAggregate = exact.sqlServerAggregate as Record<string, unknown>;
      const operations = body.sqlServerAggregate.operations;
      if (!operations || !Array.isArray(rawAggregate?.operations) || operations.length !== rawAggregate.operations.length)
        throw new Error("Invalid exact financial operations");
      const originals = rawAggregate.operations;
      const restore = (value: unknown, original: unknown): unknown => {
        if (typeof value === "number") {
          if (!isExactNumber(original)) throw new Error("Missing exact numeric source");
          return original;
        }
        if (Array.isArray(value)) {
          if (!Array.isArray(original) || value.length !== original.length) throw new Error("Invalid exact array source");
          return value.map((item, index) => restore(item, original[index]));
        }
        if (value && typeof value === "object") {
          if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("Invalid exact record source");
          return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (!Object.hasOwn(original, key)) throw new Error("Missing exact record field");
            return [key, restore(item, (original as Record<string, unknown>)[key])];
          }));
        }
        return value;
      };
      body.sqlServerAggregate.operations = operations.map((operation, index) => {
        const original = originals[index] as Record<string, unknown>;
        return { ...operation,
          rows: restore(operation.rows, original.rows) as typeof operation.rows,
          changes: restore(operation.changes, original.changes) as typeof operation.changes,
        };
      });
      exactFinancialOperations = true;
    }
    if(body.sqlServerStockFrontier||body.sqlServerStockHistory||body.sqlServerLegacyRecovery||body.sqlServerFinancialCapability||body.sqlServerFinancialEvent||body.sqlServerFinancialBasis||body.sqlServerFinancialObservation||body.sqlServerAggregate?.registerFinancialBoundary||body.sqlServerAggregate?.shiftFinancialOpening||body.sqlServerAggregate?.financialLedgerProjection||body.sqlServerAggregate?.stockSourceCohorts){
      const operations=[body.managementSyncBranches,body.ops?.length,body.read,body.sqlServerBatch,body.sqlServerAggregate,body.sqlServerStockFrontier,body.sqlServerStockHistory,body.sqlServerLegacyRecovery,body.sqlServerFinancialCapability,body.sqlServerFinancialEvent,body.sqlServerFinancialBasis,body.sqlServerFinancialObservation,body.sqlServerShiftGraph,body.sqlServerPull,body.sqlServerBootstrap,body.sqlServerCounts,body.sqlServerTelemetry,body.oldReceipt];
      if(operations.filter(Boolean).length!==1)throw new Error('Mixed financial metadata request');
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "PAYLOAD_TOO_LARGE")
      return Response.json({ ok: false, code: "PAYLOAD_TOO_LARGE", error: "The recovery request exceeds 256 KiB; saved work remains pending." }, { status: 413 });
    return Response.json({ ok: false, error: "Malformed request" }, { status: 400 });
  }

  // Every till attaches its raw session token as a bearer. Use it when the
  // body did not carry one, so the header is a first-class proof.
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && !body.sessionToken && bearer.length <= 400) {
    body = { ...body, sessionToken: bearer };
  } else if (bearer && !body.accessToken && bearer.length > 400) {
    body = { ...body, accessToken: bearer.slice(0, 4000) };
  }

  if (
    !body.managementSyncBranches &&
    !body.ops?.length &&
    !body.read &&
    !body.sqlServerBatch &&
    !body.sqlServerAggregate &&
    !body.sqlServerStockHistory &&
    !body.sqlServerStockFrontier &&
    !body.sqlServerLegacyRecovery &&
    !body.sqlServerFinancialEvent &&
    !body.sqlServerFinancialBasis &&
    !body.sqlServerFinancialCapability &&
    !body.sqlServerFinancialObservation &&
    !body.sqlServerShiftGraph &&
    !body.sqlServerPull &&
    !body.sqlServerBootstrap &&
    !body.sqlServerCounts &&
    !body.sqlServerTelemetry &&
    !body.oldReceipt
  )
    return Response.json({ ok: false, error: "Nothing to do" }, { status: 400 });

  const { verifyRelayCaller, runRelayOp, runRelayRead, hasServiceKey } =
    await import("@/core/api/pos-relay.server");
  // Without the internal key the relay cannot do anything: answer with a
  // readable "temporarily unavailable" instead of a blank server error.
  if (!hasServiceKey()) {
    return Response.json(
      {
        ok: false,
        code: "NO_SERVICE_KEY",
        error:
          "Central database service key is missing on the hosted POS backend. Configure POS_SUPABASE_SERVICE_ROLE_KEY on the server deployment. Work is being queued locally in the meantime.",
      },
      { status: 503 },
    );
  }

  // Every request re-checks the caller: token live AND its branch still
  // present. A caller whose branch was deleted is refused with a reason the
  // till can act on instead of a blank failure.
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  let scope: Awaited<ReturnType<typeof resolveRelayScope>>;
  let verifiedTerminal: import("./terminal-binding.server").VerifiedTerminalDescriptor | undefined;
  try {
    const { managementReplicaScope } = await import("./management-replica.server");
    const replicaScope = await managementReplicaScope(body);
    const caller = replicaScope ? null : await verifyRelayCaller(body);
    verifiedTerminal = caller?.terminal;
    if (caller?.storeId) {
      const { branchExists } = await import("./session-verify.server");
      if (!(await branchExists(caller.storeId))) {
        return Response.json(
          {
            ok: false,
            code: "BRANCH_MISSING",
            error: "Your session or branch is no longer active. Please sign in again.",
          },
          { status: 401 },
        );
      }
    }
    scope = replicaScope ?? await resolveRelayScope(caller!);
    // Signed fields retain their exact spelling. Only the existing transport and
    // derived operations may resolve SQL-equivalent scope aliases.
    const signedAuthor = body.sqlServerAggregate?.shiftAuthor;
    const signedStart = body.sqlServerAggregate?.shiftClosingStart;
    const signedFinancialBasis=body.sqlServerAggregate?.shiftFinancialBasis;
    const signedFinancialEventProof=body.sqlServerFinancialEvent?.proof;
    const signedFinancialOpening=body.sqlServerAggregate?.shiftFinancialOpening;
    const signedStockSources=body.sqlServerAggregate?.stockSourceCohorts;
    const signedRecovery=body.sqlServerLegacyRecovery;
    const signedStockHistory=body.sqlServerStockHistory;
    const signedStockFrontier=body.sqlServerStockFrontier;
    body = alignVerifiedScopeIds(body, scope);
    if (signedAuthor && body.sqlServerAggregate) body.sqlServerAggregate.shiftAuthor = signedAuthor;
    if (signedStart && body.sqlServerAggregate) body.sqlServerAggregate.shiftClosingStart = signedStart;
    if(signedFinancialBasis && body.sqlServerAggregate)body.sqlServerAggregate.shiftFinancialBasis=signedFinancialBasis;
    if(signedFinancialEventProof!==undefined&&body.sqlServerFinancialEvent)body.sqlServerFinancialEvent.proof=signedFinancialEventProof;
    if(signedFinancialOpening&&body.sqlServerAggregate)body.sqlServerAggregate.shiftFinancialOpening=signedFinancialOpening;
    if(signedStockSources&&body.sqlServerAggregate)body.sqlServerAggregate.stockSourceCohorts=signedStockSources;
    // Recovery labels and raw graph text were signed by Main. Scope alignment
    // must never edit those bytes; the verifier checks them against the binding.
    if(signedRecovery)body.sqlServerLegacyRecovery=signedRecovery;
    if(signedStockHistory)body.sqlServerStockHistory=signedStockHistory;
    if(signedStockFrontier)body.sqlServerStockFrontier=signedStockFrontier;
  } catch (e) {
    if ((e as { status?: number }).status === 503)
      return Response.json({ ok: false, code: "SERVICE_UNAVAILABLE", error: "Registration verification is temporarily unavailable." }, { status: 503 });
    return Response.json(
      { ok: false, code: "SESSION_INVALID", error: (e as Error).message },
      { status: 401 },
    );
  }

  if(body.sqlServerStockFrontier){
    if(!verifiedTerminal||!scope.terminalId)return Response.json({ok:false,code:'TERMINAL_REQUIRED',error:'A verified terminal is required.'},{status:403});
    try{
      const{stockCoverageFrontierOperation}=await import('./stock-coverage-frontier.server');
      return Response.json(await stockCoverageFrontierOperation(body.sqlServerStockFrontier,verifiedTerminal));
    }catch(error){
      const known=error&&typeof error==='object'&&'status'in error&&'code'in error;
      return Response.json({ok:false,code:known?error.code:'ESTOCK_FRONTIER_UNAVAILABLE',error:'Stock writer coverage remains unconfirmed. No stock or saved work was changed.'},{status:known?Number(error.status):503});
    }
  }
  if(body.sqlServerStockHistory){
    if(!verifiedTerminal||!scope.terminalId)return Response.json({ok:false,code:"TERMINAL_REQUIRED",error:"A verified terminal is required."},{status:403});
    try{
      const {acceptStockHistoryUpload}=await import("./stock-history-upload.server");
      return Response.json(await acceptStockHistoryUpload(body.sqlServerStockHistory,verifiedTerminal));
    }catch(error){
      const known=error&&typeof error==="object"&&"status"in error&&"code"in error;
      return Response.json({ok:false,code:known?error.code:"ESTOCK_HISTORY_UNAVAILABLE",error:"Stock history remains pending; no stock was changed."},{status:known?Number(error.status):503});
    }
  }
  if (body.managementSyncBranches) {
    if (!scope.managementReplica) return Response.json({ ok: false, error: "Management registration required" }, { status: 403 });
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const branches: { id: string }[] = [];
    for (let offset = 0; ; offset += 500) {
      const response = await serviceRest(`stores?select=id&order=id&limit=500&offset=${offset}`);
      if (!response.ok) return Response.json({ ok: false, error: "Could not load synchronization branches" }, { status: 503 });
      const page = await response.json() as { id: string }[];
      branches.push(...page);
      if (page.length < 500) break;
    }
    return Response.json({ ok: true, branches });
  }
  if (body.read) {
    // A till may only ask about its own branch.
    if (
      body.read.kind === "activeShift" &&
      !canCrossBranches(scope) &&
      body.read.storeId !== scope.storeId
    )
      return Response.json(
        { ok: false, code: "STORE_FORBIDDEN", error: "You can only read your own branch." },
        { status: 403 },
      );
    try {
      const result = ['transferRequestApprovalState', 'activeShift'].includes(body.read.kind) ? await runRelayRead(body.read, scope) : await runRelayRead(body.read);
      return Response.json(result, { status: result.ok ? 200 : result.status ?? 500 });
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
    }
  }

  if (body.sqlServerTelemetry) {
    if (body.sqlServerTelemetry.store_id !== scope.storeId)
      return Response.json(
        {
          ok: false,
          code: "STORE_FORBIDDEN",
          error: "Telemetry must belong to this terminal's branch.",
        },
        { status: 403 },
      );
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("branch_telemetry?on_conflict=terminal_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify([body.sqlServerTelemetry]),
    });
    return response.ok
      ? Response.json({ ok: true })
      : Response.json(
          { ok: false, error: (await response.text()).slice(0, 400) },
          { status: response.status },
        );
  }

  if (
    body.sqlServerBatch ||
    body.sqlServerAggregate ||
    body.sqlServerLegacyRecovery ||
    body.sqlServerFinancialEvent ||
    body.sqlServerFinancialBasis ||
    body.sqlServerFinancialCapability ||
    body.sqlServerFinancialObservation ||
    body.sqlServerShiftGraph ||
    body.sqlServerPull ||
    body.sqlServerBootstrap ||
    body.sqlServerCounts ||
    body.oldReceipt
  ) {
    const branchId =
      body.sqlServerBatch?.branchId ??
      body.sqlServerAggregate?.branchId ??
      body.sqlServerLegacyRecovery?.branchId ??
      body.sqlServerFinancialEvent?.branchId ??
      body.sqlServerFinancialBasis?.branchId ??
      body.sqlServerFinancialCapability?.branchId ??
      body.sqlServerFinancialObservation?.branchId ??
      body.sqlServerShiftGraph?.branchId ??
      body.sqlServerPull?.branchId ??
      body.sqlServerBootstrap?.branchId ??
      body.sqlServerCounts?.branchId ??
      body.oldReceipt?.branchId ??
      "";
    const terminalSync = Boolean(
      body.sqlServerBatch ||
      body.sqlServerAggregate ||
      body.sqlServerLegacyRecovery ||
      body.sqlServerFinancialEvent ||
      body.sqlServerFinancialBasis ||
      body.sqlServerFinancialCapability ||
      body.sqlServerFinancialObservation ||
      body.sqlServerShiftGraph ||
      body.sqlServerPull ||
      body.sqlServerBootstrap ||
      body.sqlServerCounts,
    );
    if (terminalSync && !scope.terminalId)
      return Response.json(
        {
          ok: false,
          code: "TERMINAL_REQUIRED",
          error:
            "SQL Server synchronization requires a verified terminal activation for this branch.",
        },
        { status: 403 },
      );
    const mayManageOtherBranches =
      scope.role === "admin" ||
      scope.roleSlug === "admin" ||
      scope.permissions.can_manage_sync_backup === true;
    const terminalBound = Boolean(body.terminalToken) || scope.kind === "terminal";
    if (!scope.managementReplica && branchId !== scope.storeId && (terminalBound || !mayManageOtherBranches))
      return Response.json(
        { ok: false, code: "STORE_FORBIDDEN", error: "You can only synchronize your own branch." },
        { status: 403 },
      );
    if (
      body.oldReceipt &&
      !canRetrieveHistoricalReceipt(scope)
    )
      return Response.json(
        {
          ok: false,
          code: "PERMISSION_DENIED",
          error: "Reprint bill or refund permission is required to retrieve historical receipts.",
        },
        { status: 403 },
      );
    try {
      const { assertStoreSyncScope } = await import("./store-sync-scope.server");
      assertStoreSyncScope(branchId, body.sqlServerBatch ? [body.sqlServerBatch] : body.sqlServerAggregate?.operations ?? []);
    } catch {
      return Response.json({ ok: false, code: "STORE_FORBIDDEN", error: "You can only synchronize your own store record." }, { status: 403 });
    }
    const protectedSettingsTables = new Set([
      "pos_settings",
      "public_flags",
      "payment_types",
      "integration_settings",
      "settings_overrides",
      "settings_locks",
      "pos_store_settings",
      "authorization_actions",
      "authorization_action_history",
    ]);
    const governanceRpcTables = new Set(["authorization_actions", "authorization_action_history"]);
    const sharedPosField = (row: Record<string, unknown>) =>
      String(row.scope ?? "").toLowerCase() === "global" &&
      String(row.scope_id ?? "") === "" && String(row.key ?? "").startsWith("pos_field:");
    const hasSharedPosField = (operation: { table: string; rows: Record<string, unknown>[];
      changes: Record<string, unknown>[] }) => operation.table === "settings_scoped" &&
      (operation.rows.some(sharedPosField) || operation.changes.some((change) => {
        if (change.key && typeof change.key === "object" &&
          sharedPosField(change.key as Record<string, unknown>)) return true;
        const encoded = change.entityId ?? change.entity_id;
        if (typeof encoded !== "string") return false;
        try { return sharedPosField(JSON.parse(encoded) as Record<string, unknown>); }
        catch { return false; }
      }));
    const governanceOperations = body.sqlServerBatch
      ? protectedSettingsTables.has(body.sqlServerBatch.table) ||
          hasSharedPosField(body.sqlServerBatch)
        ? [{ table: body.sqlServerBatch.table, rows: body.sqlServerBatch.rows,
            changes: body.sqlServerBatch.changes }]
        : []
      : (body.sqlServerAggregate?.operations ?? []).filter((operation) =>
          protectedSettingsTables.has(operation.table) || hasSharedPosField(operation),
        );
    if (governanceOperations.length) {
      const isAdmin = scope.role === "admin" || scope.roleSlug === "admin";
      if (scope.kind === "terminal" || scope.permissions.can_access_pos_settings !== true) {
        return Response.json(
          {
            ok: false,
            code: "GOVERNANCE_AUTH_REQUIRED",
            error:
              "A currently signed-in staff member with POS settings permission is required to sync POS and authorization rules.",
          },
          { status: 403 },
        );
      }
      const invalidScope = governanceOperations.some((operation) =>
        (["public_flags", "payment_types", "integration_settings"].includes(operation.table) && !isAdmin) ||
        ((operation.table === "pos_settings" || operation.table === "settings_scoped") &&
          operation.changes.some((change) =>
            ["D", "DELETE"].includes(String(change.operation ?? "").toUpperCase()))) ||
        operation.rows.some((row) => {
          if (operation.table === "pos_settings") return !isAdmin || Number(row.id) !== 1;
          if (["settings_locks", "public_flags", "payment_types", "integration_settings"].includes(operation.table)) return !isAdmin;
          if (operation.table === "settings_overrides") return false;
          if (operation.table === "settings_scoped") {
            const settingScope = String(row.scope ?? "").toLowerCase();
            const scopeId = String(row.scope_id ?? "");
            return !(
              (isAdmin && settingScope === "global" && scopeId === "" &&
                String(row.key ?? "").startsWith("pos_field:")) ||
              (settingScope === "branch" && scopeId === scope.storeId) ||
              (settingScope === "terminal" && scopeId === scope.terminalId)
            );
          }
          if (operation.table === "pos_store_settings")
            return String(row.store_id ?? "") !== scope.storeId;
          const scopeType = String(row.scope_type ?? "branch");
          const scopeId = String(row.scope_id ?? "");
          return scopeType === "global"
            ? !isAdmin
            : scopeType !== "branch" || !scope.storeId || scopeId !== scope.storeId;
        }),
      );
      if (invalidScope)
        return Response.json(
          {
            ok: false,
            code: "STORE_FORBIDDEN",
            error:
              "Authorization rules can only be synchronized for the verified branch; global rules require an administrator.",
          },
          { status: 403 },
        );
      const { authorizeSettingsMutation } = await import("@/core/api/relay-policy.server");
      for (const operation of governanceOperations.filter(op => ["settings_overrides", "settings_locks"].includes(op.table))) {
        if (operation.rows.length) {
          const authorized = await authorizeSettingsMutation({kind: "upsert", table: operation.table, rows: operation.rows}, scope);
          if (!authorized.ok) return Response.json(authorized, {status: 403});
        }
        for (const change of operation.changes) {
          if (!["D", "DELETE"].includes(String(change.operation ?? "").toUpperCase())) continue;
          let key = change.key;
          if (!key || typeof key !== "object") {
            try { key = JSON.parse(String(change.entityId ?? change.entity_id ?? "")); }
            catch { return Response.json({ok: false, code: "PERMISSION_DENIED", error: "A settings deletion needs its complete key."}, {status: 403}); }
          }
          const authorized = await authorizeSettingsMutation({kind: "delete", table: operation.table, match: key as Record<string, unknown>}, scope);
          if (!authorized.ok) return Response.json(authorized, {status: 403});
        }
      }
      const actor = scope.staffUserId ?? scope.label;
      if (body.sqlServerBatch?.table === "pos_store_settings")
        body.sqlServerBatch.rows = body.sqlServerBatch.rows.map((row) => ({
          ...row,
          updated_by: actor,
        }));
      if (body.sqlServerBatch?.table === "authorization_actions")
        body.sqlServerBatch.rows = body.sqlServerBatch.rows.map((row) => ({
          ...row,
          updated_by: actor,
        }));
      if (body.sqlServerBatch?.table === "authorization_action_history")
        body.sqlServerBatch.rows = body.sqlServerBatch.rows.map((row) => ({
          ...row,
          changed_by: actor,
          change_source: "desktop",
        }));
      if (body.sqlServerAggregate)
        body.sqlServerAggregate.operations = body.sqlServerAggregate.operations.map(
          (operation) => ({
            ...operation,
            rows:
              operation.table === "pos_store_settings"
                ? operation.rows.map((row) => ({ ...row, updated_by: actor }))
                : operation.table === "authorization_actions"
                  ? operation.rows.map((row) => ({ ...row, updated_by: actor }))
                  : operation.table === "authorization_action_history"
                    ? operation.rows.map((row) => ({
                        ...row,
                        changed_by: actor,
                        change_source: "desktop",
                      }))
                    : operation.rows,
          }),
        );
    }
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    let legacyRecovery: Awaited<ReturnType<typeof import("./legacy-shift-recovery.server").verifyLegacyShiftRecovery>> | undefined;
    if (body.sqlServerLegacyRecovery) {
      if (!verifiedTerminal)
        return Response.json({ ok: false, code: "TERMINAL_REQUIRED", error: "A verified terminal is required." }, { status: 403 });
      const { verifyLegacyShiftRecovery, LegacyRecoveryError } = await import("./legacy-shift-recovery.server");
      try {
        legacyRecovery = await verifyLegacyShiftRecovery({ terminal: verifiedTerminal, branchId,
          payloadJson: body.sqlServerLegacyRecovery.payloadJson, attestation: body.sqlServerLegacyRecovery.attestation });
      } catch (error) {
        const known = error instanceof LegacyRecoveryError;
        return Response.json({ ok: false, code: known ? error.code : "ELEGACY_RECOVERY_INVALID",
          error: "Legacy shift recovery remains pending administrator review." }, { status: known ? error.status : 403 });
      }
    }
    let verifiedFinancialOpening:Awaited<ReturnType<typeof import('./sync-financial-operation.server').verifyFinancialOpeningEnvelope>>|undefined;
    if(body.sqlServerAggregate?.shiftFinancialOpening){
      if(!verifiedTerminal)return Response.json({ok:false,code:'TERMINAL_REQUIRED',error:'A verified terminal is required.'},{status:403});
      const {verifyFinancialOpeningEnvelope}=await import('./sync-financial-operation.server');
      try{verifiedFinancialOpening=await verifyFinancialOpeningEnvelope({...body.sqlServerAggregate.shiftFinancialOpening,terminal:verifiedTerminal,branchId});}
      catch(error){const status=error&&typeof error==='object'&&'status' in error&&error.status===503?503:error&&typeof error==='object'&&'status' in error&&error.status===403?403:400;return Response.json({ok:false,code:'EFINANCIAL_OPENING_UNVERIFIED',error:'The saved opening could not be verified.'},{status});}
    }
    let authorState: Awaited<ReturnType<typeof import("./shift-author-verification.server").readShiftAuthorAuthority>> | undefined;
    let startAuthorState: typeof authorState;
    if (body.sqlServerAggregate?.shiftIntent) {
      const { verifyShiftFinancialBasis, verifyShiftAuthorAttestation, readShiftAuthorAuthority, verifyShiftClosingStart, readShiftClosingStartAuthority, ShiftAuthorError } = await import("./shift-author-verification.server");
      try {
        if (!verifiedTerminal) throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "A verified terminal is required.");
        const aggregate = body.sqlServerAggregate;
        const verifiedAuthor = await verifyShiftAuthorAttestation({ attestation: aggregate.shiftAuthor, payloadJson: aggregate.shiftIntent!.payloadJson,
          terminal: verifiedTerminal, branchId, shiftId: aggregate.shiftIntent!.shiftId, intentId: aggregate.batchId, action: aggregate.shiftIntent!.kind });
        aggregate.shiftAuthor=verifiedAuthor;
        if(aggregate.shiftFinancialBasis)aggregate.shiftFinancialBasis=await verifyShiftFinancialBasis({financial:aggregate.shiftFinancialBasis,author:verifiedAuthor});
        if (aggregate.shiftClosingStart) {
          aggregate.shiftClosingStart = await verifyShiftClosingStart({ proof: aggregate.shiftClosingStart, terminal: verifiedTerminal, branchId, shiftId: aggregate.shiftIntent!.shiftId });
          try { startAuthorState = await readShiftClosingStartAuthority(aggregate.shiftClosingStart); }
          catch (error) {
            if (error && typeof error === "object" && "status" in error && error.status === 503)
              startAuthorState = { allowed: false, code: "ESHIFT_AUTHOR_UNAVAILABLE" };
            else throw error;
          }
        }
        try { authorState = await readShiftAuthorAuthority(aggregate.shiftAuthor); }
        catch (error) {
          if (error && typeof error === "object" && "status" in error && error.status === 503)
            authorState = { allowed: false, code: "ESHIFT_AUTHOR_UNAVAILABLE" };
          else throw error;
        }
      } catch (error) {
        const unavailable = error && typeof error === "object" && "status" in error && error.status === 503;
        return Response.json({ ok: false, code: unavailable ? "ESHIFT_AUTHOR_UNAVAILABLE" : "ESHIFT_AUTHOR_INVALID",
          error: unavailable ? "Author verification is temporarily unavailable; saved work remains pending." : "The protected shift author could not be verified." }, { status: unavailable ? 503 : 403 });
      }
    }
    if(body.sqlServerFinancialEvent){
      if(!verifiedTerminal)return Response.json({ok:false,code:'TERMINAL_REQUIRED',error:'A verified terminal is required.'},{status:403});
      const {verifyFinancialOperationEnvelope}=await import('./sync-financial-operation.server');
      const {organizationId,operationJson,proof}=body.sqlServerFinancialEvent;
      try{
        const verified=await verifyFinancialOperationEnvelope({envelope:{organizationId,operationJson,proof},terminal:verifiedTerminal,branchId});
        body.sqlServerFinancialEvent.proof=verified.proof;
      }catch(error){
        const unavailable=error&&typeof error==='object'&&'status' in error&&error.status===503;
        const invalid=error&&typeof error==='object'&&'status' in error&&error.status===403;
        return Response.json({ok:false,code:unavailable?'EFINANCIAL_AUTHOR_UNAVAILABLE':invalid?'EFINANCIAL_AUTHOR_INVALID':'EFINANCIAL_OPERATION_INVALID',error:unavailable?'Financial author verification is temporarily unavailable.':'The financial operation could not be verified.'},{status:unavailable?503:invalid?403:400});
      }
    }
    if(body.sqlServerFinancialCapability&&(!verifiedTerminal||verifiedTerminal.platform!=='pc'||verifiedTerminal.mode!=='operations'))return Response.json({ok:false,code:'TERMINAL_REQUIRED',error:'A verified operating till is required.'},{status:403});
    if(body.sqlServerFinancialObservation){
      if(!verifiedTerminal||verifiedTerminal.platform!=='pc'||verifiedTerminal.mode!=='operations')return Response.json({ok:false,code:'TERMINAL_REQUIRED',error:'A verified operating till is required.'},{status:403});
      try{
        const {parseFinancialObservation}=await import('./sync-financial-operation.server');
        const observed=parseFinancialObservation(body.sqlServerFinancialObservation.operationJson);
        const {sameBranchId}=await import('./branch-id');
        if(!sameBranchId(observed.branchId,branchId)||observed.terminalId!==verifiedTerminal.id.toLowerCase())return Response.json({ok:false,code:'EFINANCIAL_OBSERVATION_FORBIDDEN',error:'The observation scope could not be verified.'},{status:403});
      }catch{return Response.json({ok:false,code:'EFINANCIAL_OBSERVATION_INVALID',error:'The observation could not be verified.'},{status:400});}
    }
    const governanceBatch =
      body.sqlServerBatch && governanceRpcTables.has(body.sqlServerBatch.table);
    const rpc = body.sqlServerLegacyRecovery
      ? (["pos_sync_recover_legacy_closing", {
          p_organization_id: body.sqlServerLegacyRecovery.organizationId, p_branch_id: branchId,
          p_terminal_id: scope.terminalId ?? "", p_payload_json: body.sqlServerLegacyRecovery.payloadJson,
          p_attestation: legacyRecovery!.attestation, p_authority: legacyRecovery!.authority,
        }] as const)
      : body.sqlServerFinancialCapability
      ? (["pos_sync_financial_capability",{p_org:body.sqlServerFinancialCapability.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_shift:body.sqlServerFinancialCapability.shiftId??null}] as const)
      : body.sqlServerFinancialObservation
      ? (["pos_sync_register_financial_observation",{p_org:body.sqlServerFinancialObservation.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_raw:body.sqlServerFinancialObservation.operationJson}] as const)
      : body.sqlServerFinancialEvent
      ? (["pos_sync_register_financial_event",{p_org:body.sqlServerFinancialEvent.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_raw:body.sqlServerFinancialEvent.operationJson,p_proof:body.sqlServerFinancialEvent.proof}] as const)
      : body.sqlServerFinancialBasis
      ? (["pos_sync_read_financial_basis",{p_org:body.sqlServerFinancialBasis.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_shift:body.sqlServerFinancialBasis.shiftId}] as const)
      : governanceBatch
      ? ([
          "pos_sync_push_governance_batch",
          {
            p_batch_id: body.sqlServerBatch!.batchId,
            p_organization_id: body.sqlServerBatch!.organizationId,
            p_branch_id: branchId,
            p_table: body.sqlServerBatch!.table,
            p_rows: body.sqlServerBatch!.rows,
          },
        ] as const)
      : body.sqlServerBatch
        ? ([
            "pos_sync_push_batch",
            {
              p_batch_id: body.sqlServerBatch.batchId,
              p_organization_id: body.sqlServerBatch.organizationId,
              p_branch_id: branchId,
              p_terminal_id: scope.terminalId ?? "",
              p_table: body.sqlServerBatch.table,
              p_rows: body.sqlServerBatch.rows,
              p_changes: body.sqlServerBatch.changes,
            },
          ] as const)
        : body.sqlServerAggregate?.shiftFinancialOpening
          ? (["pos_sync_register_financial_open",{p_batch:body.sqlServerAggregate.batchId,p_org:body.sqlServerAggregate.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_local_aggregate:verifiedFinancialOpening!.opening.localAggregateId,p_opening_json:verifiedFinancialOpening!.opening.rowJson,p_row_hash:verifiedFinancialOpening!.opening.rowHash,p_operations:body.sqlServerAggregate.operations,p_opening_envelope:body.sqlServerAggregate.shiftFinancialOpening.openingJson,p_proof:verifiedFinancialOpening!.proof}] as const)
        : body.sqlServerAggregate?.financialLedgerProjection
          ? (["pos_sync_push_financial_business_aggregate",{p_batch:body.sqlServerAggregate.batchId,p_org:body.sqlServerAggregate.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",p_operations:body.sqlServerAggregate.operations}] as const)
        : body.sqlServerAggregate?.stockSourceCohorts
          ? (["pos_sync_push_stock_source_aggregate",{p_batch_id:body.sqlServerAggregate.batchId,p_organization_id:body.sqlServerAggregate.organizationId,
            p_branch_id:branchId,p_terminal_id:scope.terminalId??"",p_operations:body.sqlServerAggregate.operations,
            p_project:new URL((await import("./external-supabase-config")).supabaseConfig().url).origin,
            p_cohorts:body.sqlServerAggregate.stockSourceCohorts}] as const)
        : body.sqlServerAggregate?.registerFinancialBoundary
          ? (["pos_sync_register_financial_boundary",{
            p_org:body.sqlServerAggregate.organizationId,p_branch:branchId,p_terminal:scope.terminalId??"",
            p_raw_graph:body.sqlServerAggregate.shiftIntent!.payloadJson,p_graph_author:body.sqlServerAggregate.shiftAuthor,
            p_financial_basis:body.sqlServerAggregate.shiftFinancialBasis,
          }] as const)
        : body.sqlServerAggregate
          ? ([
              body.sqlServerAggregate.shiftIntent ? (body.sqlServerAggregate.shiftFinancialBasis ? "pos_sync_push_financial_shift_intent" : body.sqlServerAggregate.shiftClosingStart ? "pos_sync_push_started_shift_intent" : "pos_sync_push_author_shift_intent") : "pos_sync_push_aggregate",
              {
                p_batch_id: body.sqlServerAggregate.batchId,
                p_organization_id: body.sqlServerAggregate.organizationId,
                p_branch_id: branchId,
                p_operations: body.sqlServerAggregate.shiftIntent ? null : body.sqlServerAggregate.operations,
                p_terminal_id: scope.terminalId ?? "",
                ...(body.sqlServerAggregate.shiftIntent ? { p_shift_intent: body.sqlServerAggregate.shiftIntent,
                  p_shift_author: body.sqlServerAggregate.shiftAuthor, p_author_authority: authorState } : {}),
                ...(body.sqlServerAggregate.shiftClosingStart ? { p_closing_start: body.sqlServerAggregate.shiftClosingStart, p_start_authority: startAuthorState } : {}),
                ...(body.sqlServerAggregate.shiftFinancialBasis ? {p_financial_basis:body.sqlServerAggregate.shiftFinancialBasis,
                  ...(body.sqlServerAggregate.shiftClosingStart?{}:{p_closing_start:null,p_start_authority:null})}:{}),
              },
            ] as const)
          : body.sqlServerShiftGraph
            ? (["pos_sync_shift_graph", {
                p_organization_id: body.sqlServerShiftGraph.organizationId, p_branch_id: branchId,
                p_terminal_id: scope.terminalId ?? "", p_shift_id: body.sqlServerShiftGraph.shiftId,
              }] as const)
          : body.sqlServerPull
            ? ([
                "pos_sync_pull",
                {
                  p_organization_id: body.sqlServerPull.organizationId,
                  p_branch_id: branchId,
                  p_terminal_id: scope.terminalId ?? "",
                  p_after_cursor: body.sqlServerPull.cursor,
                  p_limit: body.sqlServerPull.limit,
                },
              ] as const)
            : body.sqlServerBootstrap
              ? ([
                  "pos_sync_bootstrap",
                  {
                    p_organization_id: body.sqlServerBootstrap.organizationId,
                    p_branch_id: branchId,
                    p_terminal_id: scope.terminalId ?? "",
                    p_table: body.sqlServerBootstrap.table,
                    p_after_cursor: body.sqlServerBootstrap.cursor,
                    p_history_days: body.sqlServerBootstrap.historyDays,
                    // Bound audit JSON work before SQL generates its page and
                    // cursor. Older native clients already follow that cursor;
                    // never truncate an RPC response after it was calculated.
                    p_limit: body.sqlServerBootstrap.table === "change_history"
                      ? 10 : body.sqlServerBootstrap.limit,
                  },
                ] as const)
              : body.sqlServerCounts
                ? ([
                    "pos_sync_counts",
                    {
                      p_organization_id: body.sqlServerCounts.organizationId,
                      p_branch_id: branchId,
                      p_terminal_id: scope.terminalId ?? "",
                      p_history_days: body.sqlServerCounts.historyDays,
                    },
                  ] as const)
                : ([
                    "pos_old_receipt_lookup",
                    { p_lookup: body.oldReceipt!.lookup, p_branch_id: branchId },
                  ] as const);
    let protectedKeepCommerce: boolean | undefined;
    if (body.sqlServerBootstrap?.table === "change_history") {
      const { commerceSyncIsolationReady } = await import("./commerce-sync-readiness.server");
      protectedKeepCommerce = scope.managementReplica === true || scope.managementDevice === true || !(await commerceSyncIsolationReady());
      const { protectedHistoryDownload } = await import("./protected-history-download.server");
      const protectedResponse = await protectedHistoryDownload({ organizationId: body.sqlServerBootstrap.organizationId,
        branchId, terminalId: scope.terminalId ?? "", cursor: body.sqlServerBootstrap.cursor,
        historyDays: body.sqlServerBootstrap.historyDays, keepCommerce: protectedKeepCommerce, signal: request.signal });
      if (protectedResponse) return protectedResponse;
    }
    if (body.sqlServerPull) {
      const { commerceSyncIsolationReady } = await import("./commerce-sync-readiness.server");
      const keepCommerce = scope.managementReplica === true || scope.managementDevice === true || !(await commerceSyncIsolationReady());
      const { protectedFeedDownload } = await import("./protected-feed-download.server");
      const protectedResponse = await protectedFeedDownload({ organizationId: body.sqlServerPull.organizationId, branchId,
        terminalId: scope.terminalId ?? "", cursor: body.sqlServerPull.cursor, keepCommerce, signal: request.signal });
      if (protectedResponse) return protectedResponse;
    }
    let rpcBody: string;
    if (exactFinancialOperations) {
      const { stringifyExactJson } = await import("../../electron/sync/shift-recovery-exact.mjs");
      try { rpcBody = stringifyExactJson(rpc[1], { maxBytes: 8 * 1024 * 1024, maxDepth: 128 }); }
      catch { return Response.json({ ok: false, code: "FINANCIAL_OPERATIONS_INVALID", error: "The protected financial operations cannot be encoded safely." }, { status: 400 }); }
    } else rpcBody = JSON.stringify(rpc[1]);
    let response = await serviceRest(`rpc/${rpc[0]}`, {
      method: "POST",
      body: rpcBody,
    });
    if(rpc[0]==='pos_sync_push_stock_source_aggregate'){
      const {fallbackUnavailableStockSource}=await import('./stock-source-business-transport.server');
      response=await fallbackUnavailableStockSource(response,rpcBody,serviceRest);
    }
    if(response.ok&&body.sqlServerFinancialCapability){
      const {financialCapabilityResponse}=await import('./financial-capability.server');
      return financialCapabilityResponse(response,{organizationId:body.sqlServerFinancialCapability.organizationId,branchId,terminalId:scope.terminalId??'',shiftId:body.sqlServerFinancialCapability.shiftId});
    }
    if (response.ok && (body.sqlServerPull || body.sqlServerBootstrap || body.sqlServerShiftGraph)) {
      const { redactOwnedParsedSyncDownload } = await import("./sync-download-redaction");
      const management = scope.managementReplica === true || scope.managementDevice === true;
      const { commerceSyncIsolationReady } = await import("./commerce-sync-readiness.server");
      // Activate field exclusion only after its atomic database preservation guard is ready.
      const keepCommerce = protectedKeepCommerce ?? (management || !(await commerceSyncIsolationReady()));
      if (body.sqlServerShiftGraph) {
        const { exactShiftGraphDownload } = await import("./shift-graph-exact-download.server");
        return exactShiftGraphDownload(response, keepCommerce);
      }
      const download = await response.json();
      return Response.json(redactOwnedParsedSyncDownload(download, body.sqlServerBootstrap?.table ?? "", keepCommerce));
    }
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }

  const results: {
    ok: boolean;
    error?: string;
    code?: string;
    table?: string;
    kind?: string;
  }[] = [];
  const { batchInsertIds } = await import("@/core/api/relay-policy.server");
  const all = body.ops ?? [];
  // Only parents whose authorized write succeeded can prove child ownership.
  const batchIds = new Map<string, Set<string>>();
  for (const op of all) {
    try {
      const result =
        op.kind === "rpc"
          ? await (await import("@/core/api/pos-relay.server")).runRelayRpc(op, scope)
          : await runRelayOp(op, scope, batchIds);
      results.push({ ...result, table: op.table, kind: op.kind });
      if (result.ok && op.kind !== "rpc") {
        for (const [table, ids] of batchInsertIds([op])) {
          const accepted = batchIds.get(table) ?? new Set<string>();
          for (const id of ids) accepted.add(id);
          batchIds.set(table, accepted);
        }
      }
    } catch (e) {
      results.push({ ok: false, error: (e as Error).message, table: op.table, kind: op.kind });
    }
  }

  const refused = results.find(
    (r) =>
      r.code === "STORE_FORBIDDEN" ||
      r.code === "PERMISSION_DENIED" ||
      r.code === "SCOPE_MISSING" ||
      r.code === "SCOPE_STALE",
  );
  if (refused) {
    // One readable line per refusal so a live server shows why, without ever
    // logging a token, a key or the row contents.
    console.warn(`[sync] refused ${refused.kind} on ${refused.table}: ${refused.code}`);
  }
  return Response.json(
    {
      ok: results.every((r) => r.ok),
      results,
      ...(refused?.code
        ? {
            code: refused.code,
            error: refused.error,
            detail: {
              table: refused.table,
              kind: refused.kind,
              role: scope.roleSlug ?? scope.role ?? null,
              branch: scope.storeId ?? null,
              supervisor: scope.isSupervisor,
            },
          }
        : {}),
    },
    { status: refused ? 403 : 200 },
  );
}
