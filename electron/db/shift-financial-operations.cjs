// FIN62 preparation only. Explicitly disabled by default; no IPC or activation.
const crypto=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {normalizeFinancialAttestation}=require('../security/financial-author-protocol.cjs');
const {normalizeOpeningFinancialBasisAttestation,normalizeFinancialBasisAttestation}=require('../security/shift-financial-protocol.cjs');
const tokens=new WeakMap(),contexts=new WeakMap();
const {parseExactJson,isExactNumber}=require('../sync/shift-recovery-exact.cjs');
const {calculateKnownTenderTotals,exactFinancialDecimalKey}=require('../sync/shift-financial-math.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const TABLES=['pos_sync_shift_financial_origins','pos_sync_shift_financial_heads','pos_sync_shift_financial_events','pos_sync_shift_financial_sale_lineage','pos_sync_shift_financial_observations','pos_sync_shift_financial_versions','pos_sync_shift_financial_refreshes','pos_sync_shift_financial_noops'];
// Preserve SQL string literals AND grouping; neither case-fold nor erase
// parentheses inside checks. Expectations are the exact reviewed 026 metadata.
const normalizeSql=value=>typeof value==='string'?value.split(/('(?:''|[^'])*')/g).map((part,index)=>index%2?part:part.toLowerCase().replace(/\[([a-z_]+)\]/g,'$1').replace(/\s/g,'')).join(''):null;
const EXPECTED_TRIGGERS={"pos_sync_shift_financial_versions_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_versions_immutable ON dbo.pos_sync_shift_financial_versions AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial versions are immutable.',1; END;", "pos_sync_shift_financial_refreshes_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_refreshes_immutable ON dbo.pos_sync_shift_financial_refreshes AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial refreshes are immutable.',1; END;", "pos_sync_shift_financial_observations_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_observations_immutable ON dbo.pos_sync_shift_financial_observations AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial observations are immutable.',1; END;", "pos_sync_shift_financial_origins_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_origins_immutable ON dbo.pos_sync_shift_financial_origins AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial origins are immutable.',1; END;", "pos_sync_shift_financial_events_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_events_immutable ON dbo.pos_sync_shift_financial_events AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial events are immutable.',1; END;", "pos_sync_shift_financial_sale_lineage_immutable": "CREATE TRIGGER dbo.pos_sync_shift_financial_sale_lineage_immutable ON dbo.pos_sync_shift_financial_sale_lineage AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial sale lineage is immutable.',1; END;", "pos_sync_shift_financial_heads_guard": "CREATE TRIGGER dbo.pos_sync_shift_financial_heads_guard ON dbo.pos_sync_shift_financial_heads AFTER INSERT,UPDATE,DELETE AS BEGIN\n SET NOCOUNT ON;\n IF EXISTS(SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.branch_id=d.branch_id AND i.shift_id=d.shift_id AND i.terminal_id=d.terminal_id WHERE i.shift_id IS NULL OR i.sequence<>d.sequence+1) THROW 51026,'Financial frontier cannot reset or skip.',1;\n IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins o WHERE o.branch_id=i.branch_id AND o.shift_id=i.shift_id AND o.terminal_id=i.terminal_id) OR (i.sequence=0 AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins o WHERE o.branch_id=i.branch_id AND o.shift_id=i.shift_id AND o.terminal_id=i.terminal_id AND ((o.origin_kind='OPEN' AND o.local_aggregate_id=i.operation_id AND o.row_hash=i.payload_hash) OR (o.origin_kind='CLOUD_BASIS' AND o.server_basis_id=i.operation_id AND o.server_basis_hash=i.payload_hash)))) OR (i.sequence>0 AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_events e WHERE e.branch_id=i.branch_id AND e.shift_id=i.shift_id AND e.terminal_id=i.terminal_id AND e.sequence=i.sequence AND e.operation_id=i.operation_id AND e.payload_hash=i.payload_hash))) THROW 51026,'Financial frontier has no immutable evidence.',1;\n END;"};
const EXPECTED_CHECKS={"CK_pos_sync_shift_financial_events_hash": "(datalength([payload_hash])=(64) AND NOT [payload_hash] like '%[^0-9a-f]%' AND datalength([predecessor_hash])=(64) AND NOT [predecessor_hash] like '%[^0-9a-f]%')", "CK_pos_sync_shift_financial_events_json": "(isjson([payload_json])=(1) AND isjson([proof_json])=(1))", "CK_pos_sync_shift_financial_events_kind": "([event_kind]='MUTATION' AND ([action]='VOID' OR [action]='TENDER' OR [action]='REFUND' OR [action]='SALE') OR [event_kind]='CLOSING' AND ([action]='RECOUNT' OR [action]='ORIGINAL') OR [event_kind]='OBSERVE' AND [action]='OBSERVE')", "CK_pos_sync_shift_financial_events_sequence": "([sequence]>(0))", "CK_pos_sync_shift_financial_heads_hash": "(datalength([payload_hash])=(64) AND NOT [payload_hash] like '%[^0-9a-f]%')", "CK_pos_sync_shift_financial_heads_sequence": "([sequence]>=(0))", "CK_pos_sync_shift_financial_observations_hash": "(datalength([fact_hash])=(64) AND NOT [fact_hash] like '%[^0-9a-f]%')", "CK_pos_sync_shift_financial_observations_json": "(isjson([fact_json])=(1))", "CK_pos_sync_shift_financial_origins_hash": "(([row_hash] IS NULL OR datalength([row_hash])=(64) AND NOT [row_hash] like '%[^0-9a-f]%') AND ([opening_payload_hash] IS NULL OR datalength([opening_payload_hash])=(64) AND NOT [opening_payload_hash] like '%[^0-9a-f]%') AND ([server_basis_hash] IS NULL OR datalength([server_basis_hash])=(64) AND NOT [server_basis_hash] like '%[^0-9a-f]%') AND ([local_snapshot_hash] IS NULL OR datalength([local_snapshot_hash])=(64) AND NOT [local_snapshot_hash] like '%[^0-9a-f]%'))", "CK_pos_sync_shift_financial_origins_json": "([origin_kind]='OPEN' AND isjson([opening_payload_json])=(1) AND isjson([proof_json])=(1) OR [origin_kind]='CLOUD_BASIS' AND isjson([server_basis_json])=(1) AND isjson([ct_witness_json])=(1))", "CK_pos_sync_shift_financial_origins_shape": "([origin_kind]='OPEN' AND [local_aggregate_id] IS NOT NULL AND [row_hash] IS NOT NULL AND [opening_payload_json] IS NOT NULL AND [opening_payload_hash] IS NOT NULL AND [proof_json] IS NOT NULL AND [server_basis_id] IS NULL AND [server_basis_hash] IS NULL AND [server_basis_json] IS NULL AND [local_snapshot_hash] IS NULL AND [ct_witness_json] IS NULL OR [origin_kind]='CLOUD_BASIS' AND [local_aggregate_id] IS NULL AND [row_hash] IS NULL AND [opening_payload_json] IS NULL AND [opening_payload_hash] IS NULL AND [proof_json] IS NULL AND [server_basis_id] IS NOT NULL AND [server_basis_hash] IS NOT NULL AND [server_basis_json] IS NOT NULL AND [local_snapshot_hash] IS NOT NULL AND [ct_witness_json] IS NOT NULL)", "CK_pos_sync_shift_financial_origins_version": "([origin_kind]='OPEN' AND [origin_version]=(1) OR [origin_kind]='CLOUD_BASIS' AND [origin_version]=(2))", "CK_pos_sync_shift_financial_refreshes_hash": "(datalength([server_basis_hash])=(64) AND NOT [server_basis_hash] like '%[^0-9a-f]%' AND datalength([computed_merged_hash])=(64) AND NOT [computed_merged_hash] like '%[^0-9a-f]%' AND datalength([pending_from_hash])=(64) AND NOT [pending_from_hash] like '%[^0-9a-f]%')", "CK_pos_sync_shift_financial_refreshes_json": "(isjson([server_basis_json])=(1) AND isjson([source_evidence_json])=(1) AND isjson([publication_json])=(1) AND isjson([pending_from_json])=(1) AND isjson([merged_facts_json])=(1) AND isjson([ct_witness_json])=(1))", "CK_pos_sync_shift_financial_refreshes_sequence": "([sequence]>(0))", "CK_pos_sync_shift_financial_versions_hash": "(datalength([fact_hash])=(64) AND NOT [fact_hash] like '%[^0-9a-f]%')", "CK_pos_sync_shift_financial_versions_json": "([fact_json] IS NULL OR isjson([fact_json])=(1))", "CK_pos_sync_shift_financial_versions_kind": "(([version_side]='OBSERVED' OR [version_side]='AFTER' OR [version_side]='BEFORE') AND [sequence]>=(0) AND ([sequence]>(0) OR [version_side]='OBSERVED'))"};
EXPECTED_TRIGGERS.pos_sync_shift_financial_noops_immutable="CREATE TRIGGER dbo.pos_sync_shift_financial_noops_immutable ON dbo.pos_sync_shift_financial_noops AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,'Financial no-op captures are immutable.',1; END;";
EXPECTED_CHECKS.CK_pos_sync_shift_financial_noops_json='(isjson([payload_json])=(1) AND isjson([proof_json])=(1))';
EXPECTED_CHECKS.CK_pos_sync_shift_financial_noops_hash="(datalength([payload_hash])=(64) AND NOT [payload_hash] like '%[^0-9a-f]%')";
const fail=(code='EFINANCIAL_OPERATION_INVALID')=>{throw Object.assign(new Error('The immutable financial operation could not be confirmed.'),{code,table:'shifts'});};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const json=v=>JSON.stringify(canonical(v));
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex');
const uid=v=>{if(typeof v!=='string'||!UUID.test(v.toLowerCase()))fail();return v.toLowerCase();};
const label=v=>{if(typeof v!=='string'||!v||v.length>128||v.trim()!==v||/[\u0000-\u001f\u007f]/u.test(v))fail();return v;};
const originFields=value=>value.cloudOrigin?{cloudOrigin:Object.freeze({...value.cloudOrigin})}:{openingOrigin:Object.freeze({...value.openingOrigin})};
const seq=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(v)||BigInt(v)>9223372036854775806n)fail();return v;};
const projection='LOWER(CONVERT(nvarchar(36),id)) id,store_id branchId,shift_id shiftId,CONVERT(nvarchar(80),total_amount) totalAmount,payment_type paymentType,payments paymentsJson,CONVERT(nvarchar(80),discount_amount) discountAmount,is_refunded isRefunded,CONVERT(nvarchar(30),row_version) rowVersion';
const KNOWN_METHODS=new Set(['cash','card','wallet','bank_transfer','transfer','qr','online','ewallet']);
const foldMethod=value=>{if(value===null)return null;if(typeof value!=='string')return value;const lower=value.replace(/[A-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+32));return KNOWN_METHODS.has(lower)?lower:value;};
function semanticJson(value){
 if(isExactNumber(value))return['number',exactFinancialDecimalKey(value)];
 if(value===null)return['null'];if(typeof value==='string')return['string',value];if(typeof value==='boolean')return['boolean',value];
 if(Array.isArray(value))return['array',value.map(semanticJson)];
 if(value&&typeof value==='object')return['object',Object.keys(value).sort().map(key=>[key,semanticJson(value[key])])];
 fail('EFINANCIAL_SOURCE_UNVERIFIED');
}
function financialFact(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||typeof row.branchId!=='string'||typeof row.shiftId!=='string'||!UUID.test(row.id)||!UUID.test(row.shiftId))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 for(const key of['totalAmount','paymentType','paymentsJson','discountAmount','rowVersion'])if(!Object.hasOwn(row,key)||(row[key]!==null&&typeof row[key]!=='string'))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 if(!Object.hasOwn(row,'isRefunded')||(row.isRefunded!==null&&typeof row.isRefunded!=='boolean'))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 const refunded=row.isRefunded===true;let payments=['single'];
 if(!refunded&&row.paymentsJson!==null&&row.paymentsJson!==''){
  let parsed;try{parsed=parseExactJson(row.paymentsJson,{maxBytes:6*1024*1024,maxDepth:64});}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  if(Array.isArray(parsed)&&parsed.length){
   parsed=parsed.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||isExactNumber(entry))fail('EFINANCIAL_SOURCE_UNVERIFIED');
    const result={...entry};if(Object.hasOwn(result,'amount')&&result.amount!==null){if(typeof result.amount!=='string'&&!isExactNumber(result.amount))fail('EFINANCIAL_SOURCE_UNVERIFIED');result.amount={financialExactAmount:exactFinancialDecimalKey(result.amount)};}
    if(typeof result.method==='string')result.method=foldMethod(result.method);return result;
   });payments=semanticJson(parsed);
  }
 }
 // This is financial snapshot equality only. The mutation OLD/NEW field policy
 // below remains raw/strict and must never use this excluded-tender projection.
 return{id:row.id,branchId:row.branchId,shiftId:row.shiftId,totalAmount:row.totalAmount===null?null:exactFinancialDecimalKey(row.totalAmount),discountAmount:row.discountAmount===null?null:exactFinancialDecimalKey(row.discountAmount),paymentType:refunded?['excluded']:foldMethod(row.paymentType),payments:refunded?['excluded']:payments,isRefunded:refunded};
}
function timestampKey(value){
 if(value===null||value===undefined)return null;if(typeof value!=='string')fail('EFINANCIAL_SOURCE_UNVERIFIED');
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);if(!match)fail('EFINANCIAL_SOURCE_UNVERIFIED');
 const epoch=Date.parse(match[1]+match[3]);if(!Number.isSafeInteger(epoch))fail('EFINANCIAL_SOURCE_UNVERIFIED');return String(epoch)+':'+(match[2]??'').padEnd(7,'0');
}
class ShiftFinancialOperations{
 constructor(manager,{enabled=false,resolveAuthor=null,cloud=null,terminalId=null}={}){if(resolveAuthor!==null&&typeof resolveAuthor!=='function')fail();this.manager=manager;this.enabled=enabled===true;this.resolveAuthor=resolveAuthor;this.cloud=cloud;if(terminalId!==null&&typeof terminalId!=='function')fail();this.terminalId=terminalId;}
 async query(tx,statement,values={}){if(!tx)fail('EFINANCIAL_TRANSACTION_REQUIRED');const request=new(this.manager.sql().Request)(tx);for(const[k,v]of Object.entries(values))request.input(k,v);return request.query(statement);}
 async schema(tx){
  const isolation=(await this.query(tx,'SELECT CASE WHEN @@TRANCOUNT>0 AND EXISTS(SELECT 1 FROM sys.dm_exec_sessions WHERE session_id=@@SPID AND transaction_isolation_level=4) THEN 1 ELSE 0 END ready;')).recordset?.[0];if(isolation?.ready!==1)fail('EFINANCIAL_TRANSACTION_REQUIRED');
  const names=TABLES.map(t=>"N'"+t+"'").join(',');
  const row=(await this.query(tx,`SELECT
   (SELECT t.name table_name,c.name,TYPE_NAME(c.user_type_id) type_name,c.max_length,c.scale,c.is_nullable,c.is_identity,c.is_computed,c.default_object_id,c.collation_name FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id WHERE t.name IN(${names}) AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) columns_json,
   (SELECT t.name table_name,i.name,i.type,i.is_primary_key,i.is_unique,i.is_disabled,i.has_filter,i.ignore_dup_key,i.is_hypothetical,JSON_QUERY((SELECT c.name,ic.key_ordinal ordinal,ic.is_descending_key descending_key,ic.is_included_column included FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id ORDER BY ic.index_column_id FOR JSON PATH)) keys_json FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id WHERE t.name IN(${names}) AND t.schema_id=SCHEMA_ID(N'dbo') AND i.index_id>0 FOR JSON PATH) indexes_json,
   (SELECT t.name table_name,c.name,c.definition,c.is_disabled,c.is_not_trusted,c.is_not_for_replication FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id WHERE t.name IN(${names}) AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) checks_json,
   (SELECT t.name table_name,tr.name,tr.is_disabled,tr.is_instead_of_trigger,tr.is_not_for_replication,OBJECT_DEFINITION(tr.object_id) definition FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id WHERE t.name IN(${names}) AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) triggers_json,
   (SELECT COUNT(*) FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id=f.parent_object_id WHERE t.name IN(${names}) AND t.schema_id=SCHEMA_ID(N'dbo')) foreign_keys;`)).recordset?.[0];
  const invalid=()=>fail('EFINANCIAL_OPERATION_SCHEMA_INVALID');let columns,indexes,checks,triggers;
  try{columns=JSON.parse(row.columns_json);indexes=JSON.parse(row.indexes_json);checks=JSON.parse(row.checks_json);triggers=JSON.parse(row.triggers_json);}catch{invalid();}
  if(![columns,indexes,checks,triggers].every(Array.isArray)||row.foreign_keys!==0)invalid();
  if(!columns.length)fail('EFINANCIAL_OPERATION_SCHEMA_PENDING');
  const branch=['branch_id','nvarchar',256,0],shift=['shift_id','uniqueidentifier',16,0],terminal=['terminal_id','nvarchar',256,0],operation=['operation_id','uniqueidentifier',16,0],sequence=['sequence','bigint',8,0];
  const specs=[
   [branch,shift,terminal,['origin_kind','varchar',16,0],['local_aggregate_id','uniqueidentifier',16,0,true],['row_hash','char',64,0,true],['opening_payload_json','nvarchar',-1,0,true],['opening_payload_hash','char',64,0,true],['proof_json','nvarchar',-1,0,true],['server_basis_id','uniqueidentifier',16,0,true],['server_basis_hash','char',64,0,true],['server_basis_json','nvarchar',-1,0,true],['local_snapshot_hash','char',64,0,true],['ct_witness_json','nvarchar',-1,0,true],['origin_version','tinyint',1,0],['created_at','datetimeoffset',10,7]],
   [branch,shift,terminal,sequence,operation,['payload_hash','char',64,0]],
   [branch,shift,terminal,sequence,operation,['event_kind','varchar',8,0],['action','varchar',8,0],['predecessor_hash','char',64,0],['payload_json','nvarchar',-1,0],['payload_hash','char',64,0],['proof_json','nvarchar',-1,0]],
   [['sale_id','uniqueidentifier',16,0],branch,shift,terminal],
   [branch,shift,terminal,['sale_id','uniqueidentifier',16,0],['server_basis_id','uniqueidentifier',16,0],['fact_json','nvarchar',-1,0],['fact_hash','char',64,0]],
   [branch,shift,terminal,['sale_id','uniqueidentifier',16,0],sequence,['version_side','varchar',8,0],['source_id','uniqueidentifier',16,0],['fact_json','nvarchar',-1,0,true],['fact_hash','char',64,0]],
   [branch,shift,terminal,operation,sequence,['server_basis_id','uniqueidentifier',16,0],['server_basis_hash','char',64,0],['server_basis_json','nvarchar',-1,0],['source_evidence_json','nvarchar',-1,0],['publication_json','nvarchar',-1,0],['computed_merged_hash','char',64,0],['pending_from_hash','char',64,0],['pending_from_json','nvarchar',-1,0],['merged_facts_json','nvarchar',-1,0],['database_guid','uniqueidentifier',16,0],['ct_witness_json','nvarchar',-1,0],['created_at','datetimeoffset',10,7]]
  ];
  specs.push([branch,shift,terminal,operation,['payload_json','nvarchar',-1,0],['payload_hash','char',64,0],['proof_json','nvarchar',-1,0]]);
  const expected=specs.flatMap((spec,n)=>spec.map(c=>[TABLES[n],...c]));
  if(columns.length!==expected.length||expected.some(([table,name,type,length,scale,nullable=false])=>!columns.some(c=>c.table_name===table&&c.name===name&&c.type_name===type&&c.max_length===length&&c.scale===scale&&c.is_nullable===nullable&&!c.is_identity&&!c.is_computed&&c.default_object_id===0&&(!name.endsWith('_hash')||c.collation_name==='Latin1_General_100_BIN2'))))invalid();
  const expectedIndexes=TABLES.map((table,n)=>[table,'PK_'+table,1,true,n===3?['sale_id']:n===4?['branch_id','shift_id','terminal_id','sale_id']:n===5?['branch_id','shift_id','terminal_id','sale_id','sequence','version_side']:n===6?['branch_id','shift_id','terminal_id','operation_id']:n===2?['branch_id','shift_id','terminal_id','sequence']:['branch_id','shift_id','terminal_id']]);
  expectedIndexes.push([TABLES[2],'UQ_'+TABLES[2]+'_operation',2,false,['branch_id','shift_id','terminal_id','operation_id']]);
  expectedIndexes.push([TABLES[5],'IX_'+TABLES[5]+'_sequence',2,false,['branch_id','shift_id','terminal_id','sequence','sale_id','version_side'],false]);
  expectedIndexes.push([TABLES[6],'UQ_'+TABLES[6]+'_sequence',2,false,['branch_id','shift_id','terminal_id','sequence']]);
  expectedIndexes[7][4]=['branch_id','shift_id','terminal_id','operation_id'];
  if(indexes.length!==11||expectedIndexes.some(([table,name,type,primary,keys,unique=true])=>!indexes.some(i=>i.table_name===table&&i.name===name&&i.type===type&&i.is_primary_key===primary&&i.is_unique===unique&&!i.is_disabled&&!i.has_filter&&!i.ignore_dup_key&&!i.is_hypothetical&&i.keys_json.length===keys.length&&keys.every((key,n)=>i.keys_json[n].name===key&&i.keys_json[n].ordinal===n+1&&!i.keys_json[n].descending_key&&!i.keys_json[n].included))))invalid();
  if(checks.length!==20||Object.entries(EXPECTED_CHECKS).some(([name,definition])=>!checks.some(c=>c.name===name&&c.table_name===name.replace(/^CK_/,'').replace(/_(version|json|hash|sequence|kind|shape)$/,'')&&!c.is_disabled&&!c.is_not_trusted&&!c.is_not_for_replication&&normalizeSql(c.definition)===normalizeSql(definition))))invalid();
  if(triggers.length!==8||Object.entries(EXPECTED_TRIGGERS).some(([name,definition])=>!triggers.some(t=>t.name===name&&t.table_name===name.replace(/_(immutable|guard)$/,'')&&!t.is_disabled&&!t.is_instead_of_trigger&&!t.is_not_for_replication&&normalizeSql(t.definition)===normalizeSql(definition))))invalid();
 }
 async prepareCloudBasis({branchId,shiftId,terminalId}){
  if(!this.enabled)return null;label(branchId);uid(shiftId);label(terminalId);
  if(typeof this.cloud?.readFinancialBasis!=='function')fail('EFINANCIAL_SNAPSHOT_PENDING');
  const witness=await this.cloud.readFinancialBasis({branchId,shiftId});
  require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:this.manager,branchId,shiftId,terminalId});
  return witness;
 }
 async seedSafety(tx,scope){
  if((await this.query(tx,"SELECT CASE WHEN OBJECT_ID(N'dbo.pos_jobs',N'U') IS NOT NULL THEN 1 ELSE 0 END ready;")).recordset?.[0]?.ready!==1)fail('EFINANCIAL_CACHE_UNVERIFIED');
  const jobs=await this.query(tx,"SELECT TOP(1) job_id FROM dbo.pos_jobs WITH(HOLDLOCK) WHERE (branch_id=@branch OR branch_id IS NULL) AND status<>N'completed' AND (job_type LIKE N'bootstrap[_]%' OR job_type LIKE N'%recovery%' OR job_type LIKE N'%restore%');",{branch:scope.branchId});
  if(jobs.recordset?.length)fail('EFINANCIAL_CACHE_UNVERIFIED');
  const intents=await this.query(tx,'SELECT TOP(1) intent_id FROM dbo.pos_sync_shift_intents WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND acknowledged_at IS NULL;',{branch:scope.branchId,shift:scope.shiftId});
  if(intents.recordset?.length)fail('EFINANCIAL_LOCAL_PENDING');
  const tracked=['shifts','sales','sale_items','payment_transactions','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
  const evidence=[];
  for(const table of tracked){
   const scopeSql=table==='shifts'?'source.id=@shift AND source.store_id=@branch':table==='sales'?'TRY_CONVERT(uniqueidentifier,source.shift_id)=@shift AND source.store_id=@branch':['sale_items','payment_transactions'].includes(table)?'EXISTS(SELECT 1 FROM dbo.sales parent WHERE parent.id=source.sale_id AND parent.store_id=@branch AND TRY_CONVERT(uniqueidentifier,parent.shift_id)=@shift)':'source.shift_id=@shift AND source.store_id=@branch';
   const pending=await this.query(tx,`SELECT TOP(1) journal.change_id FROM dbo.sync_change_journal journal WITH(HOLDLOCK) WHERE journal.branch_id IN(@branch,'global') AND journal.entity_type=@entity AND journal.acknowledged_at IS NULL AND (EXISTS(SELECT 1 FROM dbo.[${table}] source WITH(HOLDLOCK) WHERE source.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id')) AND (${scopeSql})) OR NOT EXISTS(SELECT 1 FROM dbo.[${table}] known WHERE known.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id'))));`,{branch:scope.branchId,shift:scope.shiftId,entity:table});
   if(pending.recordset?.length)fail('EFINANCIAL_LOCAL_PENDING');
   const bounds=(await this.query(tx,`SELECT CONVERT(nvarchar(30),(SELECT TOP(1) change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK) WHERE branch_id=@branch AND entity_type=@entity AND direction='push' AND organization_id='default')) checkpoint_version,CONVERT(nvarchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object))) minimum_version,CONVERT(nvarchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version;`,{branch:scope.branchId,entity:table,object:'dbo.'+table})).recordset?.[0];
   const valid=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
   if(!bounds||!['checkpoint_version','minimum_version','current_version'].every(key=>valid(bounds[key]))||BigInt(bounds.checkpoint_version)<BigInt(bounds.minimum_version)||BigInt(bounds.checkpoint_version)>BigInt(bounds.current_version))fail('EFINANCIAL_CT_UNVERIFIED');
   const changes=await this.query(tx,`DECLARE @baseline bigint=CONVERT(bigint,@since); SELECT TOP(1) CT.id FROM CHANGETABLE(CHANGES dbo.[${table}],@baseline) CT LEFT JOIN dbo.[${table}] source WITH(HOLDLOCK) ON source.id=CT.id WHERE (CT.SYS_CHANGE_CONTEXT IS NULL OR CT.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (CT.SYS_CHANGE_OPERATION='D' OR source.id IS NULL OR (${scopeSql}));`,{branch:scope.branchId,shift:scope.shiftId,since:bounds.checkpoint_version});
   if(changes.recordset?.length)fail('EFINANCIAL_CT_UNVERIFIED');evidence.push({table,...bounds});
  }
  const unacknowledged=await this.query(tx,`SELECT TOP(1) event.operation_id FROM dbo.pos_sync_shift_financial_events event WITH(HOLDLOCK) WHERE event.branch_id=@branch AND event.shift_id=@shift AND NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts receipt WHERE receipt.operation_type='financial_history_registered' AND receipt.entity_id=CONVERT(nvarchar(36),event.shift_id)+':'+CONVERT(nvarchar(36),event.operation_id) AND receipt.note COLLATE Latin1_General_100_BIN2=event.payload_hash+':'+event.terminal_id);`,{branch:scope.branchId,shift:scope.shiftId});
  if(unacknowledged.recordset?.length)fail('EFINANCIAL_LOCAL_PENDING');return evidence;
 }
 async seedCloudBasis(tx,witness,{branchId,shiftId,terminalId}){
  if(!this.enabled)return null;await this.schema(tx);const scope={branchId:label(branchId),shiftId:uid(shiftId),terminalId:label(terminalId)};
  const source=require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:this.manager,...scope});
  const database=(await this.query(tx,'SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset??[];
  if(database.length!==1||database[0].database_guid!==source.databaseGuid||source.purpose!=='financial_basis_read'||hash(source.basisJson)!==source.serverBasisHash)fail('EFINANCIAL_SNAPSHOT_UNVERIFIED');
  const parent=(await this.query(tx,"SELECT LOWER(CONVERT(nvarchar(36),id)) id,store_id,status,state,terminal_id,CONVERT(nvarchar(40),opened_at,127) opened_at,CONVERT(nvarchar(40),closed_at,127) closed_at FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;",{branch:scope.branchId,shift:scope.shiftId})).recordset??[];
  if(parent.length!==1)fail('SYNC_BRANCH_FORBIDDEN');
  const existing=(await this.query(tx,'SELECT * FROM dbo.pos_sync_shift_financial_origins WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset??[];
  if(existing.length){if(existing.length===1&&existing[0].origin_kind==='CLOUD_BASIS'&&String(existing[0].server_basis_id).toLowerCase()===source.serverBasisId&&existing[0].server_basis_hash===source.serverBasisHash&&existing[0].server_basis_json===source.basisJson)return this.readFrontier(tx,scope);fail('EFINANCIAL_ORIGIN_EXISTS');}
  const ct=await this.seedSafety(tx,scope);
  let remote;try{remote=parseExactJson(source.basisJson,{maxBytes:6*1024*1024,maxDepth:64});calculateKnownTenderTotals(source.basisJson);}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  if(remote.branchId!==scope.branchId||remote.shiftId!==scope.shiftId||!remote.parentSnapshot)fail('EFINANCIAL_SNAPSHOT_UNVERIFIED');
  const remoteParent=remote.parentSnapshot,localParent=parent[0];
  const state=value=>value.state??(value.closed_at?'CLOSED':'ACTIVE');
  if(remoteParent.id!==scope.shiftId||remoteParent.store_id!==scope.branchId||remoteParent.status!==localParent.status||state(remoteParent)!==state(localParent)||String(remoteParent.terminal_id??'')!==String(localParent.terminal_id??'')||timestampKey(remoteParent.opened_at)!==timestampKey(localParent.opened_at)||timestampKey(remoteParent.closed_at)!==timestampKey(localParent.closed_at))fail('EFINANCIAL_PARENT_CONFLICT');
  const localRow=(await this.query(tx,readFileSync(path.join(__dirname,'shift-financial-basis.sql'),'utf8'),{branch:scope.branchId,shift:scope.shiftId})).recordset?.[0];
  let local;try{if(typeof localRow?.basis_json!=='string')fail();local=parseExactJson(localRow.basis_json,{maxBytes:6*1024*1024,maxDepth:64});calculateKnownTenderTotals(localRow.basis_json);}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  if(exactFinancialDecimalKey(remote.openingFloat??'0')!==exactFinancialDecimalKey(local.openingFloat??'0')||remote.inputs.length!==local.inputs.length)fail('EFINANCIAL_SNAPSHOT_CONFLICT');
  const remoteRows=new Map();for(const row of remote.inputs){if(remoteRows.has(row.id))fail('EFINANCIAL_SOURCE_UNVERIFIED');remoteRows.set(row.id,row);}
  const observations=[];for(const row of local.inputs){const counterpart=remoteRows.get(row.id);if(!counterpart||json(financialFact(row))!==json(financialFact(counterpart)))fail('EFINANCIAL_SNAPSHOT_CONFLICT');const raw=json(counterpart);observations.push({saleId:row.id,factJson:raw,factHash:hash(raw)});}
  const snapshotHash=hash(json({openingFloat:exactFinancialDecimalKey(local.openingFloat??'0'),facts:local.inputs.map(financialFact).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}));
  // Recheck the transport brand/context after all reads and before any metadata.
  require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:this.manager,...scope});
  await this.query(tx,"INSERT dbo.pos_sync_shift_financial_origins(branch_id,shift_id,terminal_id,origin_kind,server_basis_id,server_basis_hash,server_basis_json,local_snapshot_hash,ct_witness_json,origin_version,created_at) VALUES(@branch,@shift,@terminal,'CLOUD_BASIS',@basis,@hash,@raw,@local,@ct,2,SYSDATETIMEOFFSET()); INSERT dbo.pos_sync_shift_financial_heads(branch_id,shift_id,terminal_id,sequence,operation_id,payload_hash) VALUES(@branch,@shift,@terminal,0,@basis,@hash);",{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,basis:source.serverBasisId,hash:source.serverBasisHash,raw:source.basisJson,local:snapshotHash,ct:json({databaseGuid:source.databaseGuid,projectOrigin:source.projectOrigin,sourceEvidence:source.sourceEvidence,tables:ct})});
  for(let start=0;start<observations.length;start+=100){await this.query(tx,"INSERT dbo.pos_sync_shift_financial_observations(branch_id,shift_id,terminal_id,sale_id,server_basis_id,fact_json,fact_hash) SELECT @branch,@shift,@terminal,TRY_CONVERT(uniqueidentifier,saleId),@basis,factJson,factHash FROM OPENJSON(@rows) WITH(saleId nvarchar(36) '$.saleId',factJson nvarchar(max) '$.factJson',factHash char(64) '$.factHash');",{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,basis:source.serverBasisId,rows:JSON.stringify(observations.slice(start,start+100))});}
  await this.appendVersions(tx,scope,observations.map(observation=>({saleId:observation.saleId,sequence:'0',side:'OBSERVED',sourceId:source.serverBasisId,fact:JSON.parse(observation.factJson)})));
  return this.readFrontier(tx,scope);
 }
 async prepareContext(context){
  if(!this.enabled)return null;const token=Object.freeze({});let author=null,error=null;
  try{if(!this.resolveAuthor)fail('EFINANCIAL_AUTHOR_PENDING');author=await this.resolveAuthor(context);if(!author||typeof author.assertCurrent!=='function'||typeof author.signFinancialOperation!=='function')fail('EFINANCIAL_AUTHOR_PENDING');author.assertCurrent();}catch(e){error=e;author=null;}
  contexts.set(token,{store:this,branchId:context.branchId,terminalId:context.terminalId,author,error});return token;
 }
 authorContext(input,scope){
  if(input.author)return{author:input.author,error:null};
  const saved=contexts.get(input.preparedContext);if(!saved||saved.store!==this||saved.branchId!==scope.branchId||saved.terminalId!==scope.terminalId)return{author:null,error:Object.assign(new Error('The original financial author is unavailable.'),{code:'EFINANCIAL_AUTHOR_PENDING'})};return saved;
 }

 scope(input){return {branchId:label(input.branchId),terminalId:label(input.terminalId),shiftId:input.shiftId===null?null:uid(input.shiftId),operationId:uid(input.operationId)};}
 async lineage(tx,saleIds,scope,before=null){
  for(let n=0;n<saleIds.length;n++){
   const sale=saleIds[n],rows=(await this.query(tx,'SELECT branch_id,shift_id,terminal_id FROM dbo.pos_sync_shift_financial_sale_lineage WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@sale;',{sale})).recordset??[];
   if(rows.length>1||rows.some(r=>r.branch_id!==scope.branchId||String(r.shift_id).toLowerCase()!==scope.shiftId)||scope.shiftId===null&&rows.length)fail('EFINANCIAL_LINEAGE_CONFLICT');
   if(before===null)continue;
   const actual=before[n];
   if(actual===null){if(rows.length)fail('EFINANCIAL_LINEAGE_CONFLICT');continue;}
   const versions=await this.knownRows(tx,scope,[sale]);const known=versions.get(sale)??null;
   if(!known||json(financialFact(actual))!==json(financialFact(known)))fail('EFINANCIAL_SOURCE_UNVERIFIED');
  }
 }
 async appendVersions(tx,scope,rows){
  if(!Array.isArray(rows)||rows.length>40000)fail('EFINANCIAL_OPERATION_TOO_LARGE');
  for(let start=0;start<rows.length;start+=100){const batch=rows.slice(start,start+100).map(row=>{
   uid(row.saleId);uid(row.sourceId);seq(row.sequence);if(!['BEFORE','AFTER','OBSERVED'].includes(row.side))fail();
   if(row.fact!==null){financialFact(row.fact);if(row.fact.id!==row.saleId||row.fact.branchId!==scope.branchId||row.fact.shiftId!==scope.shiftId)fail();}
   const raw=json(row.fact);return{saleId:row.saleId,sequence:row.sequence,side:row.side,sourceId:row.sourceId,factJson:row.fact===null?null:raw,factHash:hash(raw)};
  });await this.query(tx,`INSERT dbo.pos_sync_shift_financial_versions(branch_id,shift_id,terminal_id,sale_id,sequence,version_side,source_id,fact_json,fact_hash)
    SELECT @branch,@shift,@terminal,TRY_CONVERT(uniqueidentifier,saleId),CONVERT(bigint,sequence),side,TRY_CONVERT(uniqueidentifier,sourceId),factJson,factHash
    FROM OPENJSON(@rows) WITH(saleId nvarchar(36) '$.saleId',sequence nvarchar(30) '$.sequence',side varchar(8) '$.side',sourceId nvarchar(36) '$.sourceId',factJson nvarchar(max) '$.factJson',factHash char(64) '$.factHash');`,{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,rows:JSON.stringify(batch)});}
 }
 async knownRows(tx,scope,saleIds=null){
  const where=saleIds===null?'':' AND sale_id IN(SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids))';
  const rows=(await this.query(tx,`WITH ranked AS(SELECT sale_id,fact_json,fact_hash,CONVERT(nvarchar(30),sequence) sequence,ROW_NUMBER() OVER(PARTITION BY sale_id ORDER BY sequence DESC) n
    FROM dbo.pos_sync_shift_financial_versions WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND version_side IN('AFTER','OBSERVED')${where})
    SELECT TOP(20001) sale_id,fact_json,fact_hash,sequence FROM ranked WHERE n=1 ORDER BY sale_id;`,{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,...(saleIds===null?{}:{ids:JSON.stringify(saleIds)})})).recordset??[];
  if(rows.length>20000)fail('EFINANCIAL_OPERATION_TOO_LARGE');const known=new Map();
  for(const row of rows){const raw=row.fact_json??'null';if(hash(raw)!==row.fact_hash)fail('EFINANCIAL_SOURCE_UNVERIFIED');let fact;try{fact=JSON.parse(raw);}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}if(fact!==null){financialFact(fact);if(fact.id!==String(row.sale_id).toLowerCase()||fact.branchId!==scope.branchId||fact.shiftId!==scope.shiftId)fail();}known.set(String(row.sale_id).toLowerCase(),fact);}
  return known;
 }
 async origin(tx,scope){
  if(scope.shiftId===null)return null;
  const rows=(await this.query(tx,'SELECT * FROM dbo.pos_sync_shift_financial_origins WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset??[];
  if(rows.length>1)fail();const row=rows[0];if(!row)return null;
  if(row.origin_kind==='OPEN'&&row.origin_version===1&&HASH.test(row.row_hash))return{openingOrigin:{localAggregateId:uid(String(row.local_aggregate_id).toLowerCase()),rowHash:row.row_hash}};
  if(row.origin_kind==='CLOUD_BASIS'&&row.origin_version===2&&HASH.test(row.server_basis_hash)&&typeof row.server_basis_json==='string'&&hash(row.server_basis_json)===row.server_basis_hash){
   let witness;try{witness=JSON.parse(row.ct_witness_json);}catch{fail('EFINANCIAL_SNAPSHOT_UNVERIFIED');}
   if(typeof this.cloud?.financialBasisIdentity!=='function'||this.cloud.financialBasisIdentity(scope.branchId,scope.shiftId).identity.projectOrigin!==witness.projectOrigin)fail('EFINANCIAL_SNAPSHOT_CONTEXT_CHANGED');
   return{cloudOrigin:{serverBasisId:uid(String(row.server_basis_id).toLowerCase()),serverBasisHash:row.server_basis_hash}};
  }
  fail('EFINANCIAL_LINEAGE_CONFLICT');
 }
 async lockHead(tx,scope){
  const parent=(await this.query(tx,'SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;',{branch:scope.branchId,shift:scope.shiftId})).recordset??[];
  const origin=await this.origin(tx,scope);if(!origin)return null;if(parent.length!==1)fail('SYNC_BRANCH_FORBIDDEN');
  const heads=(await this.query(tx,'SELECT CONVERT(nvarchar(30),sequence) sequence,operation_id,payload_hash FROM dbo.pos_sync_shift_financial_heads WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset??[];
  if(heads.length!==1)fail('EFINANCIAL_LINEAGE_CONFLICT');const h=heads[0];seq(h.sequence);if(!HASH.test(h.payload_hash))fail();
  const prior={sequence:h.sequence,operationId:uid(String(h.operation_id).toLowerCase()),hash:h.payload_hash};if(prior.sequence==='0'&&(prior.operationId!==(origin.openingOrigin?.localAggregateId??origin.cloudOrigin.serverBasisId)||prior.hash!==(origin.openingOrigin?.rowHash??origin.cloudOrigin.serverBasisHash)))fail();
  return{...origin,prior,sequence:String(BigInt(prior.sequence)+1n)};
 }
 token(tx,data){const token=Object.freeze({...data.public}),saved={store:this,tx,...data,ended:false};const ended=()=>{saved.ended=true;tx.removeListener?.('commit',ended);tx.removeListener?.('rollback',ended);};tx.once?.('commit',ended);tx.once?.('rollback',ended);tokens.set(token,saved);return token;}
 use(tx,token,kind){const data=tokens.get(token);if(!data||data.store!==this||data.tx!==tx||data.used||data.ended||data.kind!==kind)fail('EFINANCIAL_CAPTURE_INVALID');return data;}
 async rows(tx,saleIds,scope){const rows=[];for(const sale of saleIds){const result=(await this.query(tx,`SELECT ${projection} FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE id=@sale;`,{sale})).recordset??[];if(result.length>1)fail();const row=result[0]??null;if(row&&(row.branchId!==scope.branchId||row.shiftId!==scope.shiftId))fail('SYNC_BRANCH_FORBIDDEN');if(row){if(!UUID.test(row.id)||row.id!==sale)fail();for(const key of['totalAmount','paymentType','paymentsJson','discountAmount','rowVersion'])if(!Object.hasOwn(row,key)||(row[key]!==null&&typeof row[key]!=='string'))fail();if(row.isRefunded!==null&&typeof row.isRefunded!=='boolean')fail();}rows.push(row);}return rows;}
 async captureMutation(tx,input){
  if(!this.enabled)return null;await this.schema(tx);const scope=this.scope(input);
  if(!['SALE','REFUND','TENDER','VOID'].includes(input.action)||!Array.isArray(input.saleIds)||input.saleIds.length<1||input.saleIds.length>500)fail();
  const saleIds=input.saleIds.map(uid).sort();if(new Set(saleIds).size!==saleIds.length)fail();
  const head=scope.shiftId===null?null:await this.lockHead(tx,scope);if(!head){await this.lineage(tx,saleIds,scope);return null;}
  const before=await this.rows(tx,saleIds,scope);await this.lineage(tx,saleIds,scope,before);const prepared=this.authorContext(input,scope);let author=prepared.author,authorError=prepared.error;
  try{if(authorError)throw authorError;if(!author||typeof author.assertCurrent!=='function'||typeof author.signFinancialOperation!=='function')fail('EFINANCIAL_AUTHOR_PENDING');author.assertCurrent();}catch(error){authorError=error;author=null;}
  return this.token(tx,{kind:'mutation',scope,head,saleIds,before,author,authorError,action:input.action});
 }
 async append(tx,data,payload,proof,kind){
  const raw=json(payload);if(Buffer.byteLength(raw,'utf8')>6*1024*1024)fail('EFINANCIAL_OPERATION_TOO_LARGE');const digest=hash(raw),s=data.scope;
  await this.query(tx,'INSERT dbo.pos_sync_shift_financial_events(branch_id,shift_id,terminal_id,sequence,operation_id,event_kind,action,predecessor_hash,payload_json,payload_hash,proof_json) VALUES(@branch,@shift,@terminal,CONVERT(bigint,@sequence),@operation,@kind,@action,@previous,@raw,@hash,@proof);',{branch:s.branchId,shift:s.shiftId,terminal:s.terminalId,sequence:data.head.sequence,operation:s.operationId,kind,action:kind==='CLOSING'?data.action:payload.action,previous:data.head.prior.hash,raw,hash:digest,proof:JSON.stringify(proof)});
  if(kind==='MUTATION')await this.appendVersions(tx,s,payload.changes.flatMap(change=>[{saleId:change.saleId,sequence:data.head.sequence,side:'BEFORE',sourceId:s.operationId,fact:change.before},{saleId:change.saleId,sequence:data.head.sequence,side:'AFTER',sourceId:s.operationId,fact:change.after}]));
  await this.query(tx,'UPDATE dbo.pos_sync_shift_financial_heads SET sequence=CONVERT(bigint,@sequence),operation_id=@operation,payload_hash=@hash WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND sequence=CONVERT(bigint,@previousSequence) AND operation_id=@previousOperation AND payload_hash=@previousHash; IF @@ROWCOUNT<>1 THROW 51026,\'Financial frontier changed.\',1;',{branch:s.branchId,shift:s.shiftId,terminal:s.terminalId,sequence:data.head.sequence,operation:s.operationId,hash:digest,previousSequence:data.head.prior.sequence,previousOperation:data.head.prior.operationId,previousHash:data.head.prior.hash});
  data.used=true;return Object.freeze({payloadJson:raw,payloadHash:digest,proof,sequence:data.head.sequence,operationId:s.operationId});
 }
 async finalizeMutation(tx,token){
  if(token===null)return null;const d=this.use(tx,token,'mutation');const after=await this.rows(tx,d.saleIds,d.scope);
  const payload={version:d.head.cloudOrigin?2:1,...d.scope,...originFields(d.head),sequence:d.head.sequence,predecessorOperationId:d.head.prior.operationId,predecessorHash:d.head.prior.hash,action:d.action,changes:d.saleIds.map((saleId,i)=>({saleId,before:d.before[i],after:after[i]})).filter(change=>{const omit=row=>row===null?null:Object.fromEntries(Object.entries(row).filter(([key])=>key!=='rowVersion'));return json(omit(change.before))!==json(omit(change.after));})};
  if(!payload.changes.length){
   // Preserve successful financial no-ops without demanding a new permission.
   // A usable current author may additionally bind the actual transaction's
   // full BEFORE/AFTER facts for later recovery; failures never invent proof.
   const capture={version:1,kind:'FINANCIAL_NOOP',...d.scope,action:d.action,changes:d.saleIds.map((saleId,i)=>({saleId,before:d.before[i],after:after[i]}))};
   let proof=null,raw;
   try{
    require('./shift-financial-noop.cjs').validateNoopPayload(capture,d.scope);raw=json(capture);
    if(Buffer.byteLength(raw,'utf8')>6*1024*1024)fail('EFINANCIAL_OPERATION_TOO_LARGE');
    if(d.authorError)throw d.authorError;if(!d.author)fail('EFINANCIAL_AUTHOR_PENDING');d.author.assertCurrent();
    proof=normalizeFinancialAttestation(d.author.signFinancialOperation({branchId:d.scope.branchId,operationId:d.scope.operationId,action:d.action,payloadJson:raw}));
    if(proof.terminalId!==d.scope.terminalId||proof.branchId!==d.scope.branchId||proof.operationId!==d.scope.operationId||proof.action!==d.action||proof.payloadHash!==hash(raw))fail();d.author.assertCurrent();
   }catch{proof=null;}
   if(proof)await this.query(tx,'INSERT dbo.pos_sync_shift_financial_noops(branch_id,shift_id,terminal_id,operation_id,payload_json,payload_hash,proof_json) VALUES(@branch,@shift,@terminal,@operation,@raw,@hash,@proof);',{branch:d.scope.branchId,shift:d.scope.shiftId,terminal:d.scope.terminalId,operation:d.scope.operationId,raw,hash:hash(raw),proof:JSON.stringify(proof)});
   d.used=true;return null;
  }
  if(d.authorError)throw d.authorError;if(!d.author)fail('EFINANCIAL_AUTHOR_PENDING');d.author.assertCurrent();
  for(const change of payload.changes){
   const rest=(row,keys)=>row&&Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));
   const {before,after}=change;
   if(d.action==='SALE'&&(before!==null||after===null))fail('EFINANCIAL_MUTATION_UNSUPPORTED');
   if(d.action==='REFUND'&&(!before||!after||![false,null].includes(before.isRefunded)||after.isRefunded!==true||json(rest(before,['isRefunded','rowVersion']))!==json(rest(after,['isRefunded','rowVersion']))))fail('EFINANCIAL_MUTATION_UNSUPPORTED');
   if(d.action==='TENDER'&&(!before||!after||json(rest(before,['paymentType','paymentsJson','rowVersion']))!==json(rest(after,['paymentType','paymentsJson','rowVersion']))))fail('EFINANCIAL_MUTATION_UNSUPPORTED');
   if(d.action==='VOID')fail('EFINANCIAL_MUTATION_UNSUPPORTED');
  }
  if(payload.changes.some(c=>c.before===null&&c.after===null))fail();const raw=json(payload);if(Buffer.byteLength(raw,'utf8')>6*1024*1024)fail('EFINANCIAL_OPERATION_TOO_LARGE');
  const proof=normalizeFinancialAttestation(d.author.signFinancialOperation({branchId:d.scope.branchId,operationId:d.scope.operationId,action:d.action,payloadJson:raw}));
  if(proof.terminalId!==d.scope.terminalId||proof.branchId!==d.scope.branchId||proof.operationId!==d.scope.operationId||proof.action!==d.action||proof.payloadHash!==hash(raw))fail();d.author.assertCurrent();
  for(const sale of payload.changes.filter(change=>change.before===null&&change.after!==null).map(change=>change.saleId))await this.query(tx,'IF NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_sale_lineage WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@sale) INSERT dbo.pos_sync_shift_financial_sale_lineage(sale_id,branch_id,shift_id,terminal_id) VALUES(@sale,@branch,@shift,@terminal);',{sale,branch:d.scope.branchId,shift:d.scope.shiftId,terminal:d.scope.terminalId});
  return this.append(tx,d,payload,proof,'MUTATION');
 }
 async captureOpening(tx,input){
  if(!this.enabled)return null;await this.schema(tx);const scope=this.scope(input);if(scope.shiftId===null)fail();
  const exists=(await this.query(tx,'SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift;',{shift:scope.shiftId})).recordset??[];if(exists.length)fail('EFINANCIAL_OPENING_EXISTS');
  const prepared=this.authorContext(input,scope);if(prepared.error)throw prepared.error;const author=prepared.author;author?.assertCurrent();if(typeof author?.signFinancialOperation!=='function')fail('EFINANCIAL_AUTHOR_PENDING');return this.token(tx,{kind:'opening',scope,author});
 }
 async finalizeOpening(tx,token){
  if(token===null)return null;const d=this.use(tx,token,'opening'),s=d.scope;d.author.assertCurrent();
  const rows=(await this.query(tx,'SELECT row_json,row_hash FROM dbo.pos_sync_shift_openings WHERE aggregate_id=@operation AND branch_id=@branch AND shift_id=@shift;',{operation:s.operationId,branch:s.branchId,shift:s.shiftId})).recordset??[];
  if(rows.length!==1||typeof rows[0].row_json!=='string'||hash(rows[0].row_json)!==rows[0].row_hash)fail('EFINANCIAL_OPENING_INVALID');
  let row;try{row=JSON.parse(rows[0].row_json);}catch{fail();}if(row.id!==s.shiftId||row.store_id!==s.branchId||row.status!=='OPEN'||row.closed_at!=null||![null,undefined,'ACTIVE'].includes(row.state))fail();
  const raw=JSON.stringify({version:1,localAggregateId:s.operationId,branchId:s.branchId,terminalId:s.terminalId,shiftId:s.shiftId,rowHash:rows[0].row_hash,rowJson:rows[0].row_json});
  if(Buffer.byteLength(raw,'utf8')>6*1024*1024)fail('EFINANCIAL_OPERATION_TOO_LARGE');
  const proof=normalizeFinancialAttestation(d.author.signFinancialOperation({branchId:s.branchId,operationId:s.operationId,action:'OPEN',payloadJson:raw}));
  if(proof.terminalId!==s.terminalId||proof.payloadHash!==hash(raw)||proof.operationId!==s.operationId||proof.branchId!==s.branchId||proof.action!=='OPEN')fail();d.author.assertCurrent();
  await this.query(tx,'INSERT dbo.pos_sync_shift_financial_origins(branch_id,shift_id,terminal_id,origin_kind,local_aggregate_id,row_hash,opening_payload_json,opening_payload_hash,proof_json,origin_version,created_at) VALUES(@branch,@shift,@terminal,@originKind,@operation,@hash,@raw,@payloadHash,@proof,1,SYSDATETIMEOFFSET()); INSERT dbo.pos_sync_shift_financial_heads(branch_id,shift_id,terminal_id,sequence,operation_id,payload_hash) VALUES(@branch,@shift,@terminal,0,@operation,@hash);',{branch:s.branchId,shift:s.shiftId,terminal:s.terminalId,operation:s.operationId,hash:rows[0].row_hash,originKind:'OPEN',raw,payloadHash:hash(raw),proof:JSON.stringify(proof)});
  d.used=true;return Object.freeze({openingOrigin:{localAggregateId:s.operationId,rowHash:rows[0].row_hash},payloadJson:raw,proof});
 }
 assertCurrent(tx,token){if(token===null)return;const data=tokens.get(token);if(!data||data.store!==this||data.tx!==tx||data.ended)fail('EFINANCIAL_CAPTURE_INVALID');data.author?.assertCurrent();}
 async readFrontier(tx,{branchId,shiftId,terminalId}){
  if(!this.enabled)return null;await this.schema(tx);branchId=label(branchId);shiftId=uid(shiftId);
  await this.query(tx,'SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;',{branch:branchId,shift:shiftId});
  if(terminalId===undefined&&this.terminalId)terminalId=this.terminalId();
  if(terminalId===undefined){const origin=(await this.query(tx,'SELECT terminal_id FROM dbo.pos_sync_shift_financial_origins WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;',{branch:branchId,shift:shiftId})).recordset??[];if(!origin.length)return null;if(origin.length!==1)fail();terminalId=origin[0].terminal_id;}
  const head=await this.lockHead(tx,{branchId,shiftId,terminalId:label(terminalId)});if(!head)return null;
  return Object.freeze({...originFields(head),sequence:head.prior.sequence,operationId:head.prior.operationId,hash:head.prior.hash,reservedSequence:head.sequence});
 }
 async validateKnownSnapshot(tx,{branchId,shiftId,basisJson}){
  if(!this.enabled)return;const frontier=await this.readFrontier(tx,{branchId,shiftId});if(!frontier)return;
  const terminalId=this.terminalId?this.terminalId():(await this.query(tx,'SELECT terminal_id FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift;',{branch:branchId,shift:shiftId})).recordset?.[0]?.terminal_id;
  let actual;try{actual=parseExactJson(basisJson,{maxBytes:6*1024*1024,maxDepth:64});}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  const origins=(await this.query(tx,'SELECT origin_kind,opening_payload_json,server_basis_json FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;',{branch:branchId,shift:shiftId,terminal:terminalId})).recordset??[];
  if(origins.length!==1)fail('EFINANCIAL_SOURCE_UNVERIFIED');let opening;try{const origin=origins[0];opening=origin.origin_kind==='CLOUD_BASIS'?parseExactJson(origin.server_basis_json).openingFloat:parseExactJson(parseExactJson(origin.opening_payload_json).rowJson).opening_float;}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  if(exactFinancialDecimalKey(opening??'0')!==exactFinancialDecimalKey(actual.openingFloat??'0'))fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const known=await this.knownRows(tx,{branchId,shiftId,terminalId}),facts=[...known.values()].filter(row=>row!==null);
  if(facts.length!==actual.inputs.length)fail('EFINANCIAL_SOURCE_UNVERIFIED');for(const row of actual.inputs){const old=known.get(row.id);if(!old||json(financialFact(old))!==json(financialFact(row)))fail('EFINANCIAL_SOURCE_UNVERIFIED');}
 }

 async validateSavedFrontier(tx,{branchId,shiftId,intentId,financialFrontier,graphPayloadHash,basisHash,companionProof}){
  if(!this.enabled)return null;await this.schema(tx);const rows=(await this.query(tx,'SELECT terminal_id,payload_json,payload_hash,proof_json,event_kind,action FROM dbo.pos_sync_shift_financial_events WHERE branch_id=@branch AND shift_id=@shift AND operation_id=@intent;',{branch:label(branchId),shift:uid(shiftId),intent:uid(intentId)})).recordset??[];
  if(rows.length!==1||rows[0].event_kind!=='CLOSING'||!financialFrontier)fail('EFINANCIAL_LINEAGE_CONFLICT');
  const originKey=Object.hasOwn(financialFrontier,'cloudOrigin')?'cloudOrigin':'openingOrigin',origin=financialFrontier[originKey];
  if(Object.keys(financialFrontier).sort().join(',')!==[originKey,'hash','operationId','reservedSequence','sequence'].sort().join(',')||seq(financialFrontier.reservedSequence)!==String(BigInt(seq(financialFrontier.sequence))+1n)||!origin||typeof origin!=='object'||Object.keys(origin).sort().join(',')!==(originKey==='cloudOrigin'?'serverBasisHash,serverBasisId':'localAggregateId,rowHash')||!UUID.test(originKey==='cloudOrigin'?origin.serverBasisId:origin.localAggregateId)||!HASH.test(originKey==='cloudOrigin'?origin.serverBasisHash:origin.rowHash))fail('EFINANCIAL_LINEAGE_CONFLICT');
  const f=financialFrontier,expected=json({...originFields(f),sequence:f.reservedSequence,predecessorOperationId:f.operationId,predecessorHash:f.hash,intentId,graphPayloadHash,basisHash});
  if(rows[0].payload_json!==expected||rows[0].payload_hash!==hash(expected)||json(JSON.parse(rows[0].proof_json))!==json(companionProof))fail('EFINANCIAL_LINEAGE_CONFLICT');return true;
 }
 async reserveClosing(tx,input){
  if(!this.enabled)return null;await this.schema(tx);const scope=this.scope({...input,operationId:input.intentId});if(!['ORIGINAL','RECOUNT'].includes(input.kind))fail();const head=await this.lockHead(tx,scope);if(!head)return null;
  return this.token(tx,{kind:'closing',scope,head,action:input.kind,public:{financialFrontier:Object.freeze({...originFields(head),sequence:head.prior.sequence,operationId:head.prior.operationId,hash:head.prior.hash,reservedSequence:head.sequence})}});
 }
 async finalizeClosing(tx,token,{basisHash,graphPayloadHash,companionProof}){
  if(token===null)return null;const d=this.use(tx,token,'closing');if(!HASH.test(basisHash)||!HASH.test(graphPayloadHash))fail();
  let proof;try{proof=Object.hasOwn(companionProof??{},'openingOrigin')?normalizeOpeningFinancialBasisAttestation(companionProof):normalizeFinancialBasisAttestation(companionProof);}catch{fail('EFINANCIAL_CLOSING_PROOF_REQUIRED');}
  if(proof.branchId!==d.scope.branchId||proof.terminalId!==d.scope.terminalId||proof.shiftId!==d.scope.shiftId||proof.intentId!==d.scope.operationId||proof.action!==d.action||proof.basisHash!==basisHash||proof.graphPayloadHash!==graphPayloadHash)fail();
  if(d.head.cloudOrigin){if(Object.hasOwn(proof,'openingOrigin')||proof.serverBasisId!==d.head.cloudOrigin.serverBasisId)fail();}else if(proof.openingOrigin&&(proof.openingOrigin.localAggregateId!==d.head.openingOrigin.localAggregateId||proof.openingOrigin.rowHash!==d.head.openingOrigin.rowHash))fail();
  const payload={...originFields(d.head),sequence:d.head.sequence,predecessorOperationId:d.head.prior.operationId,predecessorHash:d.head.prior.hash,intentId:d.scope.operationId,graphPayloadHash,basisHash};
  return this.append(tx,d,payload,proof,'CLOSING');
 }
}
module.exports={ShiftFinancialOperations,financialFact,timestampKey};
