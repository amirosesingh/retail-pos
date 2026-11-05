const { normalizeSyncPayload } = require("./uuid-payload.cjs");
const { recordId } = require("./uuid-fields.cjs");
const {createHash}=require("node:crypto");
const {parseExactJson}=require("./shift-recovery-exact.cjs");
const {normalizeFinancialSourceEvidence,normalizePublishedThrough}=require("./financial-source-order.cjs");
const financialBasisWitnesses=new WeakMap();
const financialCapabilityWitnesses=new WeakMap();
const deepFreezeFinancial=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreezeFinancial(child);Object.freeze(value);}return value;};
const financialBasisFailure=()=>{throw Object.assign(new Error("The verified financial basis is unavailable or its source changed."),{code:"EFINANCIAL_BASIS_SOURCE_CHANGED",table:"shifts"});};
const financialBasisHash=value=>createHash("sha256").update(value,"utf8").digest("hex");
const { policy } = require("./conflicts.cjs");
const { toLocalValue } = require("./row-codec.cjs");
const { tagBootstrapDiagnostic } = require("../diagnostics.cjs");
const {boundedText,rememberGraph} = require("./shift-recovery-exact.cjs");
// Compare effective persisted assignments, not SQL's case/space-insensitive text
// equality or row versions alone. Unknown registry types retain the old update.
function changedAssignments(assignments, columns) {
  const source = [], target = [], failed = [];
  for (const assignment of assignments) {
    const match = /^target\.\[([^\]]+)\]=(.*)$/.exec(assignment);
    const type = String(columns.get(match?.[1])?.sqlServerType ?? "").toLowerCase();
    if (!match || !/^(?:nvarchar\((?:max|[1-9]\d*)\)|decimal\(\d+,\d+\)|datetimeoffset\([0-7]\)|date|bigint|int|smallint|bit|uniqueidentifier)$/.test(type)) return "";
    // Do not truncate bounded strings in the comparison: an oversized value
    // must still reach the existing assignment and fail rather than be hidden.
    const textual = /^nvarchar\(/.test(type);
    const effective = textual
      ? `CONVERT(nvarchar(max),${match[2]})` : `TRY_CONVERT(${type},${match[2]})`;
    // A failed conversion must attempt the original authorized assignment and
    // raise its normal error; it must never masquerade as an unchanged NULL.
    if (!textual) failed.push(`(${match[2]} IS NOT NULL AND ${effective} IS NULL)`);
    // Binary comparisons can pad trailing zero bytes. Length is part of the
    // identity too, including Unicode NUL characters and SQL NULL values.
    source.push(`DATALENGTH(${effective})`, `CONVERT(varbinary(max),${effective})`);
    target.push(`DATALENGTH(target.[${match[1]}])`, `CONVERT(varbinary(max),target.[${match[1]}])`);
  }
  return source.length ? ` AND (${[...failed, `EXISTS(SELECT ${source.join(",")} EXCEPT SELECT ${target.join(",")})`].join(" OR ")})` : "";
}
// Main-private transport evidence: body flags cannot authorize partial feed pages.
const feedContinuation = new WeakMap();
const legacyRecoveryResponses = new WeakMap();

function transportDiagnostic(error, payload, stage) {
  // Read data descriptors only: foreign errors must not run getters or leak
  // URL-bearing cause messages into private diagnostic breadcrumbs.
  const own = (object, key) => {
    try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
  };
  try {
    return {
      transportOperation: payload?.sqlServerPull ? "feed" : payload?.sqlServerBootstrap ? "bootstrap"
        : payload?.sqlServerShiftGraph ? "graph" : payload?.sqlServerCounts ? "count"
          : payload?.sqlServerBatch || payload?.sqlServerAggregate ? "upload" : "other",
      transportStage: stage,
      transportCode: own(error, "code") ?? own(own(error, "cause"), "code"),
      transportErrorName: own(error, "name") ?? (error instanceof TypeError ? "TypeError" : error instanceof Error ? "Error" : undefined),
    };
  } catch { return { transportStage: stage }; }
}

// Pending writes are guarded by the reader, not inferred from independent
// cloud/device counters. Closing graph rows also report the actual SQL outcome.
const SHIFT_GRAPH_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations",
  "shift_close_events", "shift_notifications", "shift_variance_alerts"]);
function comparable(column, value) {
  if (value == null) return null;
  const type = String(column.cloudType ?? "").toLowerCase();
  if (type === "uuid") return recordId(String(value));
  if (type === "boolean") return [true, 1, "1"].includes(value) ? true : [false, 0, "0"].includes(value) ? false : value;
  if (/^(timestamp|date|time)/.test(type)) {
    if (type === "date") return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const time = value instanceof Date ? value.valueOf() : Date.parse(String(value));
    return Number.isFinite(time) ? time : String(value);
  }
  if (/^(numeric|decimal|smallint|integer|bigint|real|double precision|money)/.test(type)) {
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    if (match && Math.abs(Number(match[4] ?? 0)) < 1000) {
      let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "") || "0";
      let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
      while (digits.endsWith("0") && digits !== "0") { digits = digits.slice(0, -1); exponent++; }
      return digits === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
    }
  }
  if (type === "jsonb" || type.endsWith("[]")) {
    const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
    try { return JSON.stringify(canonical(typeof value === "string" ? JSON.parse(value) : value)); } catch { return value; }
  }
  return value;
}
const DEVICE_COLUMN_ALLOWLIST = {
  app_users: new Set([
    "id", "user_id", "login_username", "full_name", "store_id", "role", "role_slug", "permissions",
    "is_active", "pin_hash", "offline_login_pin_hash", "pin_length", "pin_set_at", "pin_updated_by", "row_version",
    "email", "created_at", "updated_at", "deleted_at",
  ]),
  members: new Set([
    "id", "member_code", "full_name", "phone", "tier_id", "loyalty_points", "total_spent",
    "is_verified", "created_at", "updated_at", "deleted_at", "row_version",
    "membership_revision", "membership_status", "membership_member_id",
  ]),
};

// Configuration is edited from both hosted Web and offline-capable tills.
// Row versions can diverge when two writers start from the same snapshot, so
// they are only a deterministic tie-breaker. The actual last-write-wins clock
// is updated_at, matching the renderer's settings merge contract.
const CONFIGURATION_LWW_TABLES = new Set([
  "integration_settings",
  "pos_settings",
  "pos_store_settings",
  "settings_overrides",
  "settings_scoped",
]);

class CloudClient {
  constructor({ configStore, terminalStore, connectionManager = null, financialBasisContext = null }) {
    this.configStore = configStore;
    this.terminalStore = terminalStore;
    this.connectionManager = connectionManager;
    this.financialBasisContext=financialBasisContext;
    this.authorizationProof = null;
  }
  setAuthorizationProof(proof) {
    this.authorizationProof = proof && typeof proof === "object" ? { ...proof } : null;
  }
  clearAuthorizationProof() {
    this.authorizationProof = null;
  }
  hasAuthorizationProof() {
    return Boolean(this.authorizationProof && Object.values(this.authorizationProof).some(Boolean));
  }
  terminalId() {
    return String(this.terminalStore.read()?.tokenId ?? "").trim();
  }
  backendUrl() {
    const terminal = this.terminalStore.read() ?? {};
    return String(this.configStore.get("backendUrl") || terminal.backendUrl || "")
      .trim()
      .replace(/\/+$/, "");
  }
  async health({ timeoutMs = 8000 } = {}) {
    const base = this.backendUrl();
    if (!base || !/^https:\/\/.+/i.test(base))
      return { online: false, ready: false, code: "EBACKEND", error: "The hosted POS backend is not configured." };
    let response;
    try {
      response = await fetch(`${base}/api/public/sync-health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000)),
      });
    } catch (error) {
      return { online: false, ready: false, code: "EOFFLINE", error: String(error?.message ?? error) };
    }
    const data = await response.json().catch(() => null);
    const ready = response.ok && data?.serviceKey === true && data?.posUrl === true;
    return {
      online: true,
      ready,
      code: ready ? null : `HTTP_${response.status}`,
      error: ready ? null : data?.error ?? data?.message ?? "The hosted POS backend cannot reach the central database.",
    };
  }
  async request(payload, operation = "") {
    const terminal = this.terminalStore.read() ?? {};
    // An empty config-store value must not mask the HTTPS recovery copy sealed
    // with the terminal activation (nullish coalescing treats "" as present).
    const base = this.backendUrl();
    const terminalToken = String(terminal.tokenId ?? "").trim();
    if (!base)
      throw Object.assign(
        new Error(
          "The terminal is activated, but its hosted POS backend address has not been restored. Open Database & Cloud Connection and save the hosted POS address once.",
        ),
        { code: "EBACKEND" },
      );
    if (!/^https:\/\/.+/i.test(base))
      throw Object.assign(
        new Error(
          "The hosted POS backend must be a full HTTPS address. Open Database & Cloud Connection and save the POS website address again.",
        ),
        { code: "EBACKEND_HTTPS" },
      );
    if (!terminalToken)
      throw Object.assign(
        new Error(
          "The renderer activation has not reached the desktop synchronization service yet. Close and reopen Settings, then retry synchronization.",
        ),
        { code: "EACTIVATION_MIRROR" },
      );
    // The OS-sealed activation token is authoritative. Put it last so no
    // caller-supplied payload can replace the device identity or its branch.
    const governanceTables = new Set([
      "pos_settings",
      "pos_store_settings",
      "authorization_actions",
      "authorization_action_history",
    ]);
    const sharedPosField = (row) => String(row?.scope ?? "").toLowerCase() === "global" &&
      String(row?.scope_id ?? "") === "" && String(row?.key ?? "").startsWith("pos_field:");
    const hasSharedPosField = (operation) => operation?.table === "settings_scoped" &&
      ((operation.rows ?? []).some(sharedPosField) ||
        (operation.changes ?? []).some((change) => {
          if (sharedPosField(change?.key)) return true;
          try { return sharedPosField(JSON.parse(change?.entityId ?? change?.entity_id)); }
          catch { return false; }
        }));
    const governance =
      governanceTables.has(payload?.sqlServerBatch?.table) ||
      hasSharedPosField(payload?.sqlServerBatch) ||
      payload?.sqlServerAggregate?.operations?.some((operation) =>
        governanceTables.has(operation.table) || hasSharedPosField(operation),
      );
    const personProof = governance ? (this.authorizationProof ?? {}) : {};
    const suffix = operation ? `?operation=${encodeURIComponent(operation)}` : "";
    const outbound=normalizeSyncPayload(payload);
    // UUID cleanup is for ordinary rows, never for already-signed labels.
    // Raw JSON and proof objects remain exactly those captured by Main.
    if(payload?.sqlServerFinancialEvent)outbound.sqlServerFinancialEvent={...outbound.sqlServerFinancialEvent,operationJson:payload.sqlServerFinancialEvent.operationJson,proof:payload.sqlServerFinancialEvent.proof};
    if (payload?.sqlServerLegacyRecovery) outbound.sqlServerLegacyRecovery = {
      ...payload.sqlServerLegacyRecovery,
      payloadJson: payload.sqlServerLegacyRecovery.payloadJson,
      attestation: payload.sqlServerLegacyRecovery.attestation,
    };
    const financialAggregate=payload?.sqlServerAggregate;
    if(financialAggregate&&(financialAggregate.shiftFinancialBasis||financialAggregate.shiftFinancialOpening||financialAggregate.registerFinancialBoundary===true)){
      for(const key of['shiftAuthor','shiftClosingStart','shiftFinancialBasis','shiftFinancialOpening'])if(financialAggregate[key]!==undefined)outbound.sqlServerAggregate[key]=financialAggregate[key];
    }
    let response;
    let data;
    let bodyReadError;
    let nonJsonResponse = false;
    let exactGraphBody;
    let legacyRecoveryBody;
    let transportStage = "fetch";
    const requestBody = JSON.stringify({ ...outbound, ...personProof, terminalToken: recordId(terminalToken), deviceBindingProof:terminal.deviceBindingProof, ...(terminal.deviceUse === "management" ? { deviceClaimProof: terminal.deviceClaimProof } : {}) });
    if (payload?.sqlServerLegacyRecovery && Buffer.byteLength(requestBody, "utf8") > require("../security/legacy-shift-recovery-protocol.cjs").MAX_UPLOAD_BYTES)
      throw Object.assign(new Error("The reviewed closing exceeds the bounded recovery upload. Its saved evidence remains available for review."), { code:"ELEGACY_RECOVERY_OVERSIZED", table:"shifts" });
    try { response = await fetch(`${base}/api/v1/pos/sync${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(payload?.sqlServerLegacyRecovery ? { "x-pos-legacy-recovery": "1" } : {}) },
      body: requestBody,
      signal: AbortSignal.timeout(30_000),
    });
      transportStage = "body";
      try {
        if (payload?.sqlServerLegacyRecovery && response.ok) {
          legacyRecoveryBody = await boundedText(response, require("./legacy-shift-recovery-receipt.cjs").MAX_RESPONSE_BYTES);
          data = JSON.parse(legacyRecoveryBody);
        } else if(payload?.sqlServerShiftGraph && response.ok && typeof response.text==="function"){
          exactGraphBody=await boundedText(response);
          data=JSON.parse(exactGraphBody);
        }else data = await response.json();
      } catch (error) {
        // A body can time out after fetch has delivered successful headers.
        // Preserve transport failures instead of inventing an HTTP 200 error.
        // A known HTTP refusal still wins when its body cannot be read.
        if (response.ok && error?.name !== "SyntaxError") throw error;
        bodyReadError = error;
        nonJsonResponse = error?.name === "SyntaxError";
        data = { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const timeoutName = error?.name;
      if (["TimeoutError","AbortError"].includes(timeoutName)) {
        throw tagBootstrapDiagnostic(Object.assign(new Error("Cloud synchronization timed out. Local changes remain pending; the next sync will safely retry the same upload."),
          {code:"ETIMEDOUT",cause:error}), { ...transportDiagnostic(error, payload, transportStage), transportErrorName: timeoutName });
      }
      throw tagBootstrapDiagnostic(error, transportDiagnostic(error, payload, transportStage));
    }
    if (!response.ok || data?.ok === false) {
      // PostgREST reports raised SQL errors in `message`, while the POS relay
      // uses `error`. Preserve both so diagnostics show SYNC_BRANCH_FORBIDDEN
      // instead of an unhelpful generic HTTP 400.
      const message = data?.error ?? data?.message ?? `HTTP ${response.status}`;
      throw tagBootstrapDiagnostic(Object.assign(new Error(message), {
        code: data?.code ?? `HTTP_${response.status}`,
        status: response.status,
        detail: data?.details ?? data?.detail ?? null,
        ...(bodyReadError ? { cause: bodyReadError } : {}),
      }), { httpStatus: response.status, nonJsonResponse });
    }
    const normalized=normalizeSyncPayload(data);
    if (legacyRecoveryBody !== undefined && normalized && typeof normalized === "object")
      legacyRecoveryResponses.set(normalized, legacyRecoveryBody);
    if (payload?.sqlServerPull) {
      const projection = response.headers?.get?.("X-POS-Feed-Projection") ?? null;
      const continuation = response.headers?.get?.("X-POS-Feed-Continue") ?? null;
      if (projection !== null || continuation !== null) {
        if (projection !== "1" || !["0", "1"].includes(continuation) || !Array.isArray(normalized) ||
            (continuation === "1" && normalized.length === 0))
          throw Object.assign(new Error("The cloud feed continuation response is invalid. Its page remains pending."), {code:"EFEED_PROTOCOL"});
        feedContinuation.set(normalized, continuation === "1");
      }
    }
    return exactGraphBody===undefined?normalized:rememberGraph(normalized,exactGraphBody,response.headers?.get?.("X-POS-Shift-Graph-Exact"));
  }
  managementBranches() { return this.request({ managementSyncBranches: true }); }
  pushBatch(batch) {
    return this.request({
      sqlServerBatch: {
        batchId: batch.batchId,
        organizationId: batch.organizationId ?? "default",
        branchId: batch.branchId,
        table: batch.table,
        rows: batch.rows,
        changes: batch.changes,
      },
    });
  }
  financialBasisIdentity(branchId,shiftId){
    if(typeof this.financialBasisContext!=="function"||!this.connectionManager?.pool||!this.connectionManager.profile)financialBasisFailure();
    const context=this.financialBasisContext(),terminal=this.terminalStore.read()??{},profile=this.connectionManager.profile;
    if(context?.branchId!==branchId||typeof context.projectOrigin!=="string"||!/^https:\/\//.test(context.projectOrigin)||!branchId||typeof shiftId!=="string"||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(shiftId)||!this.terminalId()||this.connectionManager.pool.__posConnectionFaulted)financialBasisFailure();
    let project;try{const url=new URL(context.projectOrigin);project=url.origin;if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))financialBasisFailure();}catch{financialBasisFailure();}
    const selectors=Object.fromEntries(['id','host','instanceName','port','database','authMode','username','encrypt','trustServerCertificate'].map(key=>[key,profile[key]]));
    const identity={branchId,shiftId,terminalId:this.terminalId(),projectOrigin:project,backend:this.backendUrl(),profile:financialBasisHash(JSON.stringify(selectors)),activation:financialBasisHash(JSON.stringify({id:terminal.tokenId,branch:terminal.branchId,mode:terminal.deviceUse,proof:terminal.deviceBindingProof,claim:terminal.deviceClaimProof}))};
    if(!/^https:\/\//.test(identity.backend))financialBasisFailure();
    return{identity,pool:this.connectionManager.pool,manager:this.connectionManager};
  }
  async financialCapabilityIdentity(branchId,shiftId=null){
    const source=this.financialBasisIdentity(branchId,shiftId??'00000000-0000-0000-0000-000000000000');
    const database=(await source.pool.request().query("SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset??[];
    if(database.length!==1||typeof database[0].database_guid!=="string"||! /^[a-f0-9-]{36}$/.test(database[0].database_guid))financialBasisFailure();
    const identity={...source.identity,databaseGuid:database[0].database_guid};delete identity.shiftId;
    const assertSource=()=>{const current=this.financialBasisIdentity(branchId,shiftId??'00000000-0000-0000-0000-000000000000');if(current.pool!==source.pool||current.manager!==source.manager||JSON.stringify(current.identity)!==JSON.stringify(source.identity))financialBasisFailure();};
    assertSource();return{identity:Object.freeze(identity),pool:source.pool,manager:source.manager,assertSource};
  }
  async readFinancialCapability({organizationId="default",branchId,shiftId=null}){
    const source=await this.financialCapabilityIdentity(branchId,shiftId),scope={organizationId,branchId,shiftId,terminalId:source.identity.terminalId,projectOrigin:source.identity.projectOrigin};
    const response=await this.shiftProtocolRequest({sqlServerFinancialCapability:{organizationId,branchId,...(shiftId===null?{}:{shiftId})}});source.assertSource();
    const value=require('./financial-capability.cjs').normalizeFinancialCapability(response,scope),token=Object.freeze({});
    financialCapabilityWitnesses.set(token,{...source,value,scope});return token;
  }
  async readFinancialBasis({organizationId="default",branchId,shiftId}){
    const source=this.financialBasisIdentity(branchId,shiftId);
    const database=(await source.pool.request().query("SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset??[];
    if(database.length!==1||typeof database[0].database_guid!=="string"||! /^[a-f0-9-]{36}$/.test(database[0].database_guid))financialBasisFailure();
    const assertSource=()=>{const current=this.financialBasisIdentity(branchId,shiftId);if(current.pool!==source.pool||current.manager!==source.manager||JSON.stringify(current.identity)!==JSON.stringify(source.identity))financialBasisFailure();};
    assertSource();
    const result=await this.shiftProtocolRequest({sqlServerFinancialBasis:{organizationId,branchId,shiftId}});assertSource();
    if(!result||typeof result.basisId!=="string"||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.basisId)||typeof result.basisHash!=="string"||! /^[a-f0-9]{64}$/.test(result.basisHash)||typeof result.basisJson!=="string"||Buffer.byteLength(result.basisJson,'utf8')>6*1024*1024||financialBasisHash(result.basisJson)!==result.basisHash)financialBasisFailure();
    let basis;try{basis=parseExactJson(result.basisJson,{maxBytes:6*1024*1024,maxDepth:64});}catch{financialBasisFailure();}
    if(basis.branchId!==branchId||basis.shiftId!==shiftId||!basis.parentSnapshot||typeof basis.parentSnapshot!=="object")financialBasisFailure();
    const sourceEvidence=normalizeFinancialSourceEvidence(result.sourceEvidence),ownPublishedThrough=normalizePublishedThrough(result.ownPublishedThrough);
    const token=Object.freeze({});
    financialBasisWitnesses.set(token,{assertSource,...source,value:Object.freeze({serverBasisId:result.basisId,serverBasisHash:result.basisHash,basisJson:result.basisJson,parentSnapshot:deepFreezeFinancial(basis.parentSnapshot),branchId,shiftId,terminalId:source.identity.terminalId,projectOrigin:source.identity.projectOrigin,databaseGuid:database[0].database_guid,sourceEvidence,ownPublishedThrough,purpose:'financial_basis_read'})});
    return token;
  }
  pushFinancialEvent({organizationId="default",branchId,operationJson,proof}) {
    return this.shiftProtocolRequest({sqlServerFinancialEvent:{organizationId,branchId,operationJson,proof}});
  }
  pushFinancialObservation({organizationId="default",branchId,operationJson}) {
    return this.shiftProtocolRequest({sqlServerFinancialObservation:{organizationId,branchId,operationJson}});
  }
  registerFinancialBoundary(batch) { return this.pushAggregate({...batch,registerFinancialBoundary:true}); }
  pushAggregate(batch) {
    if((batch.registerFinancialBoundary!==undefined && (batch.registerFinancialBoundary!==true||!batch.shiftIntent||!batch.shiftFinancialBasis))||
      (batch.financialLedgerProjection!==undefined&&(batch.financialLedgerProjection!==true||batch.shiftIntent))||
      (batch.shiftFinancialOpening!==undefined&&(!batch.shiftFinancialOpening||batch.shiftIntent||typeof batch.shiftFinancialOpening.openingJson!=="string"||!batch.shiftFinancialOpening.proof)))
      throw Object.assign(new Error("The protected financial upload is incomplete."),{code:"EFINANCIAL_HISTORY_INVALID",table:"shifts"});
    const missingFinancialProof = batch.financialRequired === true && batch.shiftFinancialBasis == null;
    if (missingFinancialProof || batch.shiftFinancialBasis === null || (batch.shiftFinancialBasis !== undefined && !batch.shiftIntent))
      throw Object.assign(new Error("The saved shift financial proof is required before upload."), {code:missingFinancialProof?"ESHIFT_FINANCIAL_PROOF_REQUIRED":"ESHIFT_FINANCIAL_PROOF_INVALID",table:"shifts"});
    const payload = {
      sqlServerAggregate: {
        batchId: batch.batchId,
        organizationId: batch.organizationId ?? "default",
        branchId: batch.branchId,
        ...(batch.shiftIntent ? {shiftIntent:batch.shiftIntent} : {operations:batch.operations}),
        ...(batch.shiftAuthor ? {shiftAuthor:batch.shiftAuthor} : {}),
        ...(batch.shiftClosingStart ? {shiftClosingStart:batch.shiftClosingStart} : {}),
        ...(batch.shiftFinancialBasis !== undefined ? {shiftFinancialBasis:batch.shiftFinancialBasis} : {}),
        ...(batch.registerFinancialBoundary===true?{registerFinancialBoundary:true}:{}),
        ...(batch.financialLedgerProjection===true?{financialLedgerProjection:true}:{}),
        ...(batch.shiftFinancialOpening!==undefined?{shiftFinancialOpening:{openingJson:batch.shiftFinancialOpening.openingJson,proof:batch.shiftFinancialOpening.proof}}:{}),
      },
    };
    return batch.shiftIntent ? this.shiftProtocolRequest(payload) : this.request(payload);
  }
  shiftGraph({organizationId="default",branchId,shiftId}) {
    return this.shiftProtocolRequest({sqlServerShiftGraph:{organizationId,branchId,shiftId}});
  }
  async pushLegacyRecovery(event) {
    const source = this.financialBasisIdentity(event.branchId, event.shiftId);
    const assertCurrent = () => {
      const current = this.financialBasisIdentity(event.branchId, event.shiftId);
      if (current.pool !== source.pool || current.manager !== source.manager ||
          JSON.stringify(current.identity) !== JSON.stringify(source.identity)) financialBasisFailure();
    };
    const { normalizeLegacyPayload, normalizeLegacyRecovery } = require("../security/legacy-shift-recovery-protocol.cjs");
    const payload = normalizeLegacyPayload(JSON.parse(event.payloadJson)), proof = normalizeLegacyRecovery(event.proof);
    if (financialBasisHash(event.payloadJson) !== event.payloadHash || proof.payloadHash !== event.payloadHash ||
        payload.branchId !== source.identity.branchId || proof.terminalId !== source.identity.terminalId ||
        proof.projectOrigin !== source.identity.projectOrigin) financialBasisFailure();
    assertCurrent();
    const result = await this.shiftProtocolRequest({ sqlServerLegacyRecovery: {
      organizationId: "default", branchId: event.branchId, payloadJson: event.payloadJson, attestation: proof,
    } });
    assertCurrent();
    const { rememberLegacyRecoveryReceipt } = require("./legacy-shift-recovery-receipt.cjs");
    return rememberLegacyRecoveryReceipt({ event, raw: legacyRecoveryResponses.get(result),
      registry: require("../db/schema-registry.cjs").loadRegistry(), assertCurrent });
  }
  async shiftProtocolRequest(payload) {
    try{return await this.request(payload);}
    catch(error){
      if(["PGRST202","42883"].includes(error?.code) || Number(error?.status)===404)
        throw Object.assign(new Error("The configured backend has not installed the closing-convergence protocol. Saved local work remains pending; ask an administrator to review the matching backend upgrade."),{code:"ESHIFT_PROTOCOL_UNAVAILABLE",table:"shifts",cause:error});
      throw error;
    }
  }
  pullBatch({ organizationId = "default", branchId, cursor, limit }) {
    return this.request({
      sqlServerPull: { organizationId, branchId, cursor: Number(cursor ?? 0), limit },
    }).then((rows) => {
      const list = Array.isArray(rows) ? rows : [];
      if (feedContinuation.has(list) && list.length) {
        let previous = Number(cursor ?? 0);
        if (!Number.isSafeInteger(previous) || list.some(change => {
          const next = Number(change.cursor);
          const invalid = !Number.isSafeInteger(next) || next <= previous;
          previous = next;
          return invalid;
        })) throw Object.assign(new Error("The protected cloud feed cursor did not advance safely. Its page remains pending."), {code:"ESYNC_CURSOR"});
      }
      return {
        rows: list.filter((row) => !row.tombstone),
        tombstones: list.filter((row) => row.tombstone),
        cursor: list.length ? list.at(-1).cursor : cursor,
        count: list.length,
        ...(feedContinuation.has(list) ? {continuation:feedContinuation.get(list)} : {}),
      };
    });
  }
  bootstrapPage({ organizationId = "default", table, branchId, historyDays, cursor, limit }) {
    return this.request({
      sqlServerBootstrap: {
        organizationId,
        table,
        branchId,
        historyDays,
        cursor: cursor ?? null,
        limit,
      },
    });
  }
  counts({ organizationId = "default", branchId, historyDays = 90 }) {
    return this.request({ sqlServerCounts: { organizationId, branchId, historyDays } });
  }
  membershipDirectory({ afterRevision = 0, limit = 500 } = {}) {
    return this.request({ afterRevision:Number(afterRevision)||0, limit }, "membership_directory");
  }
  oldReceipt(lookup, branchId, proof = {}) {
    return this.request({ ...proof, oldReceipt: { lookup, branchId } });
  }
  parseKey(table, change) {
    if (change.row_data) return change.row_data;
    try {
      return JSON.parse(change.entity_id);
    } catch {
      return { id: change.entity_id };
    }
  }
  async applyLocalBatch(transaction, table, batch) {
    const sql = this.connectionManager?.sql?.() ?? require("mssql/msnodesqlv8");
    const allowed = new Map((table.columns ?? []).map((column) => [column.cloudColumn, column]));
    const localColumns = new Map((table.columns ?? []).map(column => [column.sqlServerColumn, column]));
    const primary = table.columns
      .filter((column) => column.primaryKey)
      .map((column) => column.sqlServerColumn);
    if (!primary.length)
      throw new Error(`No primary key is registered for ${table.sqlServerTable}.`);
    const protectedGraph = SHIFT_GRAPH_TABLES.has(table.cloudTable);
    const result = { applied: 0, alreadyMatching: 0, deferred: 0, conflicts: 0, outcomes: [] };
    const outcome = (change, status, reason, localVersion) => {
      if (!protectedGraph) return;
      result[status === "already_matching" ? "alreadyMatching" : status === "conflict" ? "conflicts" : status]++;
      result.outcomes.push({ entityId: change.entity_id ?? JSON.stringify(this.parseKey(table, change)), status,
        ...(reason ? { reason } : {}), localVersion: localVersion ?? null, remoteVersion: change.row_data?.row_version ?? null });
    };
    for (const change of [...(batch.rows ?? []), ...(batch.tombstones ?? [])]) {
      const row = change.row_data ?? {};
      const key = this.parseKey(table, change);
      if (change.tombstone) {
        const request = new sql.Request(transaction);
        const where = primary
          .map((name, index) => {
            request.input(`k${index}`, key[name]);
            return `[${name}]=@k${index}`;
          })
          .join(" AND ");
        const deleted = await request.query(
          `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.[${table.sqlServerTable}] WHERE ${where};`,
        );
        outcome(change, (deleted.rowsAffected?.[0] ?? 0) > 0 ? "applied" : "already_matching");
        continue;
      }
      const deviceColumns = DEVICE_COLUMN_ALLOWLIST[table.cloudTable];
      const deviceRow = table.cloudTable === "app_users"
        ? {
            ...row,
            // Staff email is not needed by the till, but the compatibility
            // SQL schema requires a non-null value. Keep PII out of the device
            // while allowing a fresh bootstrap to complete reliably.
            email: `${String(row.user_id ?? row.id ?? "staff").replace(/[^a-z0-9._-]/gi, "_")}@terminal.invalid`,
          }
        : row;
      const entries = Object.entries(deviceRow)
        .filter(([name]) => allowed.has(name) && (!deviceColumns || deviceColumns.has(name)))
        .map(([name, value]) => {
          const column = allowed.get(name);
          return [column.sqlServerColumn, toLocalValue(column, value)];
        });
      if (!entries.length || primary.some((name) => !entries.some(([column]) => column === name))) {
        outcome(change, "conflict", "The cloud row has no complete registered primary key.");
        continue;
      }
      // user_roles is uniquely identified by the role assignment itself. Old
      // installs can hold the same (user_id, role) under a different generated
      // UUID; matching only the UUID makes a replay violate UQ_user_roles_0.
      // Pull is authoritative, so update that harmless local UUID to the cloud
      // UUID while preserving one assignment row.
      const mergeKey = table.cloudTable === "user_roles" ? ["user_id", "role"] : primary;
      if (mergeKey.some((name) => !entries.some(([column]) => column === name))) {
        outcome(change, "conflict", "The cloud row has no complete registered merge key."); continue;
      }
      const request = new sql.Request(transaction);
      const names = [];
      entries.forEach(([name, value], index) => {
        const parameter = `v${index}`;
        request.input(parameter, value);
        names.push([name, parameter]);
      });
      if (protectedGraph) {
        const branch = recordId(String(batch.branchId ?? "").trim());
        const scope = recordId(String(deviceRow.store_id ?? "").trim());
        if (!branch || scope !== branch) {
          outcome(change, "conflict", "The closing row does not match the verified download branch."); continue;
        }
        const where = primary.map(name => `[${name}]=@${names.find(([column]) => column === name)[1]}`).join(" AND ");
        const prior = await request.query(`SELECT TOP (1) * FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK) WHERE ${where};`);
        const saved = prior.recordset?.[0];
        if (saved) {
          if (recordId(String(saved.store_id ?? "")) !== branch || (table.cloudTable !== "shifts" &&
              recordId(String(saved.shift_id ?? "")) !== recordId(String(deviceRow.shift_id ?? "")))) {
            outcome(change, "conflict", "The saved closing row belongs to another branch or shift.", saved.row_version); continue;
          }
          const matching = entries.every(([name, value]) => name === "row_version" ||
            comparable(localColumns.get(name), saved[name]) === comparable(localColumns.get(name), value));
          if (matching) { outcome(change, "already_matching", null, saved.row_version); continue; }
          const closed = value => value.status === "CLOSED" || value.state === "CLOSED" || value.closed_at != null;
          if ((table.cloudTable !== "shifts" && (table.conflictRule ?? policy(table.cloudTable)) === "immutable_reversal") ||
              (table.cloudTable === "shifts" && closed(saved) && !closed(deviceRow))) {
            outcome(change, "conflict", table.cloudTable === "shifts"
              ? "A cloud opening cannot replace a saved closing. Resolve the accepted closing revision before retrying."
              : "Saved closing history differs from the cloud row. Resolve the immutable record before retrying.", saved.row_version); continue;
          }
          if (Number(saved.row_version) > Number(deviceRow.row_version)) {
            outcome(change, "deferred", "The cloud closing/update was not applied: independent revisions require an authoritative graph and correction revision.", saved.row_version); continue;
          }
        }
      }
      const on = mergeKey.map((name) => `target.[${name}]=source.[${name}]`).join(" AND ");
      const updates = names
        .filter(([name]) => !mergeKey.includes(name))
        .map(([name]) => `target.[${name}]=source.[${name}]`);
      const versioned = names.some(([name]) => name === "row_version");
      const timestampedConfiguration =
        CONFIGURATION_LWW_TABLES.has(table.cloudTable) &&
        names.some(([name]) => name === "updated_at");
      const conflictPolicy = table.conflictRule ?? policy(table.cloudTable);
      const correction =
        table.cloudTable === "sales" && names.some(([name]) => name === "is_refunded")
          ? "target.[is_refunded]=CASE WHEN target.[is_refunded]=1 OR source.[is_refunded]=1 THEN 1 ELSE 0 END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
          : table.cloudTable === "sale_items" && names.some(([name]) => name === "refunded_qty")
            ? "target.[refunded_qty]=CASE WHEN source.[refunded_qty]>target.[refunded_qty] THEN source.[refunded_qty] ELSE target.[refunded_qty] END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
            : null;
      const mayUpdate = conflictPolicy !== "immutable_reversal" && updates.length;
      const cloudWinsEqual = conflictPolicy === "highest_version" || conflictPolicy === "scoped_version";
      const authorizationOrder = timestampedConfiguration
        ? versioned
          ? " AND (target.[updated_at] IS NULL OR source.[updated_at]>target.[updated_at] OR (source.[updated_at]=target.[updated_at] AND source.[row_version]>=target.[row_version]))"
          : " AND (target.[updated_at] IS NULL OR source.[updated_at]>=target.[updated_at])"
        : versioned
          ? ` AND source.[row_version]${cloudWinsEqual ? ">=" : ">"}target.[row_version]`
          : "";
      // Only authoritative cloud corrections may amend posted receipt fields.
      // Terminal uploads still obey the immutable sale/refund contract.
      const correctedReceipt = correction && versioned && names.some(([name]) => name === "corrected_at") && deviceRow.corrected_at;
      const correctionAllowed = `source.[corrected_at] IS NOT NULL AND source.[row_version]>target.[row_version] AND ${table.cloudTable === "sales" ? "COALESCE(target.[is_refunded],0)=0 AND COALESCE(source.[is_refunded],0)=0" : "COALESCE(target.[refunded_qty],0)=0 AND COALESCE(source.[refunded_qty],0)=0"}`;
      const correctedAssignments = correctedReceipt ? names.filter(([name]) => !mergeKey.includes(name)).map(([name]) => {
        const fallback = name === "row_version" ? "CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
          : name === "is_refunded" ? "CASE WHEN target.[is_refunded]=1 OR source.[is_refunded]=1 THEN 1 ELSE 0 END"
          : name === "refunded_qty" ? "CASE WHEN source.[refunded_qty]>target.[refunded_qty] THEN source.[refunded_qty] ELSE target.[refunded_qty] END" : `target.[${name}]`;
        return `target.[${name}]=CASE WHEN ${correctionAllowed} THEN source.[${name}] ELSE ${fallback} END`;
      }) : null;
      const correctedUpdates = correctedAssignments?.join(",") ?? null;
      const effectiveAssignments = correctedAssignments ?? (correction ? correction.split(",") : updates);
      const changed = protectedGraph ? "" : changedAssignments(effectiveAssignments, localColumns);
      const matched = correction
        ? `WHEN MATCHED${changed} THEN UPDATE SET ${correctedUpdates ?? correction}`
        : mayUpdate
          ? `WHEN MATCHED${authorizationOrder}${changed} THEN UPDATE SET ${updates.join(",")}`
          : "";
      const source = names.map(([name, parameter]) => `@${parameter} AS [${name}]`).join(",");
      // OUTPUT INTO also works when an installed schema has DML triggers.
      const capture = protectedGraph ? "DECLARE @sync_actions TABLE(sync_action nvarchar(10)); " : "";
      const output = protectedGraph ? " OUTPUT $action INTO @sync_actions; SELECT sync_action FROM @sync_actions;" : ";";
      const merged = await request.query(
        `${capture}WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) AS target USING(SELECT ${source}) AS source ON ${on} ${matched} WHEN NOT MATCHED THEN INSERT(${names.map(([name]) => `[${name}]`).join(",")}) VALUES(${names.map(([name]) => `source.[${name}]`).join(",")})${output}`,
      );
      const applied = (merged.recordset?.length ?? merged.rowsAffected?.[0] ?? 0) > 0;
      let confirmed = true;
      if (protectedGraph) {
        const where = primary.map(name => `[${name}]=@${names.find(([column]) => column === name)[1]}`).join(" AND ");
        const saved = (await request.query(`SELECT TOP (1) * FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK) WHERE ${where};`)).recordset?.[0];
        confirmed = saved && entries.every(([name, value]) => name === "row_version" ||
          comparable(localColumns.get(name), saved[name]) === comparable(localColumns.get(name), value));
      }
      outcome(change, applied && confirmed ? "applied" : "deferred", applied && confirmed ? null : "The registered merge policy did not confirm this cloud row locally.");
      // A newer default-row timestamp must not mask cloud company identity.
      // Repair only empty fields; genuine pending edits are protected by the
      // snapshot/pull journal guard before this merge is called.
      const idParameter = names.find(([name]) => name === "id")?.[1];
      if (table.cloudTable === "pos_settings" && idParameter) {
        for (const field of ["company_name","logo_data_url","tax_number","reg_number","phone","website","header_text","footer_text"]) {
          const parameter = names.find(([name]) => name === field)?.[1];
          if (!parameter || typeof deviceRow[field] !== "string" || !deviceRow[field].trim()) continue;
          await request.query(
            `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) UPDATE dbo.[pos_settings] SET [${field}]=@${parameter} WHERE [id]=@${idParameter} AND NULLIF(LTRIM(RTRIM([${field}])),N'') IS NULL;`,
          );
        }
      }
    }
    return protectedGraph ? result : undefined;
  }
  async applyLocalBatchToPool(connectionManager, table, rows, { branchId } = {}) {
    this.connectionManager = connectionManager;
    const sql = connectionManager.sql();
    const transaction = new sql.Transaction(connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      if (SHIFT_GRAPH_TABLES.has(table.cloudTable)) {
        const { ChangeReader } = require("./change-reader.cjs");
        const { loadRegistry } = require("../db/schema-registry.cjs");
        const reader = new ChangeReader(connectionManager, loadRegistry());
        const pending = await reader.unacknowledged(table, rows.map(row => row.entity_id ?? JSON.stringify(this.parseKey(table, row))), transaction, { branchId, changes: rows });
        if (pending.size) throw Object.assign(new Error("Cloud download is waiting for pending or unverified local closing changes."), { code: "ELOCAL_UPLOAD_PENDING", table: table.cloudTable });
      }
      const result = await this.applyLocalBatch(transaction, table, { rows, tombstones: [], branchId });
      if (SHIFT_GRAPH_TABLES.has(table.cloudTable) && (result.deferred || result.conflicts))
        throw Object.assign(new Error(result.outcomes.find(item => ["deferred", "conflict"].includes(item.status))?.reason), {
          code: result.conflicts ? "ESYNC_APPLY_CONFLICT" : "ESYNC_APPLY_DEFERRED", table: table.cloudTable, outcomes: result.outcomes,
        });
      await transaction.commit();
      return result;
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
}
function readVerifiedFinancialBasis(token,expected){
  const saved=financialBasisWitnesses.get(token);if(!saved||!expected||expected.connectionManager!==saved.manager||expected.branchId!==saved.value.branchId||expected.shiftId!==saved.value.shiftId||expected.terminalId!==saved.value.terminalId||(expected.projectOrigin!==undefined&&expected.projectOrigin!==saved.value.projectOrigin))financialBasisFailure();
  saved.assertSource();return saved.value;
}
function readVerifiedFinancialCapability(token,expected){
  const saved=financialCapabilityWitnesses.get(token);if(!saved||!expected||saved.manager!==expected.connectionManager||saved.scope.branchId!==expected.branchId||saved.scope.shiftId!==(expected.shiftId??null)||saved.scope.terminalId!==expected.terminalId||saved.scope.projectOrigin!==expected.projectOrigin)financialBasisFailure();
  saved.assertSource();return Object.freeze({descriptor:saved.value,binding:saved.identity});
}
module.exports = { CloudClient,readVerifiedFinancialBasis,readVerifiedFinancialCapability };
