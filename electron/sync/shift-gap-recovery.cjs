// Whole-branch retained-graph coverage for the existing scoped snapshot path.
// In-memory only: no repair, queue acknowledgement or checkpoint reset.
const {createHash}=require('node:crypto');
const {recordId}=require('./uuid-fields.cjs');
const {projection}=require('./shift-recovery-exact.cjs');
const {prepareShiftGraphs,applyShiftGraphs}=require('./shift-graph.cjs');
const {scope}=require('./history-recovery.cjs');
const TABLES=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
const LIMIT=20000;
const fail=(message,code='ELOCAL_PENDING_UNVERIFIED')=>{throw Object.assign(new Error(message),{code,table:'shifts'});};
const version=value=>{const text=String(value??'');if(!/^(0|[1-9]\d*)$/.test(text)||BigInt(text)>9223372036854775807n||typeof value==='number'&&!Number.isSafeInteger(value))fail('The closing recovery version cannot be proved.');return text;};
class ShiftGapRecovery {
  constructor({connectionManager,registry,reader,checkpoints,branchId,tableName,cloud,historyDays=90}){
    Object.assign(this,{connectionManager,registry,reader,checkpoints,branchId:recordId(branchId),tableName,cloud,historyDays});this.covered=new Map();this.pages=new WeakMap();
    this.pool=connectionManager.pool;this.authority=this.identity();
  }
  identity(){return JSON.stringify(scope(this.cloud,this.branchId,this.historyDays));}
  assertScope(){if(this.connectionManager.pool!==this.pool||this.identity()!==this.authority)fail('The registered terminal, backend or SQL profile changed during closing recovery.','SYNC_BRANCH_FORBIDDEN');}
  query(transaction,text,inputs={}){const req=new (this.connectionManager.sql().Request)(transaction);for(const[k,v]of Object.entries(inputs))req.input(k,v);return req.query(text);}
  async atomic(work){this.assertScope();const sql=this.connectionManager.sql(),tx=new sql.Transaction(this.connectionManager.pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);try{const value=await work(tx);await tx.commit();return value;}catch(error){await Promise.resolve(tx.rollback()).catch(()=>{});throw error;}}
  async bounds(tx){const result=await this.query(tx,`SELECT names.[value] table_name,
    CONVERT(nvarchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(QUOTENAME('dbo')+'.'+QUOTENAME(names.[value])))) minimum_version,
    CONVERT(nvarchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version FROM OPENJSON(@tables) names;`,{tables:JSON.stringify(TABLES)});
    const rows=result.recordset??[];if(rows.length!==TABLES.length||new Set(rows.map(r=>r.table_name)).size!==TABLES.length)fail('The complete closing recovery tables are unavailable.');
    for(const row of rows){if(!TABLES.includes(row.table_name)||BigInt(version(row.minimum_version))>BigInt(version(row.current_version)))fail('The closing recovery bounds changed.');}
    return rows;
  }
  async pending(tx){
    const result=await this.query(tx,`SELECT TOP(1) entity_id FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK)
      WHERE entity_type IN(SELECT [value] FROM OPENJSON(@tables)) AND branch_id IN(@branch,'global') AND acknowledged_at IS NULL;`,{tables:JSON.stringify(TABLES),branch:this.branchId});
    if(result.recordset?.length)fail('Pending or unattributed closing journal work must be retained.','ELOCAL_UPLOAD_PENDING');
    const intents=await this.query(tx,'SELECT TOP(1) intent_id FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND acknowledged_at IS NULL;',{branch:this.branchId});
    if(intents.recordset?.length)fail('A protected closing intent remains pending.','ELOCAL_UPLOAD_PENDING');
  }
  async identities(tx){
    const rows=[];
    for(const name of TABLES){const result=await this.query(tx,`SELECT TOP(${LIMIT+1}) id,store_id,${name==='shifts'?'id':'shift_id'} AS shift_id
      FROM dbo.[${name}] WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch OR store_id IS NULL OR store_id IN('','global')
      ${name==='shifts'?'':`OR shift_id IN(SELECT id FROM dbo.shifts WHERE store_id=@branch)`} ORDER BY id;`,{branch:this.branchId});
      for(const row of result.recordset??[]){if(recordId(row.store_id)!==this.branchId)fail('A retained closing row has no verified branch.','SYNC_BRANCH_FORBIDDEN');rows.push({...row,table_name:name});}
      if(rows.length>LIMIT)fail('Retained closing history exceeds the bounded recovery proof.','EOVERSIZED');
    }
    const parents=new Set(rows.filter(r=>r.table_name==='shifts').map(r=>recordId(r.id)));
    if(rows.some(r=>!parents.has(recordId(r.shift_id))))fail('A retained closing child has no complete local parent.');
    return rows;
  }
  async begin(){return this.atomic(async tx=>{
    this.assertScope();
    await this.pending(tx);const bounds=await this.bounds(tx);this.baseline=version(bounds[0].current_version);
    if(bounds.some(r=>version(r.current_version)!==this.baseline))fail('Closing recovery did not capture one starting version.');
    this.initial=await this.identities(tx);
    this.retained=new Set(this.initial.filter(r=>r.table_name==='shifts').map(r=>recordId(r.id)));return this;
  });}
  requiresExact(shift){return this.retained.has(recordId(shift));}
  async prepareGraph(graph){this.assertScope();const proof=await this.reader.prepareReviewedShiftCoverage?.(graph,this.branchId);this.assertScope();return proof??null;}
  beforePage(prepared,rows,table){this.assertScope();for(const row of rows){const shift=recordId(table.cloudTable==='shifts'?row.id:row.shift_id);if(this.retained.has(shift)&&!prepared.graphs.has(shift))fail('A retained closing page has no fresh complete graph proof.');}}
  note(transaction,shiftId,graph){
    this.assertScope();
    const id=recordId(shiftId);if(!this.retained.has(id))return;
    const fingerprint=this.reader.exactShiftFingerprint(transaction,this.branchId,graph);if(!fingerprint)fail('Retained closing graph has no complete exact match.');
    let page=this.pages.get(transaction);if(!page){page=new Map();this.pages.set(transaction,page);}page.set(id,fingerprint);
  }
  committed(transaction){for(const[id,hash]of this.pages.get(transaction)??[])this.covered.set(id,hash);this.pages.delete(transaction);}
  async proveMissing(cloud){for(const id of [...this.retained].sort())if(!this.covered.has(id)){
    this.assertScope();
    const prepared=await prepareShiftGraphs({cloud,connectionManager:this.connectionManager,branchId:this.branchId,
      changes:[{table_name:'shifts',entity_id:JSON.stringify({id}),tombstone:false}],recovery:this});
    let tx;await this.atomic(async transaction=>{tx=transaction;await applyShiftGraphs({transaction,connectionManager:this.connectionManager,registry:this.registry,reader:this.reader,branchId:this.branchId,prepared,recovery:this});});
    this.committed(tx);
  }}
  async fingerprint(tx,shift){const parts=[];for(const name of TABLES){const table=this.registry.tables.find(t=>t.cloudTable===name);if(!table)fail('A closing table is not registered.');const result=await this.query(tx,`SELECT TOP(2001) ${projection(table)} FROM dbo.[${name}] source WITH(UPDLOCK,HOLDLOCK) WHERE ${name==='shifts'?'id':'shift_id'}=@shift ORDER BY id;`,{shift});parts.push({table:name,rows:result.recordset??[]});}return createHash('sha256').update(JSON.stringify(parts)).digest('hex');}
  async finish(){return this.atomic(async tx=>{
    this.assertScope();
    if([...this.retained].some(id=>!this.covered.has(id)))fail('The scoped cloud snapshot did not prove every retained local shift.');
    await this.pending(tx);const bounds=await this.bounds(tx);for(const row of bounds)if(BigInt(this.baseline)<BigInt(version(row.minimum_version))||BigInt(this.baseline)>BigInt(version(row.current_version)))fail('Closing recovery starting history expired during download.');
    const final=await this.identities(tx);const finalKeys=new Set(final.map(r=>r.table_name+':'+recordId(r.id)));
    if(this.initial.some(r=>!finalKeys.has(r.table_name+':'+recordId(r.id))))fail('Retained closing history disappeared during recovery.');
    for(const shift of this.retained)if(await this.fingerprint(tx,shift)!==this.covered.get(shift))fail('A retained closing graph changed after its exact match.');
    for(const name of TABLES){const result=await this.query(tx,`DECLARE @baseline bigint=CONVERT(bigint,@since);
      SELECT TOP(${LIMIT+1}) CT.id,CT.SYS_CHANGE_OPERATION operation,CT.SYS_CHANGE_CONTEXT context,
      saved.store_id ${name==='shifts'?'':',saved.shift_id'} FROM CHANGETABLE(CHANGES dbo.[${name}],@baseline) CT
      LEFT JOIN dbo.[${name}] saved WITH(UPDLOCK,HOLDLOCK) ON saved.id=CT.id
      WHERE CT.SYS_CHANGE_OPERATION='D' OR saved.id IS NULL OR saved.store_id=@branch OR saved.store_id IS NULL OR saved.store_id IN('','global')
       ${name==='shifts'?'':`OR saved.shift_id IN(SELECT id FROM dbo.shifts WHERE store_id=@branch)`};`,{since:this.baseline,branch:this.branchId});
      const changed=result.recordset??[];if(changed.length>LIMIT||changed.some(r=>r.operation==='D'||!Buffer.isBuffer(r.context)||!r.context.equals(Buffer.from('CLOUD'))))fail('Concurrent or unattributed closing work must remain pending.','ELOCAL_CT_PENDING');
    }
    // Preserve >V0 work for the ordinary next pass; never jump to current CT.
    this.assertScope();
    await this.checkpoints.advanceRecovery(this.branchId,this.tableName,this.baseline,tx);
    return {currentVersion:this.baseline,retainedShifts:this.retained.size};
  });}
}
module.exports={ShiftGapRecovery,TABLES};
