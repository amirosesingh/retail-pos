const { toCloudRow } = require("./row-codec.cjs");
const { branchPredicate, rendererReadBranchPredicate } = require("../db/branch-scope.cjs");
const { ACTIVITY_TABLES } = require("./event-policy.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { ShiftSyncJournal } = require("../db/shift-sync-journal.cjs");
const {ShiftIntentStore} = require("../db/shift-intents.cjs");
const {exactGraph,exactRows,projection,parseExactJson,isExactNumber}=require("./shift-recovery-exact.cjs");
const {createHash}=require("node:crypto");
const {stableUuid}=require("../db/repositories/aggregates.cjs");
const {prepareFinancialOpening,prepareFinancialHistory,assertFinancialHistoryAcknowledgement}=require("./financial-history-ack.cjs");
const SHIFT_GRAPH_TABLES = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events",
  "shift_notifications", "shift_variance_alerts"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class ChangeReader {
  constructor(connectionManager, registry = null, {financialBases=null,financialOperations=null,financialCoverageSource=null}={}) {
    this.connectionManager = connectionManager;
    this.financialBases=financialBases;this.financialOperations=financialOperations;
    this.financialCoverageSource=financialCoverageSource;
    this.financialCoverageCaptures=new Map();this.financialCoverageTokens=new WeakMap();
    this.registry = registry ?? { tables: [] };
    this.tables = new Map((registry?.tables ?? []).map((table) => [table.sqlServerTable, table]));
    this.pendingGraphChecks = new WeakMap();
    this.exactGraphChecks = new WeakMap();
    this.intents = new ShiftIntentStore(connectionManager,registry);
  }
  table(value) {
    const table = typeof value === "string" ? this.tables.get(value) : value;
    if (!table || !this.tables.has(table.sqlServerTable)) throw new Error("Invalid registry table.");
    const primary = table.columns.filter((column) => column.primaryKey).map((column) => column.sqlServerColumn);
    if (!primary.length) throw new Error(`No primary key is registered for ${table.sqlServerTable}.`);
    return { table, primary };
  }
  entityId(primary, source) { return JSON.stringify(Object.fromEntries(primary.map((column) => [column, source[column]]))); }
  async currentVersion() {
    const result = await this.connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS current_version;");
    return Number(result.recordset?.[0]?.current_version ?? 0);
  }
  async changedIds(value, sinceVersion, limit = 500) {
    const { table, primary } = this.table(value);
    const name = table.sqlServerTable;
    const request = this.connectionManager.pool.request().input("since", Number(sinceVersion) || 0).input("limit", Math.max(100, Math.min(2000, limit)));
    const bounds = await this.connectionManager.pool.request().input("object", `dbo.${name}`).query("SELECT CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object)) AS min_version, CHANGE_TRACKING_CURRENT_VERSION() AS current_version;");
    const min = Number(bounds.recordset?.[0]?.min_version ?? 0);
    if (sinceVersion > 0 && min > Number(sinceVersion)) throw Object.assign(new Error(`Change Tracking history for ${name} has expired; a scoped bootstrap is required.`), { code: "ECHANGEGAP", table: name, minimumVersion: min });
    const keyColumns = primary.map((column) => `CT.[${column}]`).join(",");
    const order = primary.map((column) => `CT.[${column}]`).join(",");
    let result = await request.query(`SELECT TOP (@limit) CT.SYS_CHANGE_VERSION AS version, CT.SYS_CHANGE_OPERATION AS operation, CT.SYS_CHANGE_CONTEXT AS change_context, ${keyColumns}
      FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT
      ORDER BY CT.SYS_CHANGE_VERSION, ${order};`);
    if ((result.recordset?.length ?? 0) === Math.max(100, Math.min(2000, limit))) {
      const boundary = Number(result.recordset.at(-1).version);
      result = await this.connectionManager.pool.request().input("since", Number(sinceVersion) || 0).input("boundary", boundary).query(`SELECT CT.SYS_CHANGE_VERSION AS version, CT.SYS_CHANGE_OPERATION AS operation, CT.SYS_CHANGE_CONTEXT AS change_context, ${keyColumns}
        FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT WHERE CT.SYS_CHANGE_VERSION<=@boundary
        ORDER BY CT.SYS_CHANGE_VERSION, ${order};`);
    }
    return (result.recordset ?? []).map((row) => ({ ...row, remote: Boolean(row.change_context), key: Object.fromEntries(primary.map((column) => [column, row[column]])), entityId: this.entityId(primary, row) }));
  }
  async rows(value, changes, { branchId = "", exactFinancial = false } = {}) {
    const { table, primary } = this.table(value);
    if (!changes.length) return [];
    const coverage=this.financialCoverageSource&&this.financialOperations?.enabled===true&&!SHIFT_GRAPH_TABLES.includes(table.cloudTable)&&primary.length===1&&primary[0]==='id';
    if(coverage)return this.financialTransaction(async tx=>{
      const source=this.financialCoverageBinding(branchId,this.financialCoverageSource.identity.terminalId),request=new(this.connectionManager.sql().Request)(tx);
      const clauses=changes.map((change,index)=>{request.input('coverage'+index,(change.key??change).id);return '@coverage'+index;});
      const scope=branchId&&table.scope==='branch'?(table.cloudTable==='products'?branchPredicate(this.registry,table,'source'):rendererReadBranchPredicate(this.registry,table,'source')):null;
      if(scope)request.input('branch',branchId);
      const result=await request.query(`SELECT source.*,(SELECT ${projection(table)} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) __financial_row_json FROM dbo.[${table.sqlServerTable}] source WITH(HOLDLOCK) WHERE source.id IN(${clauses.join(',')})${scope?' AND ('+scope+')':''};`);
      const rows=(result.recordset??[]).map(value=>{const{__financial_row_json,...physical}=value,exact=JSON.parse(__financial_row_json),wire=this.financialBusinessWire(table,toCloudRow(table,physical),exact,exactFinancial),key=this.financialCoverageKey(table,exact,source);
        // PushWorker canonicalizes SQL-equivalent branch labels at upload.
        const branchColumn=table.scope==='branch'&&table.direction!=='pull'?(table.columns.some(c=>c.cloudColumn==='store_id')?'store_id':table.columns.some(c=>c.cloudColumn==='branch_id')?'branch_id':null):null;
        const sent=branchColumn&&(!String(wire[branchColumn]??'').trim()||recordId(String(wire[branchColumn]).trim())===recordId(branchId))?{...wire,[branchColumn]:recordId(branchId)}:wire;
        const captureId=table.cloudTable+':'+recordId(wire.id)+':'+createHash('sha256').update(JSON.stringify(sent)).digest('hex'),prior=this.financialCoverageCaptures.get(captureId);
        this.financialCoverageCaptures.set(captureId,prior&&prior.key.rowHash!==key.rowHash?{ambiguous:true,key}:prior?.ambiguous?prior:{key,ambiguous:false});
        return wire;});
      if(this.financialCoverageCaptures.size>10000)this.financialCoverageCaptures.clear();source.assertSource();return rows;
    });
    const request = this.connectionManager.pool.request();
    const clauses = changes.map((change, index) => {
      const key = change.key ?? change;
      return `(${primary.map((column, part) => { request.input(`k${index}_${part}`, key[column]); return `[${column}]=@k${index}_${part}`; }).join(" AND ")})`;
    });
    const scope = branchId && table.scope === "branch"
      // Recover unowned legacy purchase headers (and their children) before
      // PushWorker stamps the verified branch. Other branches stay excluded.
      ? table.cloudTable === "products" ? branchPredicate(this.registry, table, "source") : rendererReadBranchPredicate(this.registry, table, "source")
      : null;
    if (scope) request.input("branch", String(branchId));
    const result = await request.query(`SELECT * FROM dbo.[${table.sqlServerTable}] source WHERE (${clauses.join(" OR ")})${scope ? ` AND (${scope})` : ""};`);
    return (result.recordset ?? []).map((row) => toCloudRow(table, row));
  }
  /** Capture current closing facts together; journal entries contain keys, not
   * frozen rows. An offline recount may have superseded an older queued close. */
  async closedShiftGraphs(branchId, shiftIds) {
    const branch = recordId(String(branchId ?? "").trim());
    const ids = [...new Set((shiftIds ?? []).map(value => recordId(String(value ?? "").trim())))].sort();
    const refuse = () => { throw Object.assign(new Error("The current closed shift graph could not be captured safely."), {
      code: "ESHIFT_CLOSURE_SNAPSHOT", table: "shifts",
    }); };
    if (!branch || branch.length > 128 || !ids.length || ids.length > 2000 ||
        ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) refuse();
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(this.connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const journal = new ShiftSyncJournal({ connectionManager: this.connectionManager, tables: this.tables });
      const captured = new Map();
      let total = 0;
      // Lock the complete sorted parent set before touching child ranges. The
      // trusted writer takes its parent lock before inserting closing children.
      for (const id of ids) {
        const locked = await new sql.Request(transaction).input("shift", id).input("branch", branch)
          .query("SELECT id FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;");
        if (locked.recordset?.length !== 1 || recordId(locked.recordset[0].id) !== id) refuse();
      }
      for (const id of ids) {
        const graph = await journal.snapshot(transaction, branch, id, []);
        for (const [table, rows] of graph) {
          const existing = captured.get(table) ?? [];
          if (rows.some(row => existing.some(prior => recordId(prior.id) === recordId(row.id)))) refuse();
          captured.set(table, [...existing, ...rows]);
          total += rows.length;
        }
        if (total > 2000 || Buffer.byteLength(JSON.stringify([...captured]), "utf8") > 6 * 1024 * 1024) refuse();
      }
      await transaction.commit();
      return [...captured].map(([table, rows]) => ({ table, rows }));
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
  async ticketCompletionParents(tickets, branchId) {
    const results = [];
    for (const ticket of tickets.filter(row => row.status === "completed")) {
      if (ticket.store_id !== branchId) throw new Error("Draft completion belongs to another branch.");
      const bookingId = String(ticket.note ?? "").startsWith("booking:") ? String(ticket.note).slice(8) : null;
      const name = bookingId ? "bookings" : "sales";
      const table = this.tables.get(name);
      if (!table) throw new Error("Draft completion parent is not registered.");
      const request = this.connectionManager.pool.request().input("branch", branchId).input("reference", bookingId || ticket.bill_no);
      const result = await request.query(bookingId
        ? "SELECT * FROM dbo.bookings WHERE store_id=@branch AND CONVERT(nvarchar(36),id)=@reference;"
        : "SELECT * FROM dbo.sales WHERE store_id=@branch AND bill_number=@reference;");
      if (!result.recordset?.length) throw new Error("The completed draft has no saved sale or booking.");
      results.push({ table: name, rows: result.recordset.map(row => toCloudRow(table, row)) });
    }
    return results;
  }
  async pendingAggregates(branchId, limit = 500, excludeAggregateIds = [], { includeActivity = true } = {}) {
    const request = this.connectionManager.pool.request().input("branch", branchId).input("limit", Math.max(1, Math.min(2000, limit))).input("include_activity", includeActivity ? 1 : 0);
    const excluded = excludeAggregateIds.slice(0, 2000).map((id, index) => {
      request.input(`excluded${index}`, id);
      return `@excluded${index}`;
    });
    const result = await request.query(`WITH selected AS (
      SELECT TOP (@limit) aggregate_id,MIN(change_id) first_change
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL AND aggregate_id IS NOT NULL
        AND (@include_activity=1 OR EXISTS (
          SELECT 1 FROM dbo.sync_change_journal business_change
          WHERE business_change.aggregate_id=sync_change_journal.aggregate_id
            AND business_change.acknowledged_at IS NULL
            AND business_change.entity_type NOT IN (${[...ACTIVITY_TABLES].map(name => `'${name}'`).join(",")})
        ))
        ${excluded.length ? `AND aggregate_id NOT IN (${excluded.join(",")})` : ""}
      GROUP BY aggregate_id ORDER BY MIN(change_id)
    )
    SELECT journal.change_id,journal.entity_type,journal.entity_id,journal.operation,journal.entity_version,journal.aggregate_id
      FROM dbo.sync_change_journal journal JOIN selected ON selected.aggregate_id=journal.aggregate_id
      WHERE journal.acknowledged_at IS NULL ORDER BY selected.first_change,journal.change_id;`);
    const byAggregate = new Map();
    for (const row of result.recordset ?? []) {
      const id = String(row.aggregate_id);
      if (!byAggregate.has(id)) byAggregate.set(id, []);
      let key; try { key = JSON.parse(row.entity_id); } catch { key = { id: row.entity_id }; }
      byAggregate.get(id).push({ ...row, key });
    }
    return [...byAggregate.entries()].map(([aggregateId, changes]) => ({ aggregateId, changes }));
  }
  async protectedIntent(aggregateId,branchId) {
    const intent=await this.intents.get(aggregateId,branchId);
    if(!intent||this.financialBases?.enabled!==true)return intent;
    const financial=await this.financialBases.get(recordId(aggregateId),branchId);
    return financial?{...intent,...financial}:intent;
  }
  async financialTransaction(work){
    const sql=this.connectionManager.sql(),tx=new sql.Transaction(this.connectionManager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{await this.financialOperations.schema(tx);const result=await work(tx);await tx.commit();return result;}catch(error){await tx.rollback().catch(()=>{});throw error;}
  }
  financialQuery(tx,statement,inputs={}){const request=new(this.connectionManager.sql().Request)(tx);for(const[k,v]of Object.entries(inputs))request.input(k,v);return request.query(statement);}
  async financialOpening(aggregateId,branchId,terminalId){
    if(this.financialOperations?.enabled!==true)return null;
    const rows=await this.financialTransaction(async tx=>(await this.financialQuery(tx,"SELECT opening_payload_json,opening_payload_hash,proof_json FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND local_aggregate_id=@aggregate AND terminal_id=@terminal AND JSON_VALUE(CASE WHEN ISJSON(proof_json)=1 THEN proof_json ELSE N'{}' END,'$.action')='OPEN';",{branch:branchId,aggregate:aggregateId,terminal:terminalId})).recordset??[]);
    if(rows.length>1)throw Object.assign(new Error('One exact opening is required.'),{code:'EFINANCIAL_HISTORY_INVALID'});
    if(!rows.length)return null;const row=rows[0];if(createHash('sha256').update(row.opening_payload_json,'utf8').digest('hex')!==row.opening_payload_hash)throw Object.assign(new Error('The frozen opening changed.'),{code:'EFINANCIAL_HISTORY_INVALID'});
    return prepareFinancialOpening({openingJson:row.opening_payload_json,proof:JSON.parse(row.proof_json)},branchId,terminalId);
  }
  async financialHistory(branchId,terminalId,limit=100){
    if(this.financialOperations?.enabled!==true)return [];
    const rows=await this.financialTransaction(async tx=>(await this.financialQuery(tx,`SELECT TOP (@limit) e.*,f.computed_merged_hash,f.pending_from_hash,CONVERT(nvarchar(30),e.sequence) sequence_text FROM dbo.pos_sync_shift_financial_events e
      LEFT JOIN dbo.pos_sync_shift_financial_refreshes f ON f.branch_id=e.branch_id AND f.shift_id=e.shift_id AND f.terminal_id=e.terminal_id AND f.operation_id=e.operation_id
      JOIN dbo.pos_sync_shift_financial_origins o ON o.branch_id=e.branch_id AND o.shift_id=e.shift_id AND o.terminal_id=e.terminal_id
      WHERE e.branch_id=@branch AND e.terminal_id=@terminal AND
       (JSON_VALUE(e.payload_json,'$.cloudOrigin.serverBasisId') IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.local_operation_receipts r WHERE r.operation_type=N'financial_history_opened' AND r.entity_id=CONVERT(nvarchar(36),o.local_aggregate_id) AND r.note COLLATE Latin1_General_100_BIN2=o.opening_payload_hash COLLATE Latin1_General_100_BIN2+N':'+o.terminal_id))
       AND NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts r WHERE r.operation_type=N'financial_history_registered' AND r.entity_id=CONVERT(nvarchar(36),e.shift_id)+N':'+CONVERT(nvarchar(36),e.operation_id) AND r.note COLLATE Latin1_General_100_BIN2=e.payload_hash COLLATE Latin1_General_100_BIN2+N':'+e.terminal_id)
      ORDER BY e.shift_id,e.sequence;`,{branch:branchId,terminal:terminalId,limit:Math.max(1,Math.min(100,Number(limit)||100))})).recordset??[]);
    const items=[];
    for(const row of rows){const item={kind:row.event_kind,branchId:row.branch_id,terminalId:row.terminal_id,shiftId:String(row.shift_id).toLowerCase(),operationId:String(row.operation_id).toLowerCase(),sequence:row.sequence_text,payloadJson:row.payload_json,payloadHash:row.payload_hash,proof:JSON.parse(row.proof_json)};
      if(item.kind==='OBSERVE'){item.computedMergedHash=row.computed_merged_hash;item.pendingFromHash=row.pending_from_hash;}
      if(item.kind==='CLOSING')item.intent=await this.protectedIntent(item.operationId,branchId);
      items.push(prepareFinancialHistory(item,branchId,terminalId));
    }return items;
  }
  async financialAggregateRequired(aggregateId,branchId,terminalId){
    if(this.financialOperations?.enabled!==true)return false;
    return this.financialTransaction(async tx=>Boolean((await this.financialQuery(tx,`SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_events WHERE operation_id=@aggregate AND branch_id=@branch AND terminal_id=@terminal)
      OR EXISTS(SELECT 1 FROM dbo.sync_change_journal j JOIN dbo.pos_sync_shift_financial_sale_lineage l ON l.sale_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id')) WHERE j.aggregate_id=@aggregate AND j.entity_type=N'sales' AND l.branch_id=@branch) OR EXISTS(SELECT 1 FROM dbo.sync_change_journal j JOIN dbo.pos_sync_shift_financial_observations o ON o.sale_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id')) WHERE j.aggregate_id=@aggregate AND j.entity_type=N'sales' AND o.branch_id=@branch AND o.terminal_id=@terminal) THEN 1 ELSE 0 END required;`,{aggregate:aggregateId,branch:branchId,terminal:terminalId})).recordset?.[0]?.required));
  }
  async financialHistoryReady(branchId,terminalId,{shiftId=null,aggregateId=null}={}){
    if(this.financialOperations?.enabled!==true)return true;
    return this.financialTransaction(async tx=>!(await this.financialQuery(tx,`SELECT TOP (1) e.operation_id FROM dbo.pos_sync_shift_financial_events e WHERE e.branch_id=@branch AND e.terminal_id=@terminal AND (@shift IS NULL OR e.shift_id=TRY_CONVERT(uniqueidentifier,@shift)) AND (@aggregate IS NULL OR e.shift_id IN(SELECT target.shift_id FROM dbo.pos_sync_shift_financial_events target WHERE target.branch_id=@branch AND target.terminal_id=@terminal AND target.operation_id=TRY_CONVERT(uniqueidentifier,@aggregate)) OR e.shift_id IN(SELECT l.shift_id FROM dbo.sync_change_journal j JOIN dbo.pos_sync_shift_financial_sale_lineage l ON l.sale_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id')) WHERE j.aggregate_id=TRY_CONVERT(uniqueidentifier,@aggregate) AND j.entity_type=N'sales' AND l.branch_id=@branch) OR e.shift_id IN(SELECT o.shift_id FROM dbo.sync_change_journal j JOIN dbo.pos_sync_shift_financial_observations o ON o.sale_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id')) WHERE j.aggregate_id=TRY_CONVERT(uniqueidentifier,@aggregate) AND j.entity_type=N'sales' AND o.branch_id=@branch AND o.terminal_id=@terminal)) AND NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts r WHERE r.operation_type=N'financial_history_registered' AND r.entity_id=CONVERT(nvarchar(36),e.shift_id)+N':'+CONVERT(nvarchar(36),e.operation_id) AND r.note COLLATE Latin1_General_100_BIN2=e.payload_hash COLLATE Latin1_General_100_BIN2+N':'+e.terminal_id);`,{branch:branchId,terminal:terminalId,shift:shiftId,aggregate:aggregateId})).recordset?.length);
  }
  async saveFinancialReceipt({type,entityId,payloadHash,terminalId},tx){
    const note=payloadHash+':'+terminalId;
    const operationId=stableUuid({domain:'retail-pos.financial-history-ack.v1',type,entityId,payloadHash,terminalId});
    const prior=(await this.financialQuery(tx,'SELECT operation_type,entity_id,note FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK) WHERE operation_id=@id;',{id:operationId})).recordset??[];
    if(prior.length){if(prior.length!==1||prior[0].operation_type!==type||prior[0].entity_id!==entityId||prior[0].note!==note)throw Object.assign(new Error('The metadata acknowledgement differs.'),{code:'EIDEMPOTENCY'});return;}
    await this.financialQuery(tx,'INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@id,@type,@entity,@hash);',{id:operationId,type,entity:entityId,hash:note});
  }
  async acknowledgeFinancialOpening(opening,ack,branchId,terminalId){
    const verified=prepareFinancialOpening(opening,branchId,terminalId);if(ack?.ok!==true)throw Object.assign(new Error('The opening was not accepted.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED'});
    return this.financialTransaction(tx=>this.saveFinancialReceipt({type:'financial_history_opened',entityId:verified.operationId,payloadHash:verified.payloadHash,terminalId},tx));
  }
  async acknowledgeFinancialHistory(item,ack){
    const verified=prepareFinancialHistory(item,item.branchId,item.terminalId);assertFinancialHistoryAcknowledgement(verified,ack);
    return this.financialTransaction(async tx=>{
      const rows=(await this.financialQuery(tx,'SELECT payload_hash,payload_json FROM dbo.pos_sync_shift_financial_events WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND operation_id=@operation;',{branch:item.branchId,shift:item.shiftId,terminal:item.terminalId,operation:item.operationId})).recordset??[];
      if(rows.length!==1||rows[0].payload_hash!==item.payloadHash||rows[0].payload_json!==item.payloadJson)throw Object.assign(new Error('The immutable event differs.'),{code:'EFINANCIAL_HISTORY_INVALID'});
      await this.saveFinancialReceipt({type:'financial_history_registered',entityId:item.shiftId+':'+item.operationId,payloadHash:item.payloadHash,terminalId:item.terminalId},tx);
    });
  }
  frozenOpeningRows(aggregateId,branchId) { return this.intents.openingRows(aggregateId,branchId); }
  protectedShiftIds(shiftIds,branchId) { return this.intents.hasIntents(shiftIds,branchId); }
  async predecessorAccepted(intent){
    if(!intent.predecessorIntentId)return true;
    const prior=await this.intents.get(intent.predecessorIntentId,intent.branchId);
    if(!prior || prior.payloadHash!==intent.predecessorIntentHash || prior.shiftId!==intent.shiftId)
      throw Object.assign(new Error("The saved closing predecessor has missing or changed facts."),{code:"EIDEMPOTENCY",table:"shifts"});
    return prior.acknowledged;
  }
  async shiftPrerequisites(intent){
    const initial=!intent.baseToken&&!intent.predecessorIntentId;
    for(const name of ["sales","sale_items","bookings","booking_items","booking_payments","payment_transactions","held_orders"]){
      const table=this.tables.get(name);if(!table)continue;
      const columns=new Set(table.columns.map(column=>column.sqlServerColumn));
      const parentScope=[columns.has("sale_id")?"EXISTS(SELECT 1 FROM dbo.sales parent WHERE parent.id=source.sale_id AND parent.store_id=@branch AND TRY_CONVERT(uniqueidentifier,parent.shift_id)=@shift)":null,
        columns.has("booking_id")?"EXISTS(SELECT 1 FROM dbo.bookings parent WHERE parent.id=source.booking_id AND parent.store_id=@branch AND TRY_CONVERT(uniqueidentifier,parent.shift_id)=@shift)":null].filter(Boolean).join(" OR ");
      const scope=["sales","bookings","held_orders"].includes(name)
        ? `source.store_id=@branch AND (TRY_CONVERT(uniqueidentifier,source.shift_id)=@shift${name==="held_orders"&&initial?" OR source.shift_id IS NULL":""})`
        : columns.has("shift_id")&&columns.has("store_id")
          ? `source.store_id=@branch AND (TRY_CONVERT(uniqueidentifier,source.shift_id)=@shift${parentScope?` OR (source.shift_id IS NULL AND (${parentScope}))`:""})`
          : parentScope;
      if(!scope)continue;
      const request=()=>this.connectionManager.pool.request().input("branch",intent.branchId).input("shift",intent.shiftId).input("entity",name);
      const pending=await request().query(`SELECT TOP(1) journal.change_id FROM dbo.sync_change_journal journal WHERE journal.branch_id=@branch AND journal.entity_type=@entity AND journal.acknowledged_at IS NULL
        AND (EXISTS(SELECT 1 FROM dbo.[${name}] source WHERE source.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id')) AND (${scope}))
          OR NOT EXISTS(SELECT 1 FROM dbo.[${name}] known WHERE known.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id'))));`);
      if(pending.recordset?.length)return false;
      const bounds=(await request().input("object",`dbo.${name}`).query(`SELECT (SELECT TOP(1) change_tracking_version FROM dbo.sync_checkpoints WHERE branch_id=@branch AND entity_type=@entity AND direction='push') checkpoint_version,
        CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object)) min_version,CHANGE_TRACKING_CURRENT_VERSION() current_version,
        CASE WHEN EXISTS(SELECT 1 FROM dbo.[${name}] source WHERE ${scope}) THEN 1 ELSE 0 END has_rows;`)).recordset?.[0];
      const since=Number(bounds?.checkpoint_version),valid=bounds?.checkpoint_version!=null&&bounds?.min_version!=null&&bounds?.current_version!=null&&Number.isSafeInteger(since)&&since>=Number(bounds.min_version)&&since<=Number(bounds.current_version);
      if(!valid){if(bounds?.has_rows)return false;continue;}
      const tracked=await request().input("since",since).query(`SELECT TOP(1) CT.id FROM CHANGETABLE(CHANGES dbo.[${name}],@since) CT LEFT JOIN dbo.[${name}] source ON source.id=CT.id
        WHERE (CT.SYS_CHANGE_CONTEXT IS NULL OR CT.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (CT.SYS_CHANGE_OPERATION='D' OR (${scope}));`);
      if(tracked.recordset?.length)return false;
    }
    return true;
  }
  acceptedShiftChanges(table,changes,branchId) { return this.intents.coveredChanges(table,changes,branchId); }
  financialCoverageBinding(branchId,terminalId){
    if(this.financialOperations?.enabled!==true||!this.financialCoverageSource)return null;
    const source=this.financialCoverageSource;source.assertSource();
    if(recordId(source.identity?.branchId)!==recordId(branchId)||recordId(source.identity?.terminalId)!==recordId(terminalId)||!source.identity?.databaseGuid||!source.identity?.projectOrigin||!source.identity?.backend||!source.identity?.activation||!source.identity?.profile)
      throw Object.assign(new Error('The financial row acknowledgement has a different database or device scope.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED',table:'shifts'});
    return source;
  }
  financialCoverageKey(table,row,source){
    const schemaHash=createHash('sha256').update(JSON.stringify(table.columns.map(c=>[c.sqlServerColumn,c.cloudColumn,c.sqlServerType,c.cloudType]))).digest('hex');
    const rowHash=createHash('sha256').update(JSON.stringify(table.columns.map(c=>[c.sqlServerColumn,String(c.cloudType).toLowerCase()==='uuid'?recordId(row[c.sqlServerColumn]):row[c.sqlServerColumn]]))).digest('hex');
    return{schemaHash,rowHash,id:stableUuid({domain:'retail-pos.financial-business-row-ack.v1',source:source.identity,table:table.cloudTable,id:recordId(row.id),schemaHash,rowHash}),entity:table.cloudTable+':'+recordId(row.id)};
  }
  financialBusinessWire(table,ordinary,physical,enabled){
    if(!enabled)return ordinary;
    const raw=value=>{
      if(isExactNumber(value)){
        if(typeof JSON.rawJSON!=='function')throw Object.assign(new Error('This installed runtime cannot preserve exact financial JSON numbers.'),{code:'EFINANCIAL_EXACT_TRANSPORT_UNAVAILABLE'});
        return JSON.rawJSON(value.raw);
      }
      if(Array.isArray(value))return value.map(raw);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,raw(item)]));
      return value;
    };
    const result={...ordinary};
    for(const column of table.columns){const type=String(column.cloudType).toLowerCase(),value=physical[column.sqlServerColumn];
      if(/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision|timestamp|date|time)/.test(type))result[column.cloudColumn]=value;
      else if((type==='jsonb'||type.endsWith('[]'))&&typeof value==='string'){
        try{result[column.cloudColumn]=raw(parseExactJson(value));}catch(error){if(table.cloudTable==='settings_scoped'&&column.cloudColumn==='value'&&error.code!=='EFINANCIAL_EXACT_TRANSPORT_UNAVAILABLE')continue;throw error;}
      }
    }
    return result;
  }
  async financialCoverageRows(tx,table,ids,branchId){
    const request=new(this.connectionManager.sql().Request)(tx).input('branch',branchId);
    const keys=ids.map((id,index)=>{request.input('coverage'+index,id);return '@coverage'+index;});
    const scope=table.scope==='branch'?rendererReadBranchPredicate(this.registry,table,'source'):null;
    return(await request.query(`SELECT ${projection(table)} FROM dbo.[${table.sqlServerTable}] source WITH(UPDLOCK,HOLDLOCK) WHERE source.id IN(${keys.join(',')})${scope?' AND ('+scope+')':''};`)).recordset??[];
  }
  async financialCoverageReceipts(tx,keys,lock=false){
    const request=new(this.connectionManager.sql().Request)(tx),ids=keys.map((key,index)=>{request.input('receipt'+index,key.id);return '@receipt'+index;});
    const rows=(await request.query(`SELECT operation_id,operation_type,entity_id,note FROM dbo.local_operation_receipts${lock?' WITH(UPDLOCK,HOLDLOCK)':''} WHERE operation_id IN(${ids.join(',')});`)).recordset??[];
    return new Map(rows.map(row=>[recordId(row.operation_id),row]));
  }
  prepareFinancialBusinessCoverage({operations,batchId,branchId,terminalId}){
    const source=this.financialCoverageBinding(branchId,terminalId);if(!source)return null;
    const keys=[];
    for(const operation of operations){if(operation.deletePhase||SHIFT_GRAPH_TABLES.includes(operation.table))continue;for(const row of operation.rows??[]){
      const captureId=operation.table+':'+recordId(row.id)+':'+createHash('sha256').update(JSON.stringify(row)).digest('hex'),capture=this.financialCoverageCaptures.get(captureId);
      this.financialCoverageCaptures.delete(captureId);if(capture&&!capture.ambiguous)keys.push(capture.key);
    }}
    const token=Object.freeze({});this.financialCoverageTokens.set(token,{source,batchId:recordId(batchId),branchId,terminalId,keys,payloadHash:createHash('sha256').update(JSON.stringify(operations)).digest('hex')});return token;
  }
  async acknowledgeFinancialBusinessRows({token,operations,batchId,acknowledgement,branchId,terminalId}){
    if(token==null)return;const evidence=this.financialCoverageTokens.get(token);
    if(!evidence||evidence.batchId!==recordId(batchId)||evidence.branchId!==branchId||evidence.terminalId!==terminalId||evidence.payloadHash!==createHash('sha256').update(JSON.stringify(operations)).digest('hex')||acknowledgement?.ok!==true||recordId(acknowledgement.batch_id)!==recordId(batchId))
      throw Object.assign(new Error('The financial business upload was not acknowledged for its exact captured batch.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED',table:'shifts'});
    evidence.source.assertSource();
    await this.financialTransaction(async tx=>{
      const all=[...new Map(evidence.keys.map(key=>[key.id,key])).values()];
      for(let start=0;start<all.length;start+=100){
        const keys=all.slice(start,start+100),receipts=await this.financialCoverageReceipts(tx,keys,true),missing=[];
        for(const key of keys){const note=key.rowHash+':'+key.schemaHash+':'+recordId(batchId),prior=receipts.get(key.id);
          if(prior){if(prior.operation_type!=='financial_business_row_accepted'||prior.entity_id!==key.entity||!String(prior.note).startsWith(key.rowHash+':'+key.schemaHash+':')||!UUID.test(String(prior.note).slice(130)))throw Object.assign(new Error('A financial row receipt has conflicting saved evidence.'),{code:'EIDEMPOTENCY'});}
          else missing.push({id:key.id,entity:key.entity,note});
        }
        if(missing.length)await this.financialQuery(tx,"INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) SELECT CONVERT(uniqueidentifier,id),N'financial_business_row_accepted',entity,note FROM OPENJSON(@rows) WITH(id nvarchar(36),entity nvarchar(128),note nvarchar(400));",{rows:JSON.stringify(missing)});
      }
      evidence.source.assertSource();
    });this.financialCoverageTokens.delete(token);
  }
  async acceptedFinancialBusinessChanges(value,changes,branchId,terminalId){
    const source=this.financialCoverageBinding(branchId,terminalId),covered=new Set();if(!source||SHIFT_GRAPH_TABLES.includes(value.cloudTable))return covered;
    const {table,primary}=this.table(value);if(primary.length!==1||primary[0]!=='id')return covered;
    const ids=changes.filter(change=>change.operation!=='D'&&UUID.test(recordId(change.key?.id))).map(change=>recordId(change.key.id));if(!ids.length)return covered;
    await this.financialTransaction(async tx=>{for(let start=0;start<ids.length;start+=100){
      const rows=await this.financialCoverageRows(tx,table,ids.slice(start,start+100),branchId),keys=rows.map(row=>this.financialCoverageKey(table,row,source));if(!keys.length)continue;
      const receipts=await this.financialCoverageReceipts(tx,keys);
      for(let index=0;index<keys.length;index++){const key=keys[index],prior=receipts.get(key.id);
        if(prior?.operation_type==='financial_business_row_accepted'&&prior.entity_id===key.entity&&String(prior.note).startsWith(key.rowHash+':'+key.schemaHash+':')&&UUID.test(String(prior.note).slice(130)))covered.add(recordId(rows[index].id));
      }
    }source.assertSource();});return covered;
  }
  async acknowledgeProtectedIntent(intent,proof) {
    const sql=this.connectionManager.sql(),transaction=new sql.Transaction(this.connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      // Use the same parent-first ownership as protected commits/downloads.
      await new sql.Request(transaction).input("shift",intent.shiftId).input("branch",intent.branchId)
        .query("SELECT id FROM dbo.[shifts] WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;");
      await this.intents.acknowledge(transaction,intent,proof);
      await new sql.Request(transaction).input("aggregate",intent.intentId).input("branch",intent.branchId)
        .query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL WHERE aggregate_id=@aggregate AND branch_id=@branch AND acknowledged_at IS NULL;");
      await transaction.commit();
    }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
  }
  async acknowledgeAggregate(aggregateId) {
    await this.connectionManager.pool.request().input("aggregate", aggregateId).query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL WHERE aggregate_id=@aggregate AND acknowledged_at IS NULL;");
  }
  async failAggregate(aggregateId, error) {
    await this.connectionManager.pool.request().input("aggregate", aggregateId).input("error", String(error?.message ?? error).slice(0, 1000)).query("UPDATE dbo.sync_change_journal SET retry_count=retry_count+1,last_error=@error WHERE aggregate_id=@aggregate AND acknowledged_at IS NULL;");
  }
  async pendingSummary(branchId) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).query(`SELECT
      entity_type,
      SUM(CASE WHEN last_error IS NULL THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) failed,
      MAX(last_error) last_error
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL
      GROUP BY entity_type;`);
    const queuedTables = (result.recordset ?? []).map(row => ({
      table: row.entity_type, pending:Number(row.pending ?? 0), failed:Number(row.failed ?? 0), error:row.last_error ?? null,
    }));
    return { pending:queuedTables.reduce((sum,row)=>sum+row.pending,0), failed:queuedTables.reduce((sum,row)=>sum+row.failed,0), queuedTables };
  }
  async failedAggregates(branchId, limit = 100) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).input("limit", Math.max(1, Math.min(500, limit))).query(`SELECT TOP (@limit)
      aggregate_id,MAX(entity_type) entity_type,MAX(retry_count) attempts,MAX(last_error) error,
      MIN(created_at) created_at,MAX(created_at) last_attempt_at,COUNT_BIG(*) rows
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL AND last_error IS NOT NULL AND aggregate_id IS NOT NULL
      GROUP BY aggregate_id ORDER BY MAX(created_at) DESC;`);
    return result.recordset ?? [];
  }
  exactShiftGraphNoop(transaction,branchId,graph){
    return this.exactGraphChecks.get(transaction)?.get(recordId(String(branchId))+":"+recordId(graph?.shiftId))?.graph===graph && Boolean(exactGraph(graph,branchId,graph?.shiftId));
  }
  exactShiftFingerprint(transaction,branchId,graph){
    return this.exactShiftGraphNoop(transaction,branchId,graph)?this.exactGraphChecks.get(transaction).get(recordId(String(branchId))+":"+recordId(graph.shiftId)).fingerprint:null;
  }
  async proveExactShiftGraph(query,branch,shift,incomingGraph){
    const remote=exactGraph(incomingGraph,branch,shift);
    if(!remote||!Array.isArray(remote.tables)||remote.tables.length!==SHIFT_GRAPH_TABLES.length)return false;
    const seen=new Set(),collected=[];let total=0;
    for(const name of SHIFT_GRAPH_TABLES){
      const parts=remote.tables.filter(part=>part.table===name);
      if(parts.length!==1||!Array.isArray(parts[0].rows))return false;
      const table=this.tables.get(name);if(!table)return false;
      const local=(await query(`SELECT TOP(2001) ${projection(table)} FROM dbo.[${name}] source WITH(UPDLOCK,HOLDLOCK)
        WHERE ${name==='shifts'?'id':'shift_id'}=@shift ORDER BY id;`,{shift})).recordset??[];
      total+=local.length;if(total>2000)return false;
      if(local.some(row=>recordId(String(row.store_id))!==branch)||parts[0].rows.some(row=>recordId(row.store_id)!==branch||recordId(name==='shifts'?row.id:row.shift_id)!==shift))return false;
      if(!exactRows(table,local,parts[0].rows))return false;seen.add(name);collected.push({table:name,rows:local});
    }
    const unaccepted=await query('SELECT TOP(1) intent_id FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND acknowledged_at IS NULL;',{branch,shift});
    return seen.size===SHIFT_GRAPH_TABLES.length&&!unaccepted.recordset?.length?createHash('sha256').update(JSON.stringify(collected)).digest('hex'):false;
  }
  async pendingShiftGraph(table, entityIds, transaction, { branchId, changes = [], incomingGraph, requireExact = false } = {}) {
    if (!SHIFT_GRAPH_TABLES.includes(table.cloudTable)) return false;
    const branch = recordId(String(branchId ?? "").trim());
    if (!transaction || !branch || branch.length > 128)
      throw Object.assign(new Error("A verified branch and transaction are required to protect local closing changes."), { code: "EBRANCH", table: table.cloudTable });
    const parseId = key => { try { return recordId(String(JSON.parse(key).id ?? "")); } catch { return ""; } };
    const ids = [...new Set(entityIds.map(parseId))];
    if (!ids.length || ids.length > 2000 || ids.some(id => !UUID.test(id)))
      throw Object.assign(new Error("The closing download has an invalid entity key."), { code: "ESYNC_ENTITY", table: table.cloudTable });
    const sql = this.connectionManager.sql();
    const query = (statement, inputs = {}) => {
      const request = new sql.Request(transaction);
      for (const [name, data] of Object.entries(inputs)) request.input(name, data);
      return request.query(statement);
    };
    // Discover child parents without retaining a child lock before its parent.
    // Revalidate after acquiring the whole graph in parent-first order below.
    const requested = table.cloudTable === "shifts" ? { recordset: [] } : await new sql.Request(this.connectionManager.pool)
      .input("ids", JSON.stringify(ids)).query(`SELECT id,store_id,shift_id FROM dbo.[${table.sqlServerTable}]
      WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`);
    const local = requested.recordset ?? [];
    if (local.some(row => recordId(String(row.store_id ?? "")) !== branch) ||
        changes.some(change => change.row_data && recordId(String(change.row_data.store_id ?? "")) !== branch))
      throw Object.assign(new Error("The closing download does not belong to the verified branch."), { code: "SYNC_BRANCH_FORBIDDEN", table: table.cloudTable });
    const shiftIds = [...new Set(table.cloudTable === "shifts" ? ids :
      [...local.map(row => row.shift_id), ...changes.map(change => change.row_data?.shift_id)].filter(Boolean).map(id => recordId(String(id))))].sort();
    // An absent child tombstone cannot reveal its former parent. Do not infer
    // that an unknown closing history has no pending local work.
    if (shiftIds.some(id => !UUID.test(id))) return true;
    const checked = this.pendingGraphChecks.get(transaction);
    if (!requireExact && !incomingGraph && shiftIds.length && checked?.branch === branch && shiftIds.every(id => checked.shifts.has(id))) return false;
    const graph = new Map();
    let matchedExpired=false;
    let total = 0;
    for (const name of SHIFT_GRAPH_TABLES) {
      const rows = (await query(`SELECT TOP (2001) id,store_id${name === "shifts" ? "" : ",shift_id"} FROM dbo.[${name}] WITH (UPDLOCK,HOLDLOCK)
        WHERE ${name === "shifts" ? "id" : "shift_id"} IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@shifts)) ORDER BY id;`,
      { shifts: JSON.stringify(shiftIds) })).recordset ?? [];
      total += rows.length;
      if (total > 2000) return true;
      if (rows.some(row => recordId(String(row.store_id ?? "")) !== branch))
        throw Object.assign(new Error("The saved closing graph crosses the verified branch."), { code: "SYNC_BRANCH_FORBIDDEN", table: name });
      graph.set(name, new Set(rows.map(row => recordId(String(row.id)))));
    }
    if (table.cloudTable !== "shifts") {
      const revalidated = (await query(`SELECT id,store_id,shift_id FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK)
        WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`, { ids: JSON.stringify(ids) })).recordset ?? [];
      if (revalidated.some(row => !shiftIds.includes(recordId(String(row.shift_id))) || recordId(String(row.store_id)) !== branch)) return true;
    }
    for (const name of SHIFT_GRAPH_TABLES) {
      const keys = new Set(graph.get(name));
      if (name === table.cloudTable) ids.forEach(id => keys.add(id));
      const inputs = { branch, entity: name, ids: JSON.stringify([...keys]) };
      // Unknown/deleted journal keys cannot safely be attributed to a former
      // shift from a key-only journal. Keep the queue and defer the download.
      const journal = await query(`SELECT TOP (1) journal.entity_id FROM dbo.sync_change_journal journal WITH (UPDLOCK,HOLDLOCK)
        WHERE journal.entity_type=@entity AND journal.branch_id IN (@branch,'global') AND journal.acknowledged_at IS NULL
        AND (TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id')) IN
          (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids)) OR NOT EXISTS
          (SELECT 1 FROM dbo.[${name}] saved WHERE saved.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id'))));`, inputs);
      if (journal.recordset?.length) return true;
      const bounds = (await query(`SELECT (SELECT TOP (1) change_tracking_version FROM dbo.sync_checkpoints WITH (UPDLOCK,HOLDLOCK)
        WHERE branch_id=@branch AND entity_type=@entity AND direction='push') AS checkpoint_version,
        CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object)) AS min_version, CHANGE_TRACKING_CURRENT_VERSION() AS current_version;`,
      { branch, entity: name, object: `dbo.${name}` })).recordset?.[0];
      const since = Number(bounds?.checkpoint_version);
      const valid = bounds?.checkpoint_version != null && bounds?.min_version != null && bounds?.current_version != null &&
        Number.isSafeInteger(since) && since >= Number(bounds.min_version) && since <= Number(bounds.current_version);
      // Missing/expired CT evidence is not proof of no local edits. A fresh
      // empty graph may bootstrap without inventing a checkpoint.
      if (!valid) {
        if (graph.get(name).size) {
          if(!matchedExpired && shiftIds.length===1 && incomingGraph)matchedExpired=await this.proveExactShiftGraph(query,branch,shiftIds[0],incomingGraph);
          if(!matchedExpired)throw Object.assign(new Error("Local closing Change Tracking history is missing or expired. Retained local work must be reviewed before this download can advance."),
            { code: "ELOCAL_PENDING_UNVERIFIED", table: name });
        }
        continue;
      }
      const tracked = await query(`SELECT TOP (2001) CT.id, CT.SYS_CHANGE_OPERATION AS operation FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT
        WHERE (CT.SYS_CHANGE_CONTEXT IS NULL OR CT.SYS_CHANGE_CONTEXT<>0x434C4F5544)
        AND (CT.id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids)) OR CT.SYS_CHANGE_OPERATION='D');`,
      { since, ids: JSON.stringify([...keys]) });
      const trackedRows=tracked.recordset??[];
      const covered=trackedRows.length<=2000 ? await this.intents.coveredChanges(this.tables.get(name),trackedRows,branch,transaction) : new Set();
      if (trackedRows.some(row=>!covered.has(recordId(String(row.id))))) throw Object.assign(new Error("A local closing Change Tracking edit is still beyond its upload checkpoint. Upload or resolve it before retrying this cloud page."),
        { code: "ELOCAL_CT_PENDING", table: name });
    }
    if(requireExact&&!matchedExpired){
      if(shiftIds.length===1&&incomingGraph)matchedExpired=await this.proveExactShiftGraph(query,branch,shiftIds[0],incomingGraph);
      if(!matchedExpired)throw Object.assign(new Error("A retained closing graph no longer exactly matches the verified cloud snapshot."),{code:"ELOCAL_PENDING_UNVERIFIED",table:table.cloudTable});
    }
    if (!matchedExpired && shiftIds.length) this.pendingGraphChecks.set(transaction, { branch, shifts: new Set([
      ...(checked?.branch === branch ? checked.shifts : []), ...shiftIds,
    ]) });
    if(matchedExpired){let proofs=this.exactGraphChecks.get(transaction);if(!proofs){proofs=new Map();this.exactGraphChecks.set(transaction,proofs);}proofs.set(branch+":"+shiftIds[0],{graph:incomingGraph,fingerprint:matchedExpired});}
    return false;
  }
  async unacknowledged(value, entityIds, transaction, options) {
    const { table } = this.table(value);
    if (!entityIds.length) return new Set();
    if (SHIFT_GRAPH_TABLES.includes(table.cloudTable))
      return new Set(await this.pendingShiftGraph(table, entityIds, transaction, options) ? entityIds : []);
    const request = transaction ? new (this.connectionManager.sql().Request)(transaction) : this.connectionManager.pool.request();
    request.input("entity", table.sqlServerTable);
    const params = entityIds.map((id, index) => { request.input(`id${index}`, id); return `@id${index}`; });
    const result = await request.query(`SELECT entity_id FROM dbo.sync_change_journal WHERE entity_type=@entity AND acknowledged_at IS NULL AND entity_id IN (${params.join(",")});`);
    return new Set((result.recordset ?? []).map((row) => row.entity_id));
  }
}
module.exports = { ChangeReader };
