import { createRequire } from "node:module";
import {generateKeyPairSync,sign,createHash} from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { AggregateRepository } = require("../../../electron/db/repositories/aggregates.cjs");
const { ShiftSyncJournal } = require("../../../electron/db/shift-sync-journal.cjs");
const { ChangeReader } = require("../../../electron/sync/change-reader.cjs");
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { toCloudRow } = require("../../../electron/sync/row-codec.cjs");
const {matchingCoverage}=require("../../../scripts/lib/shift-coverage-fixture.cjs");
type Row = Record<string, unknown>;
type State = { tables: Record<string, Row[]>; journal: Row[]; receipts: Row[]; intents: Row[]; baselines: Row[];openings:Row[];authors:Row[]; closingStarts:Row[]; intentStarts:Row[] };
type Operation = { kind: string; table: string; rows?: Row[]; values?: Row; match?: Row };
const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shiftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const terminal = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherTerminal = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const uuid = (index: number) => `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
const now = "2026-11-01T02:00:00.000Z";
const copy = <T>(value: T): T => structuredClone(value);
const sameId = (left: unknown, right: unknown) => String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

function fixture(options: { branch?: string; terminal?: string | null } = {}) {
  const ownBranch = options.branch ?? branch;
  const registry = loadRegistry();
  let state: State = { tables: Object.fromEntries(registry.tables.map((table: { sqlServerTable: string }) => [table.sqlServerTable, []])), journal: [], receipts: [], intents:[],baselines:[],openings:[],authors:[],closingStarts:[],intentStarts:[] };
  state.tables.shifts.push({ id: shiftId, store_id: ownBranch, terminal_id: options.terminal === undefined ? terminal : options.terminal,
    status: "OPEN", state: "CASH_COUNT_REQUIRED", closed_at: null, row_version: 2, opening_float: 20 });
  // Synthetic financial inputs underlying the fixture's 100/20/10 expectations.
  state.tables.sales.push(...[["cash",80],["card",20],["wallet",10]].map(([method,total],index)=>({
    id:uuid(900+index),store_id:ownBranch,shift_id:shiftId,payment_type:method,total_amount:total,is_refunded:false,
  })));
  const events: string[] = [];
  const faults: { journal?: Error; receipt?: Error; business?: Error; transform?: (table: string, rows: Row[]) => Row[] } = {};
  class Transaction {
    image!: State;
    async begin() { this.image = copy(state); events.push("begin"); }
    async commit() { state = copy(this.image); events.push("commit"); }
    async rollback() { events.push("rollback"); }
  }
  class Request {
    inputs: Row = {};
    constructor(readonly transaction: Transaction) {}
    input(name: string, value: unknown, typedValue?: unknown) { this.inputs[name] = arguments.length === 3 ? typedValue : value; return this; }
    async query(query: string) {
      const data = this.transaction.image;
      if (query.includes("COUNT(s.id) transactions")) {
        const sales=data.tables.sales.filter(row=>sameId(row.store_id,this.inputs.branch)&&sameId(row.shift_id,this.inputs.shift)&&!row.is_refunded);
        const sum=(method:string)=>sales.filter(row=>row.payment_type===method).reduce((total,row)=>total+Number(row.total_amount),0);
        return {recordset:[{expected_cash:Number(data.tables.shifts[0].opening_float)+sum("cash"),expected_card:sum("card"),expected_digital:sum("wallet")}]};
      }
      if(query.startsWith("INSERT dbo.pos_sync_shift_intent_starts")){data.intentStarts.push({intent_id:this.inputs.intent,proof_json:this.inputs.proof});return{recordset:[],rowsAffected:[1]};}
      if(query.startsWith("SELECT proof_json FROM dbo.pos_sync_shift_intent_starts"))return{recordset:copy(data.intentStarts.filter(row=>sameId(row.intent_id,this.inputs.intent)))};
      if(query.startsWith("SELECT proof_json FROM dbo.pos_sync_shift_closing_starts"))return{recordset:copy(data.closingStarts.filter(row=>sameId(row.shift_id,this.inputs.shift)&&sameId(row.branch_id,this.inputs.branch)))};
      if(query.startsWith("INSERT dbo.pos_sync_shift_authors")){data.authors.push({intent_id:this.inputs.intent,attestation_json:this.inputs.proof});return{recordset:[],rowsAffected:[1]};}
      if(query.includes("pos_sync_shift_authors"))return{recordset:copy(data.authors.filter(row=>sameId(row.intent_id,this.inputs.intent)))};
      if(query.startsWith("INSERT dbo.pos_sync_shift_openings")){
        data.openings.push({aggregate_id:this.inputs.aggregate,shift_id:this.inputs.shift,branch_id:this.inputs.branch,row_json:this.inputs.row,row_hash:this.inputs.hash});return{recordset:[],rowsAffected:[1]};
      }
      if(query.includes("pos_sync_shift_openings"))return{recordset:copy(data.openings.filter(row=>sameId(row.aggregate_id,this.inputs.aggregate)&&sameId(row.branch_id,this.inputs.branch)))};
      if(query.includes("pos_sync_shift_baselines"))return{recordset:copy(data.baselines.filter(row=>sameId(row.shift_id,this.inputs.shift)&&sameId(row.branch_id,this.inputs.branch)))};
      if(query.startsWith("INSERT dbo.pos_sync_shift_intents")){
        data.intents.push({intent_sequence:data.intents.length+1,intent_id:this.inputs.intent,branch_id:this.inputs.branch,shift_id:this.inputs.shift,
          intent_kind:this.inputs.kind,baseline_generation:this.inputs.generation,base_token:this.inputs.base,predecessor_intent_id:this.inputs.predecessor,
          predecessor_intent_hash:this.inputs.predecessor_hash,payload_json:this.inputs.payload,payload_hash:this.inputs.hash});return{recordset:[],rowsAffected:[1]};
      }
      if(query.startsWith("UPDATE dbo.pos_sync_shift_intents")){
        Object.assign(data.intents.find(row=>sameId(row.intent_id,this.inputs.intent))!,{accepted_token:this.inputs.accepted,current_token:this.inputs.current,
          superseded:this.inputs.superseded,acknowledged_at:"acknowledged",ack_coverage_json:this.inputs.coverage});return{recordset:[],rowsAffected:[1]};
      }
      if(query.startsWith("UPDATE dbo.sync_change_journal")){
        data.journal.filter(row=>sameId(row.aggregate_id,this.inputs.aggregate)).forEach(row=>{row.acknowledged_at="acknowledged";});return{recordset:[],rowsAffected:[1]};
      }
      if(query.includes("SELECT DISTINCT shift_id FROM dbo.pos_sync_shift_intents"))return{recordset:copy(data.intents.filter(row=>sameId(row.branch_id,this.inputs.branch)&&JSON.parse(String(this.inputs.ids)).some((id:string)=>sameId(id,row.shift_id))))};
      if(query.includes("pos_sync_shift_intents"))return{recordset:copy(data.intents.filter(row=>sameId(row.branch_id,this.inputs.branch)&&
        (!query.includes("acknowledged_at IS NOT NULL")||row.acknowledged_at)&&
        (!query.includes("ack_coverage_json IS NOT NULL")||row.ack_coverage_json)&&
        (!this.inputs.before||Number(row.intent_sequence)<Number(this.inputs.before))&&
        (this.inputs.intent?sameId(row.intent_id,this.inputs.intent):sameId(row.shift_id,this.inputs.shift))).sort((a,b)=>Number(b.intent_sequence)-Number(a.intent_sequence)).slice(0,1))};
      if (query.startsWith("INSERT dbo.sync_change_journal")) {
        if (faults.journal) throw faults.journal;
        events.push("journal"); data.journal.push({ ...copy(this.inputs), change_id: data.journal.length + 1, acknowledged_at: null });
        return { rowsAffected: [1], recordset: [] };
      }
      if (query.startsWith("INSERT dbo.local_operation_receipts")) {
        if (faults.receipt) throw faults.receipt;
        events.push("receipt"); data.receipts.push(copy(this.inputs)); return { rowsAffected: [1], recordset: [] };
      }
      if (query.includes("SELECT note FROM dbo.local_operation_receipts")) {
        events.push("lock:receipt");
        return { recordset: data.receipts.filter(row => row.operation_id === this.inputs.operation_id) };
      }
      if (query.startsWith("SELECT id FROM dbo.shifts"))
        return { recordset: data.tables.shifts.filter(row => sameId(row.store_id, this.inputs.branch) && !row.closed_at && row.status === "OPEN") };
      if (query.startsWith("SELECT CASE WHEN EXISTS"))
        return { recordset: [{ allowed: data.tables[/dbo\.\[([a-z_]+)\]/.exec(query)?.[1]??"shifts"].some(row => sameId(row.id, this.inputs.scope0) && sameId(row.store_id, this.inputs.branch)) ? 1 : 0 }] };
      const table = /dbo\.\[?([a-z_]+)\]?/.exec(query)?.[1];
      if (!table) throw new Error(`Unhandled fixture statement: ${query}`);
      if (query.startsWith("MERGE ")) {
        if (faults.business) throw faults.business;
        const row = Object.fromEntries([...query.matchAll(/@v(\d+) AS \[([a-z_]+)\]/g)].map(match => [match[2], this.inputs[`v${match[1]}`]]));
        const exists = data.tables[table].some(saved => sameId(saved.id, row.id));
        if (!exists) data.tables[table].push(row);
        events.push(`write:${table}`); return { rowsAffected: [exists ? 0 : 1], recordset: [] };
      }
      if (query.startsWith("UPDATE source SET")) {
        if (faults.business) throw faults.business;
        const row = data.tables[table].find(saved => sameId(saved.id, this.inputs.m0) && sameId(saved.store_id, this.inputs.branch));
        if (row) {
          for (const match of query.matchAll(/\[([a-z_]+)\]=@v(\d+)/g)) row[match[1]] = this.inputs[`v${match[2]}`];
          if (query.includes("[row_version]=COALESCE")) row.row_version = Number(row.row_version ?? 0) + 1;
        }
        events.push(`write:${table}`); return { rowsAffected: [row ? 1 : 0], recordset: [] };
      }
      if (query.startsWith("SELECT ")) {
        events.push(query.startsWith("SELECT id FROM dbo.[shifts]") ? "lock:parent" : `read:${table}`);
        let rows = data.tables[table].filter(row => table === "shifts"
          ? (this.inputs.ids?JSON.parse(String(this.inputs.ids)).some((id:string)=>sameId(id,row.id)):sameId(row.id, this.inputs.shift)) && (this.inputs.branch==null||sameId(row.store_id, this.inputs.branch))
          : table === "activity_events" ? Object.values(this.inputs).some(value => sameId(row.id, value))
          : sameId(row.shift_id, this.inputs.shift));
        rows = copy(rows);
        if (faults.transform) rows = faults.transform(table, rows);
        return { recordset: rows };
      }
      throw new Error(`Unhandled fixture operation: ${query}`);
    }
  }
  const sql = { Transaction, Request, UniqueIdentifier: "uuid", ISOLATION_LEVEL: { SERIALIZABLE: 4 } };
  const connectionManager = { sql: () => sql, pool: {
    get image(){return state;},
    request() {
      return {
        input() { return this; },
        async query(text: string) {
          if (!text.includes("OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1'") &&
              !text.includes("COL_LENGTH(N'dbo.local_operation_receipts',N'refund_evidence_json')"))
            throw new Error("Unexpected read outside the fixture transaction");
          return { recordset: [] };
        },
      };
    },
  } };
  const repository = new OperationsRepository(connectionManager, registry);
  const writer = new ShiftSyncJournal(repository);
  const apply=writer.apply.bind(writer);
  writer.apply=async(context:string,ops:Operation[],scope:Row={})=>{
    const eventCount=events.length;
    const observation=scope.observation??await writer.observe(scope.branchId,shiftId);
    events.splice(eventCount); // Separate the read observation from the write transaction assertions.
    return apply(context,ops,{...scope,observation});
  };
  return { registry, repository, writer, connectionManager, events, faults, data: () => state, ownBranch,
    replace(next: State) { state = next; }, scope: { branchId: ownBranch, terminalId: terminal } };
}

function closeOperations(ownBranch = branch, cash = 90, nullable = true, base = 0): Operation[] {
  const counted = { counted_cash: cash, counted_card: nullable ? null : 20, counted_digital: nullable ? null : 10 };
  const facts = { ...counted, expected_cash: 100, expected_card: 20, expected_digital: 10,
    variance_cash: cash - 100, variance_card: nullable ? null : 0, variance_digital: nullable ? null : 0,
    variance_total: cash - 100, variance_status: cash === 100 ? "NO_VARIANCE" : "SHORT" };
  return [
    { kind: "insert", table: "shift_cash_counts", rows: [{ id: uuid(base + 1), shift_id: shiftId, store_id: ownBranch,
      terminal_id: terminal, kind: base ? "RECOUNT" : "ORIGINAL", ...counted, client_key: `fixture-${base}`, created_at: now }] },
    { kind: "insert", table: "shift_reconciliations", rows: [{ id: uuid(base + 2), shift_id: shiftId, store_id: ownBranch, count_id: uuid(base + 1), ...facts, created_at: now }] },
    { kind: "insert", table: "shift_close_events", rows: [{ id: uuid(base + 3), shift_id: shiftId, store_id: ownBranch, event: base ? "recount_submitted" : "reconciled", created_at: now }] },
    { kind: "update", table: "shifts", match: { id: shiftId }, values: { store_id: ownBranch, status: "CLOSED", state: "CLOSED", closed_at: now, final_counted_cash: cash, closing_float: cash, ...facts, updated_at: now } },
    ...(!base ? [{ kind: "insert", table: "shift_notifications", rows: [{ id: uuid(4), shift_id: shiftId, store_id: ownBranch, counted_cash: cash, expected_cash: 100, created_at: now }] }] : []),
  ];
}

function workerFixture(h: ReturnType<typeof fixture>, confirmation = true) {
  const reader = new ChangeReader(h.connectionManager, h.registry);
  reader.shiftPrerequisites=async()=>true; // This fixture has no financial journal/CT rows; real LocalDB tests exercise that guard.
  reader.pendingAggregates = async (_branch: string, _limit: number, excluded: string[] = []) => {
    const byId = new Map<string, Row[]>();
    for (const row of h.data().journal.filter(row => !row.acknowledged_at && !excluded.includes(String(row.aggregate_id)))) {
      const key = String(row.aggregate_id);
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key)!.push({ ...row, key: JSON.parse(String(row.entity_id)) });
    }
    return [...byId].map(([aggregateId, changes]) => ({ aggregateId, changes }));
  };
  reader.rows = async (table: { sqlServerTable: string }, changes: { key: { id: string } }[]) => h.data().tables[table.sqlServerTable]
    .filter(row => changes.some(change => sameId(change.key.id, row.id))).map(row => toCloudRow(table, copy(row)));
  reader.acknowledgeAggregate = async (aggregateId: string) => {
    for (const row of h.data().journal.filter(row => row.aggregate_id === aggregateId)) row.acknowledged_at = "acknowledged";
  };
  reader.failAggregate = async (aggregateId: string, error: Error) => {
    for (const row of h.data().journal.filter(row => row.aggregate_id === aggregateId)) row.last_error = error.message;
  };
  reader.changedIds = async (table: { cloudTable: string }) => {
    if (table.cloudTable === "change_history") throw Object.assign(new Error("fixture gap"), { code: "ECHANGEGAP", table: "change_history" });
    return [];
  };
  const uploaded: Row[] = [];
  const cloudRows = new Map<string, Row>([[shiftId, { id: shiftId, store_id: h.ownBranch, state: "ACTIVE", status: "OPEN", closed_at: null, row_version: 1 }]]);
  const cloud = { terminalId: () => terminal,
    pushAggregate: async (request: { batchId: string; operations?: { table: string; rows: Row[] }[]; shiftIntent?:Row }) => {
      uploaded.push(copy(request));
      const operations=request.shiftIntent?JSON.parse(String(request.shiftIntent.payloadJson)).operations:request.operations;
      const shiftRows = operations.filter((operation:Row) => operation.table === "shifts").flatMap((operation:Row) => operation.rows);
      for (const row of shiftRows)if(!(cloudRows.get(String(row.id))?.status==="CLOSED"&&row.status==="OPEN"))cloudRows.set(String(row.id), copy(row));
      const parents = shiftRows.filter((row:Row) => row.status === "CLOSED");
      return { ok: true, batch_id: request.batchId, ...(confirmation ? { shift_closure_ack_version: request.shiftIntent?3:2,
        shift_closures: parents.map((row:Row) => ({ id: row.id, store_id: row.store_id, row_version: Number(row.row_version) + 10, requested_row_version: row.row_version,
          ...(request.shiftIntent?{intent_id:request.batchId,intent_hash:require("../../../electron/db/shift-intents.cjs").hashPayload(request.shiftIntent.payloadJson),accepted_token:"a".repeat(64),current_token:"a".repeat(64),superseded:false,coverage:matchingCoverage(h.registry,operations)}:{}) })) } : {}) };
    },
  };
  const tables = h.registry.tables.filter((table: { cloudTable: string }) => ["sales","change_history", "shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts", "activity_events"].includes(table.cloudTable));
  return { reader, uploaded, cloudRows, worker: new PushWorker({ reader, cloud, registry: { tables }, checkpoints: { list: async () => [] } }) };
}

async function commitNextOpening(h: ReturnType<typeof fixture>) {
  return new AggregateRepository(h.connectionManager, h.repository).commit("shift", {
    branchId: h.ownBranch, terminalId: terminal, permissions: { can_open_shift: true },
    operations: [{ kind: "insert", table: "shifts", rows: [{ id: uuid(98), store_id: h.ownBranch, terminal_id: terminal,
      status: "OPEN", state: "ACTIVE", closed_at: null, opening_float: 20 }] }],
  });
}

describe("protected shift closing durable journal", () => {
  const signingAuthor=(h:ReturnType<typeof fixture>,guard=()=>undefined)=>{
    const pair=generateKeyPairSync("ed25519"),protocol=require("../../../electron/security/shift-author-protocol.cjs");
    return{assertCurrent:guard,sign:(facts:Row)=>{
      guard();const unsigned={version:1,algorithm:"Ed25519",keyId:uuid(90),projectOrigin:"https://fixture.supabase.co",terminalId:terminal,authorId:uuid(91),subject:"verified.author",...facts};
      return protocol.normalizeAttestation({...unsigned,signature:sign(null,Buffer.from(protocol.intentMessage(unsigned)),pair.privateKey).toString("base64url")});
    },save:async(transaction:any,proof:Row)=>{guard();await new(h.connectionManager.sql().Request)(transaction).input("intent",proof.intentId).input("proof",JSON.stringify(proof)).query("INSERT dbo.pos_sync_shift_authors(intent_id,attestation_json) VALUES(@intent,@proof);");}};
  };
  it("associates A's start proof only with ORIGINAL, leaving later RECOUNT and VARIANCE separate", async () => {
    const h = fixture(), parent = h.data().tables.shifts[0];
    Object.assign(parent, {closing_started_at:now,closing_started_by:"starter",close_reason:"Handover"});
    const event = {id:uuid(92),shift_id:shiftId,store_id:branch,terminal_id:terminal,event:"closing_started",from_state:"ACTIVE",to_state:"CASH_COUNT_REQUIRED",actor_name:"starter",actor_staff_id:"starter",created_at:now};
    h.data().tables.shift_close_events.push(event);
    const parentFields = ["id","store_id","terminal_id","opened_at","opened_by_staff_id","opened_by_name","closing_started_at","closing_started_by","close_reason"];
    const payloadJson = JSON.stringify({version:1,branchId:branch,shiftId,eventId:event.id,event,parent:Object.fromEntries(parentFields.map(key=>[key,parent[key]??null]))});
    const protocol = require("../../../electron/security/shift-author-protocol.cjs"), pair = generateKeyPairSync("ed25519");
    const unsigned = {version:1,algorithm:"Ed25519",keyId:uuid(93),projectOrigin:"https://fixture.supabase.co",terminalId:terminal,authorId:uuid(94),subject:"starter",branchId:branch,shiftId,eventId:event.id,payloadJson,payloadHash:createHash("sha256").update(payloadJson).digest("hex")};
    const proof = protocol.normalizeClosingStart({...unsigned,signature:sign(null,Buffer.from(protocol.closingStartMessage(unsigned)),pair.privateKey).toString("base64url")});
    h.data().closingStarts.push({shift_id:shiftId,branch_id:branch,event_id:event.id,proof_json:JSON.stringify(proof)});
    await h.writer.apply("B original",closeOperations(),{...h.scope,author:signingAuthor(h)});
    await h.writer.apply("later recount",closeOperations(branch,95,true,10),h.scope);
    await h.writer.apply("later variance",[{kind:"update",table:"shifts",match:{id:shiftId},values:{store_id:branch,note:"approved review"}}],h.scope);
    expect(h.data().intentStarts).toHaveLength(1);
    const reader = new ChangeReader(h.connectionManager,h.registry), intents = h.data().intents;
    const original = await reader.protectedIntent(intents[0].intent_id,branch);
    expect(original.shiftClosingStart).toEqual(proof); expect(original.shiftAuthor.authorId).toBe(uuid(91));
    for (const row of intents.slice(1)) expect((await reader.protectedIntent(row.intent_id,branch)).shiftClosingStart).toBeNull();
    expect(intents.map(row=>row.intent_kind)).toEqual(["ORIGINAL","RECOUNT","VARIANCE"]);
    for (const row of intents.slice(1)) {
      const foreign = {intent_id:row.intent_id,proof_json:JSON.stringify(proof)};
      h.data().intentStarts.push(foreign);
      await expect(reader.protectedIntent(row.intent_id,branch)).rejects.toMatchObject({code:"ESYNC_SHIFT_START_INVALID"});
      h.data().intentStarts.pop();
    }
    expect((await reader.protectedIntent(intents[0].intent_id,branch)).shiftClosingStart).toEqual(proof);
  });
  it("freezes the signature atomically with the domain graph, immutable payload and journal",async()=>{
    const h=fixture(),author=signingAuthor(h);h.writer.authorRequired=true;
    await h.writer.apply("signed close",closeOperations(),{...h.scope,author});
    const intent=await new ChangeReader(h.connectionManager,h.registry).protectedIntent(h.data().intents[0].intent_id,branch);
    expect(intent.shiftAuthor).toMatchObject({authorId:uuid(91),subject:"verified.author",intentId:intent.intentId,payloadHash:intent.payloadHash,action:"ORIGINAL"});
    expect(JSON.parse(intent.payloadJson)).not.toHaveProperty("shiftAuthor");expect(h.data().authors).toHaveLength(1);
    const f=workerFixture(h);f.worker.validateAuthor=(proof:Row)=>proof;await f.worker.pushAggregates(branch,100);
    expect(f.uploaded[0].shiftAuthor).toEqual(intent.shiftAuthor);expect((f.uploaded[0].shiftIntent as Row).payloadJson).toBe(intent.payloadJson);
  });
  it("rolls back the whole signed graph if the author changes after signature persistence",async()=>{
    const h=fixture(),before=copy(h.data());let current=true;const author=signingAuthor(h,()=>{if(!current)throw Object.assign(new Error("changed"),{code:"ESYNC_SHIFT_AUTHOR_CHANGED"});});
    const save=author.save;author.save=async(tx,proof)=>{await save(tx,proof);current=false;};
    await expect(h.writer.apply("changed",closeOperations(),{...h.scope,author})).rejects.toMatchObject({code:"ESYNC_SHIFT_AUTHOR_CHANGED"});expect(h.data()).toEqual(before);expect(h.events.at(-1)).toBe("rollback");
  });
  it.each(["ESYNC_SHIFT_AUTHOR_KEY_MISSING","ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING"])("retains the signed intent without an HTTP call or acknowledgement for %s",async code=>{
    const h=fixture();await h.writer.apply("signed close",closeOperations(),{...h.scope,author:signingAuthor(h)});
    const f=workerFixture(h),before=copy(h.data().intents);f.worker.validateAuthor=()=>{throw Object.assign(new Error("author pending"),{code});};
    await expect(f.worker.pushAggregates(branch,100)).rejects.toMatchObject({code});expect(f.uploaded).toEqual([]);expect(h.data().intents).toEqual(before);expect(h.data().journal.every(row=>!row.acknowledged_at)).toBe(true);expect(h.data().baselines).toEqual([]);
  });
  it("rejects a missing author in the Main-required writer and corrupt saved proof on reload",async()=>{
    const h=fixture();h.writer.authorRequired=true;
    await expect(h.writer.apply("unsigned",closeOperations(),h.scope)).rejects.toMatchObject({code:"ESYNC_SHIFT_AUTHOR_IDENTITY_PENDING"});
    await h.writer.apply("signed",closeOperations(),{...h.scope,author:signingAuthor(h)});
    const proof=JSON.parse(String(h.data().authors[0].attestation_json));proof.payloadHash="f".repeat(64);h.data().authors[0].attestation_json=JSON.stringify(proof);
    await expect(new ChangeReader(h.connectionManager,h.registry).protectedIntent(h.data().intents[0].intent_id,branch)).rejects.toMatchObject({code:"ESYNC_SHIFT_AUTHOR_INVALID"});
  });
  it.each([true, false])("commits actual postimage/count graph atomically, nullable tenders=%s", async nullable => {
    const h = fixture();
    const result = await h.writer.apply("Closing shift cash count", closeOperations(branch, 90, nullable), h.scope);
    expect(result).toEqual({ ok: true, context: "Closing shift cash count", affected: 5 });
    expect(h.data().tables.shifts[0]).toMatchObject({ status: "CLOSED", row_version: 3, counted_card: nullable ? null : 20 });
    expect(h.data().journal).toHaveLength(5);
    expect(new Set(h.data().journal.map(row => row.aggregate_id)).size).toBe(1);
    expect(h.data().journal.find(row => row.entity_type === "shifts")?.entity_version).toBe(3);
    expect(h.data().receipts).toHaveLength(1);
    expect(h.events.indexOf("journal")).toBeGreaterThan(h.events.indexOf("write:shifts"));
    expect(h.events.indexOf("lock:receipt")).toBeLessThan(h.events.indexOf("lock:parent"));
    expect(h.events.indexOf("lock:parent")).toBeLessThan(h.events.indexOf("write:shift_cash_counts"));
    expect(h.events.at(-1)).toBe("commit");
  });

  it.each(["journal", "receipt", "business"] as const)("rolls back all business/queue facts on %s failure, preserving error identity", async where => {
    const h = fixture(), failure = new Error(`fixture ${where} failure`), before = copy(h.data());
    h.faults[where] = failure;
    await expect(h.writer.apply("Closing shift cash count", closeOperations(), h.scope)).rejects.toBe(failure);
    expect(h.data()).toEqual(before);
    expect(h.events.at(-1)).toBe("rollback");
    expect(h.events).not.toContain("commit");
  });

  it("keeps default three-argument writes unchanged and rejects serializable callback flags", async () => {
    const h = fixture();
    await h.repository.apply("ordinary prior close", closeOperations(), h.scope);
    expect(h.data().journal).toEqual([]);
    expect(h.data().receipts).toEqual([]);
    await expect(h.repository.apply("bad callback", closeOperations(), h.scope, true)).rejects.toThrow("internal function");
    await expect(h.repository.apply("bad prepare callback", closeOperations(), h.scope, undefined, true)).rejects.toThrow("internal function");
    let beforeCommitCalled = false;
    await h.repository.apply("existing fourth callback", closeOperations(), h.scope, async () => { beforeCommitCalled = true; });
    expect(beforeCommitCalled).toBe(true);
  });

  it("pre-write ownership failure rolls back before any child or journal write", async () => {
    const h = fixture();
    h.data().tables.shifts[0].store_id = otherBranch;
    const before = copy(h.data());
    await expect(h.writer.apply("Closing shift cash count", closeOperations(), h.scope)).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(h.events).not.toContain("write:shift_cash_counts");
    expect(h.data()).toEqual(before);
  });

  it("retains raw renderer closing denial with otherwise valid opening/closing permissions", async () => {
    const h = fixture(), before = copy(h.data());
    await expect(h.repository.apply("renderer", closeOperations(), { ...h.scope, enforcePermissions: true,
      permissions: { can_open_shift: true, can_close_shift: true } })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(h.data()).toEqual(before);
  });

  it.each([null, otherTerminal])("preserves authorized handover from parent terminal %s", async parentTerminal => {
    const h = fixture({ terminal: parentTerminal });
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    expect(h.data().tables.shifts[0].terminal_id).toBe(parentTerminal);
    expect(h.data().journal.length).toBeGreaterThan(0);
  });

  it("preserves non-UUID legacy branch identifiers", async () => {
    const h = fixture({ branch: "legacy-branch" });
    await h.writer.apply("Closing shift cash count", closeOperations(h.ownBranch), h.scope);
    expect(h.data().journal.every(row => row.branch_id === "legacy-branch")).toBe(true);
  });

  it.each(["input branch", "input parent", "stored branch", "stored parent"])("rejects %s mismatch without committing", async mismatch => {
    const h = fixture(), ops = closeOperations(), before = copy(h.data());
    if (mismatch === "input branch") ops[0].rows![0].store_id = otherBranch;
    if (mismatch === "input parent") ops[0].rows![0].shift_id = uuid(99);
    if (mismatch.startsWith("stored")) h.faults.transform = (table, rows) => table === "shift_cash_counts"
      ? rows.map(row => ({ ...row, [mismatch === "stored branch" ? "store_id" : "shift_id"]: uuid(99) })) : rows;
    await expect(h.writer.apply("Closing shift cash count", ops, h.scope)).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(h.data()).toEqual(before);
  });

  it("rejects incomplete persisted graph instead of inventing a count", async () => {
    const h = fixture(), before = copy(h.data());
    h.faults.transform = (table, rows) => table === "shift_cash_counts" ? [] : rows;
    await expect(h.writer.apply("Closing shift cash count", closeOperations(), h.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(h.data()).toEqual(before);
  });

  it("requires every newly written closing event and summary to be present", async () => {
    const h = fixture(), before = copy(h.data());
    h.faults.transform = (table, rows) => table === "shift_close_events" ? [] : rows;
    await expect(h.writer.apply("Closing shift cash count", closeOperations(), h.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(h.data()).toEqual(before);
  });

  it("keeps one stable receipt/journal across the same request retry", async () => {
    const h = fixture(), ops = closeOperations();
    await h.writer.apply("Closing shift cash count", ops, h.scope);
    const firstJournal = copy(h.data().journal);
    await h.writer.apply("Closing shift cash count", ops, h.scope);
    expect(h.data().journal).toEqual(firstJournal);
    expect(h.data().receipts).toHaveLength(1);
    expect(h.data().tables.shift_cash_counts).toHaveLength(1);
  });

  it("rejects a conflicting saved receipt before any further business write", async () => {
    const h = fixture(), ops = closeOperations();
    await h.writer.apply("Closing shift cash count", ops, h.scope);
    h.data().receipts[0].note = "different saved facts";
    const before = copy(h.data());
    h.events.length = 0;
    await expect(h.writer.apply("Closing shift cash count", ops, h.scope)).rejects.toMatchObject({ code: "EIDEMPOTENCY" });
    expect(h.events.slice(-3)).toEqual(["begin", "lock:receipt", "rollback"]);
    expect(h.data()).toEqual(before);
  });

  it("journals only computed variance activity attached to this shift", async () => {
    const h = fixture(), ops = closeOperations();
    ops.push({ kind: "insert", table: "shift_variance_alerts", rows: [{ id: uuid(5), store_id: branch, shift_id: shiftId, reconciliation_id: uuid(2), variance_total: -10 }] });
    ops.push({ kind: "insert", table: "activity_events", rows: [{ id: uuid(6), store_id: branch, branch_id: branch, entity_type: "shift", entity_id: shiftId, event_type: "shift_cash_variance" }] });
    await h.writer.apply("Closing shift cash count", ops, h.scope);
    expect(h.data().journal.some(row => row.entity_type === "activity_events" && JSON.parse(String(row.entity_id)).id === uuid(6))).toBe(true);
    const bad = fixture();
    const unrelated = closeOperations(); unrelated.push({ kind: "insert", table: "sales", rows: [{ id: uuid(88), store_id: branch }] });
    await expect(bad.writer.apply("fake closure", unrelated, bad.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(bad.events).toEqual([]);
  });

  it("preserves a recount's original count/summary while binding its new count and reconciliation", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    await h.writer.apply("Saving shift recount", closeOperations(branch, 95, true, 10), h.scope);
    expect(h.data().tables.shift_cash_counts.map(row => row.counted_cash)).toEqual([90, 95]);
    expect(h.data().tables.shift_notifications[0].counted_cash).toBe(90);
    expect(h.data().tables.shifts[0].counted_cash).toBe(95);
    const latest = String(h.data().receipts.at(-1)!.operation_id);
    expect(h.data().journal.filter(row => row.aggregate_id === latest && row.entity_type === "shift_cash_counts")).toHaveLength(2);
  });

  it("cannot substitute an older matching reconciliation for the new recount", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    const before = copy(h.data());
    h.faults.transform = (table, rows) => table === "shifts" ? rows.map(row => ({ ...row,
      ...before.tables.shifts[0], row_version: row.row_version })) : rows;
    await expect(h.writer.apply("Saving shift recount", closeOperations(branch, 95, true, 10), h.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(h.data()).toEqual(before);
  });

  it("preserves nullable historical FK audit rows while binding the real new recount", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    h.data().tables.shift_reconciliations.push({ ...h.data().tables.shift_reconciliations[0], id: uuid(80), count_id: null, counted_cash: 80 });
    h.data().tables.shift_variance_alerts.push({ id: uuid(81), shift_id: shiftId, store_id: branch, reconciliation_id: null, variance_total: -20 });
    await h.writer.apply("Saving shift recount", closeOperations(branch, 95, true, 10), h.scope);
    expect(h.data().tables.shift_reconciliations.find(row => row.id === uuid(80))?.count_id).toBeNull();
    expect(h.data().tables.shift_variance_alerts[0].reconciliation_id).toBeNull();
    expect(h.data().tables.shifts[0].counted_cash).toBe(95);
  });

  it.each([null, uuid(99)])("does not accept a new recount reconciliation without its real count: %s", async countId => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    const before = copy(h.data()), ops = closeOperations(branch, 95, true, 10);
    ops[1].rows![0].count_id = countId;
    await expect(h.writer.apply("Saving shift recount", ops, h.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(h.data()).toEqual(before);
  });

  it("approval cannot use only a historical null-FK reconciliation as final proof", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    h.data().tables.shift_reconciliations[0].count_id = null;
    h.data().tables.shifts[0].state = "RECONCILIATION";
    const before = copy(h.data());
    await expect(h.writer.apply("Approving shift variance", [
      { kind: "update", table: "shifts", match: { id: shiftId }, values: { store_id: branch, status: "CLOSED", state: "CLOSED", closed_at: now } },
      { kind: "insert", table: "shift_close_events", rows: [{ id: uuid(90), shift_id: shiftId, store_id: branch, event: "variance_approved" }] },
    ], h.scope)).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(h.data()).toEqual(before);
  });

  it("approval uses saved graph, without creating new counts or changing money", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    h.data().tables.shifts[0].state = "RECONCILIATION";
    const count = copy(h.data().tables.shift_cash_counts);
    await h.writer.apply("Approving shift variance", [
      { kind: "update", table: "shifts", match: { id: shiftId }, values: { store_id: branch, status: "CLOSED", state: "CLOSED", closed_at: now, closed_by_name: "fixture approver" } },
      { kind: "insert", table: "shift_close_events", rows: [{ id: uuid(90), shift_id: shiftId, store_id: branch, event: "variance_approved", created_at: now }] },
    ], h.scope);
    expect(h.data().tables.shift_cash_counts).toEqual(count);
    expect(h.data().tables.shifts[0]).toMatchObject({ counted_cash: 90, closed_by_name: "fixture approver" });
  });

  it("uploads a complete protected closure while retaining the unrelated expired-history hold", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    const f = workerFixture(h);
    await expect(f.worker.run({ branchId: branch, includeActivity: false })).resolves.toMatchObject({ allUploaded:false,historyUploadHeld:{code:'ECHANGEGAP',table:'change_history'} });
    expect(f.uploaded).toHaveLength(1);
    expect(f.uploaded[0].operations).toBeUndefined();
    const operations = JSON.parse(String((f.uploaded[0].shiftIntent as Row).payloadJson)).operations as { table: string; rows: Row[] }[];
    expect(operations.find(op => op.table === "shifts")?.rows[0]).toMatchObject({ status: "CLOSED", row_version: 3, counted_cash: 90 });
    expect(operations.find(op => op.table === "shift_cash_counts")?.rows).toHaveLength(1);
    expect(h.data().journal.every(row => !!row.acknowledged_at)).toBe(true);
  });
  it("accepts one real-driver uppercase aggregate UUID without changing its frozen intent",async()=>{
    const h=fixture();await h.writer.apply("close",closeOperations(),h.scope);
    const f=workerFixture(h),read=f.reader.pendingAggregates.bind(f.reader),frozen=String(h.data().intents[0].payload_json);
    f.reader.pendingAggregates=async(...args:unknown[])=>(await read(...args)).map((aggregate:Row)=>({...aggregate,aggregateId:String(aggregate.aggregateId).toUpperCase()}));
    await expect(f.worker.pushAggregates(branch,1)).resolves.toBeGreaterThan(0);
    expect(f.uploaded).toHaveLength(1);expect((f.uploaded[0].shiftIntent as Row).payloadJson).toBe(frozen);
    expect(f.uploaded[0].batchId).toBe(h.data().intents[0].intent_id);expect(h.data().journal.every(row=>!!row.acknowledged_at)).toBe(true);
  });

  it("reproduces old OPEN + new OPEN with the actual unjournaled writer, then protects the journaled path", async () => {
    const old = fixture();
    await old.repository.apply("prior protected close", closeOperations(), old.scope);
    await commitNextOpening(old);
    const previous = workerFixture(old);
    await expect(previous.worker.run({ branchId: branch, includeActivity: false })).resolves.toMatchObject({ allUploaded:false,historyUploadHeld:{code:'ECHANGEGAP',table:'change_history'} });
    expect(old.data().tables.shifts[0].status).toBe("CLOSED");
    expect(previous.cloudRows.get(shiftId)?.status).toBe("OPEN");
    expect(previous.cloudRows.get(uuid(98))?.status).toBe("OPEN");

    const fixed = fixture();
    await fixed.writer.apply("Closing shift cash count", closeOperations(), fixed.scope);
    await commitNextOpening(fixed);
    const current = workerFixture(fixed);
    await expect(current.worker.run({ branchId: branch, includeActivity: false })).resolves.toMatchObject({ allUploaded:false,historyUploadHeld:{code:'ECHANGEGAP',table:'change_history'} });
    expect(current.cloudRows.get(shiftId)?.status).toBe("CLOSED");
    expect(current.cloudRows.get(uuid(98))?.status).toBe("OPEN");
  });

  it("does not clear the durable closure when the cloud gives only a generic success", async () => {
    const h = fixture();
    await h.writer.apply("Closing shift cash count", closeOperations(), h.scope);
    const f = workerFixture(h, false);
    await expect(f.worker.run({ branchId: branch, includeActivity: false })).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_UNCONFIRMED",table:'shifts' });
    expect(h.data().journal.every(row => !row.acknowledged_at)).toBe(true);
    expect(h.data().journal.some(row => String(row.last_error).includes("not confirmed"))).toBe(true);
  });

  it("freezes offline ORIGINAL plus two RECOUNTs as three immutable causal snapshots",async()=>{
    const h=fixture();
    for(const [base,cash]of [[0,90],[10,95],[20,97]])await h.writer.apply("close",closeOperations(branch,cash,true,base),h.scope);
    const intents=h.data().intents, payloads=intents.map(row=>JSON.parse(String(row.payload_json)));
    expect(payloads.every(payload=>payload.operations.length===6 && payload.operations.some((op:Row)=>op.table==="shift_variance_alerts"&&(op.rows as Row[]).length===0))).toBe(true);
    expect(payloads.map(payload=>payload.operations.find((op:Row)=>op.table==="shift_cash_counts").rows.length)).toEqual([1,2,3]);
    expect(payloads[0]).toMatchObject({baseToken:null,predecessorIntentId:null,predecessorIntentHash:null});
    for(let index=1;index<3;index++)expect(payloads[index]).toMatchObject({baseToken:null,predecessorIntentId:intents[index-1].intent_id,predecessorIntentHash:intents[index-1].payload_hash});
    expect(payloads.flatMap(payload=>payload.operations).every(op=>Object.keys(op).every(key=>["table","rows","changes","deletePhase"].includes(key)))).toBe(true);
    const f=workerFixture(h);await f.worker.pushAggregates(branch,100);
    expect(f.uploaded.map(request=>JSON.parse(String((request.shiftIntent as Row).payloadJson)).intentId)).toEqual(intents.map(row=>row.intent_id));
    expect(h.data().intents.every(row=>!!row.acknowledged_at)).toBe(true);
    expect(h.data().baselines).toEqual([]);
  });

  it("a new recount committed during an in-flight close links its durable predecessor",async()=>{
    const h=fixture();await h.writer.apply("close",closeOperations(),h.scope);
    const f=workerFixture(h),send=f.worker.cloud.pushAggregate.bind(f.worker.cloud);
    let release!:()=>void,started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
    f.worker.cloud.pushAggregate=async(request:Row)=>{const result=await send(request);if(f.uploaded.length===1){started();await gate;}return result;};
    const sending=f.worker.pushAggregates(branch,100);await entered;
    const frozen=String(h.data().intents[0].payload_json);
    await h.writer.apply("recount",closeOperations(branch,95,true,10),h.scope);
    release();await sending;
    expect(h.data().intents[0].payload_json).toBe(frozen);
    const second=JSON.parse(String((f.uploaded[1].shiftIntent as Row).payloadJson));
    expect(second.predecessorIntentId).toBe(h.data().intents[0].intent_id);
    expect(second.baseToken).toBeNull();
    expect(JSON.parse(String((f.uploaded[0].shiftIntent as Row).payloadJson)).operations.find((op:Row)=>op.table==="shift_cash_counts").rows).toHaveLength(1);
  });

  it("acknowledging I1 leaves the pending I2 tail for I3, even when I1 is historical/superseded",async()=>{
    const h=fixture();await h.writer.apply("close",closeOperations(),h.scope);
    await h.writer.apply("recount",closeOperations(branch,95,true,10),h.scope);
    const reader=new ChangeReader(h.connectionManager,h.registry), first=await reader.protectedIntent(h.data().intents[0].intent_id,branch);
    await reader.acknowledgeProtectedIntent(first,{intent_id:first.intentId,intent_hash:first.payloadHash,accepted_token:"a".repeat(64),current_token:"b".repeat(64),superseded:true,coverage:matchingCoverage(h.registry,first.operations)});
    await h.writer.apply("third",closeOperations(branch,97,true,20),h.scope);
    expect(h.data().intents[0].superseded).toBe(true);
    expect(h.data().intents[1].acknowledged_at).toBeUndefined();
    expect(JSON.parse(String(h.data().intents[2].payload_json)).predecessorIntentId).toBe(h.data().intents[1].intent_id);
    expect(h.data().baselines).toEqual([]);
  });

  it.each(["parent","generation","tail"])("rejects an observation whose %s changed before protected commit",async changed=>{
    const h=fixture(),observation=await h.writer.observe(branch,shiftId);
    if(changed==="parent")h.data().tables.shifts[0].row_version=50;
    if(changed==="generation")h.data().baselines.push({branch_id:branch,shift_id:shiftId,observation_generation:uuid(89)});
    if(changed==="tail")h.data().intents.push({branch_id:branch,shift_id:shiftId,intent_id:uuid(88),payload_hash:"a".repeat(64),intent_sequence:1});
    const before=copy(h.data());
    await expect(h.writer.apply("stale",closeOperations(),{...h.scope,observation})).rejects.toMatchObject({code:"ESHIFT_LOCAL_CHANGED"});
    expect(h.data()).toEqual(before);expect(h.events.some(event=>event.startsWith("write:"))).toBe(false);
  });

  it("an exact receipt retry after a later recount never re-runs the old parent UPDATE",async()=>{
    const h=fixture(),first=closeOperations();await h.writer.apply("close",first,h.scope);
    await h.writer.apply("later",closeOperations(branch,95,true,10),h.scope);
    const before=copy(h.data());
    await expect(h.writer.apply("retry",first,h.scope)).resolves.toMatchObject({replayed:true,affected:0});
    expect(h.data()).toEqual(before);expect(h.data().tables.shifts[0].counted_cash).toBe(95);
  });
  it.each(["shift_cash_counts","shift_reconciliations","shift_close_events"])("does not replay a receipt after historical %s was removed/corrupted",async table=>{
    const h=fixture(),first=closeOperations();await h.writer.apply("close",first,h.scope);
    h.data().tables[table]=[];const before=copy(h.data());
    await expect(h.writer.apply("retry",first,h.scope)).rejects.toMatchObject({code:"EIDEMPOTENCY"});expect(h.data()).toEqual(before);
  });
  it("uploads genuine frozen OPEN before an offline sale, then waits for financial CT before ORIGINAL and two recounts",async()=>{
    const h=fixture();h.data().tables.shifts=[];const aggregates=new AggregateRepository(h.connectionManager,h.repository);
    const opened=await aggregates.commit("shift",{branchId:branch,terminalId:terminal,permissions:{can_open_shift:true},operations:[{kind:"upsert",table:"shifts",rows:[{id:shiftId,store_id:branch,terminal_id:terminal,status:"OPEN",state:"ACTIVE",row_version:1,opening_float:20,opened_at:now}]}]});
    await aggregates.commit("sale",{branchId:branch,terminalId:terminal,permissions:{can_process_sale:true},operations:[{kind:"insert",table:"sales",rows:[{id:uuid(75),store_id:branch,shift_id:shiftId,total_amount:80,bill_number:"fixture-sale",created_at:now}]}]});
    h.data().tables.shifts[0].state="CASH_COUNT_REQUIRED";
    for(const[base,cash]of[[0,90],[10,95],[20,97]])await h.writer.apply("close",closeOperations(branch,cash,true,base),h.scope);
    const f=workerFixture(h),send=f.worker.cloud.pushAggregate.bind(f.worker.cloud),ordered:string[]=[];let financialCT=false;
    f.reader.shiftPrerequisites=async()=>financialCT;
    f.worker.cloud.pushAggregate=async(request:Row)=>{
      const operations=request.shiftIntent?JSON.parse(String((request.shiftIntent as Row).payloadJson)).operations:request.operations;
      if((operations as Row[]).some(op=>op.table==="sales"))expect(f.cloudRows.get(shiftId)?.state).toBe("ACTIVE");
      ordered.push(request.shiftIntent?String((request.shiftIntent as Row).kind):(operations as Row[]).some(op=>op.table==="sales")?"SALE":"OPEN");
      return send(request);
    };
    await f.worker.pushAggregates(branch,1);expect(ordered).toEqual(["OPEN","SALE"]);
    expect((f.uploaded[0].operations as Row[])[0].rows).toEqual([JSON.parse(String(h.data().openings[0].row_json))]);
    expect(h.data().journal.filter(row=>row.aggregate_id!==opened.operationId&&row.entity_type==="shifts").every(row=>!row.acknowledged_at)).toBe(true);
    financialCT=true;await f.worker.pushAggregates(branch,1);expect(ordered).toEqual(["OPEN","SALE","ORIGINAL","RECOUNT","RECOUNT"]);
    f.cloudRows.set(shiftId,{...f.cloudRows.get(shiftId),counted_cash:999,status:"CLOSED"});
    h.data().journal.push({aggregate_id:uuid(76),entity_type:"shifts",entity_id:JSON.stringify({id:shiftId}),operation:"update",acknowledged_at:null,entity_version:1});
    const count=f.uploaded.length;await f.worker.pushAggregates(branch,1);expect(f.uploaded).toHaveLength(count);
    expect(f.cloudRows.get(shiftId)?.counted_cash).toBe(999);expect(h.data().journal.every(row=>!!row.acknowledged_at)).toBe(true);
  });
});
