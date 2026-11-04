// Main-private opt-in persistence. No IPC, configuration change, migration,
// network request or automatic proof regeneration is exposed here.
const {readFileSync}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {parseExactJson,isExactNumber}=require('../sync/shift-recovery-exact.cjs');
const {calculateKnownTenderTotals,canonicalExactCents}=require('../sync/shift-financial-math.cjs');
const authorProtocol=require('../security/shift-author-protocol.cjs');
const financialProtocol=require('../security/shift-financial-protocol.cjs');
const captures=new WeakMap();
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const tables=['pos_sync_shift_financial_bases','pos_sync_shift_financial_proofs'];
const hash=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uid=value=>String(value??'').toLowerCase();
const fail=(code='EFINANCIAL_BASIS_TAMPERED')=>{throw Object.assign(new Error('The saved shift financial basis cannot be verified.'),{code,table:'shifts'});};
const unsigned=({signature:_,...fields})=>fields;
const metadataTrigger=table=>`CREATE TRIGGER dbo.${table}_immutable ON dbo.${table} AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51025,'Financial ${table.endsWith('bases')?'bases':'proofs'} are immutable.',1; END;`;
// SQL literals are byte-sensitive: formatting normalization must never alter them.
const normalizeCheck=value=>value.split(/('(?:''|[^'])*')/g).map((part,index)=>index%2?part:part.toLowerCase().replace(/\[([a-z_]+)\]/g,'$1').replace(/[\s()]/g,'')).join('');
const nullableMoney=value=>value===null?null:canonicalExactCents(value);
const cents=value=>BigInt(value.replace('.',''));
const format=value=>{const sign=value<0n?'-':'',n=value<0n?-value:value;return(sign+(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0'));};
class ShiftFinancialBases{
 constructor(manager,{enabled=false,resolveBaseline=null}={}){
  if(resolveBaseline!==null&&typeof resolveBaseline!=='function')fail('EFINANCIAL_BASIS_CONFIGURATION');
  this.manager=manager;this.enabled=enabled===true;this.resolveBaseline=resolveBaseline;
 }
 request(transaction){return transaction?new(this.manager.sql().Request)(transaction):this.manager.pool.request();}
 async query(transaction,sql,inputs={}){const request=this.request(transaction);for(const[key,value]of Object.entries(inputs))request.input(key,value);return request.query(sql);}
 async schema(transaction){
  const row=(await this.query(transaction,`SELECT OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') basis_id,OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs',N'U') proof_id,
   (SELECT t.name table_name,c.name,TYPE_NAME(c.user_type_id) type_name,c.max_length,c.scale,c.is_nullable,c.is_identity,c.is_computed,c.default_object_id,c.collation_name FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id WHERE t.name IN(N'pos_sync_shift_financial_bases',N'pos_sync_shift_financial_proofs') AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) columns_json,
   (SELECT t.name table_name,i.name,i.type,i.is_primary_key,i.is_unique,i.is_disabled,i.has_filter,i.ignore_dup_key,i.is_hypothetical,JSON_QUERY((SELECT c.name,ic.key_ordinal ordinal,ic.is_descending_key descending_key,ic.is_included_column included FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id ORDER BY ic.index_column_id FOR JSON PATH)) keys_json FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id WHERE t.name IN(N'pos_sync_shift_financial_bases',N'pos_sync_shift_financial_proofs') AND t.schema_id=SCHEMA_ID(N'dbo') AND i.index_id>0 FOR JSON PATH) indexes_json,
   (SELECT t.name table_name,c.name,c.definition,c.is_disabled,c.is_not_trusted FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id WHERE t.name IN(N'pos_sync_shift_financial_bases',N'pos_sync_shift_financial_proofs') AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) checks_json,
   (SELECT t.name table_name,tr.name,tr.is_disabled,tr.is_instead_of_trigger,OBJECT_DEFINITION(tr.object_id) definition FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id WHERE t.name IN(N'pos_sync_shift_financial_bases',N'pos_sync_shift_financial_proofs') AND t.schema_id=SCHEMA_ID(N'dbo') FOR JSON PATH) triggers_json,
   (SELECT count(*) FROM sys.foreign_keys WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'),OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs'))) foreign_keys;`)).recordset?.[0];
  if(!row?.basis_id&&!row?.proof_id)fail('EFINANCIAL_SCHEMA_PENDING');
  const invalid=()=>fail('EFINANCIAL_SCHEMA_INVALID');
  if(!row.basis_id||!row.proof_id||row.foreign_keys!==0)invalid();
  let columns,indexes,checks,triggers;try{columns=JSON.parse(row.columns_json);indexes=JSON.parse(row.indexes_json);checks=JSON.parse(row.checks_json);triggers=JSON.parse(row.triggers_json);}catch{invalid();}
  if(![columns,indexes,checks,triggers].every(Array.isArray))invalid();
  const basis=[['intent_id','uniqueidentifier',16,0],['branch_id','nvarchar',256,0],['shift_id','uniqueidentifier',16,0],['count_id','uniqueidentifier',16,0],['basis_version','tinyint',1,0],['graph_payload_hash','char',64,0],['basis_json','nvarchar',-1,0],['basis_hash','char',64,0],['captured_at','datetimeoffset',10,7]];
  const expectedColumns=[...basis.map(column=>[tables[0],...column]),...[['intent_id','uniqueidentifier',16,0],['proof_json','nvarchar',-1,0]].map(column=>[tables[1],...column])];
  if(columns.length!==expectedColumns.length||expectedColumns.some(([table,name,type,length,scale])=>!columns.some(c=>c.table_name===table&&c.name===name&&c.type_name===type&&c.max_length===length&&c.scale===scale&&!c.is_nullable&&!c.is_identity&&!c.is_computed&&c.default_object_id===0&&(!['basis_hash','graph_payload_hash'].includes(name)||c.collation_name==='Latin1_General_100_BIN2'))))invalid();
  const expectedIndexes=[[tables[0],'PK_'+tables[0],1,true,['intent_id']],[tables[0],'IX_'+tables[0]+'_scope',2,false,['branch_id','shift_id','count_id']],[tables[1],'PK_'+tables[1],1,true,['intent_id']]];
  if(indexes.length!==3||expectedIndexes.some(([table,name,type,primary,keys])=>!indexes.some(i=>i.table_name===table&&i.name===name&&i.type===type&&i.is_primary_key===primary&&i.is_unique===primary&&!i.is_disabled&&!i.has_filter&&!i.ignore_dup_key&&!i.is_hypothetical&&i.keys_json.length===keys.length&&keys.every((key,n)=>i.keys_json[n].name===key&&i.keys_json[n].ordinal===n+1&&!i.keys_json[n].descending_key&&!i.keys_json[n].included))))invalid();
  const expectedChecks=[[tables[0],'CK_'+tables[0]+'_version','basis_version=1'],[tables[0],'CK_'+tables[0]+'_json','isjsonbasis_json=1'],[tables[0],'CK_'+tables[0]+'_hash',"datalengthbasis_hash=64andnotbasis_hashlike'%[^0-9a-f]%'"],[tables[0],'CK_'+tables[0]+'_graph_hash',"datalengthgraph_payload_hash=64andnotgraph_payload_hashlike'%[^0-9a-f]%'"],[tables[1],'CK_'+tables[1]+'_json','isjsonproof_json=1']];
  if(checks.length!==5||expectedChecks.some(([table,name,definition])=>!checks.some(c=>c.table_name===table&&c.name===name&&!c.is_disabled&&!c.is_not_trusted&&normalizeCheck(c.definition)===definition)))invalid();
  if(triggers.length!==2||tables.some(table=>!triggers.some(t=>t.table_name===table&&t.name===table+'_immutable'&&!t.is_disabled&&!t.is_instead_of_trigger&&t.definition===metadataTrigger(table))))invalid();
 }
 async capture(transaction,{branchId,shiftId,countId}={}){
  if(!this.enabled)return null;
  if(!transaction||typeof branchId!=='string'||!branchId||branchId.length>128||!UUID.test(shiftId??'')||!UUID.test(countId??''))fail('EFINANCIAL_CAPTURE_INVALID');
  if(typeof transaction.once!=='function'||typeof transaction.removeListener!=='function')fail('EFINANCIAL_CAPTURE_INVALID');
  const lifetime={ended:false,token:null};
  const ended=()=>{lifetime.ended=true;if(lifetime.token)captures.delete(lifetime.token);transaction.removeListener('commit',ended);transaction.removeListener('rollback',ended);};
  transaction.once('commit',ended);transaction.once('rollback',ended);
  try{
  await this.schema(transaction);
  const prior=await this.query(transaction,'SELECT id FROM dbo.shift_cash_counts WITH(UPDLOCK,HOLDLOCK) WHERE id=@count;',{count:countId});
  if(prior.recordset?.length)fail('EFINANCIAL_CAPTURE_COUNT_EXISTS');
  const source=readFileSync(path.join(__dirname,'shift-financial-basis.sql'),'utf8');
  const row=(await this.query(transaction,source,{branch:branchId,shift:shiftId})).recordset?.[0];
  const capturedRaw=row?.basis_json;if(typeof capturedRaw!=='string')fail('EFINANCIAL_CAPTURE_INVALID');
  const calculated=calculateKnownTenderTotals(capturedRaw);
  let resolved=this.resolveBaseline?await this.resolveBaseline({transaction,branchId,shiftId,basisJson:capturedRaw}):null;
  let ready=false,raw=capturedRaw,serverBasisId=null;
  if(resolved&&typeof resolved==='object'&&typeof resolved.serverBasisId==='string'&&UUID.test(resolved.serverBasisId)&&Array.isArray(resolved.versionReferences)&&resolved.versionReferences.length<=20000){
   let refs;try{refs=JSON.stringify(resolved.versionReferences);}catch{refs=null;}const seen=new Set(),receipts=new Set();
   if(refs!==null&&Buffer.byteLength(refs,'utf8')<=2*1024*1024&&resolved.versionReferences.every(ref=>ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).length===3&&typeof ref.saleId==='string'&&UUID.test(ref.saleId)&&typeof ref.receiptId==='string'&&UUID.test(ref.receiptId)&&['before','after','delete'].includes(ref.side)&&!seen.has(ref.saleId)&&!receipts.has(ref.receiptId)&&(seen.add(ref.saleId),receipts.add(ref.receiptId),true))){
    const end=capturedRaw.trimEnd();if(!end.endsWith('}'))fail('EFINANCIAL_CAPTURE_INVALID');
    raw=end.slice(0,-1)+',"versionReferences":'+refs+'}';calculateKnownTenderTotals(raw);ready=true;serverBasisId=resolved.serverBasisId;
   }
  }
  resolved=null;
  const token=Object.freeze({expected:Object.freeze({...calculated.expected}),financialRequired:true,status:ready?'ready':'pending'});
  if(lifetime.ended)fail('EFINANCIAL_CAPTURE_INVALID');lifetime.token=token;
  captures.set(token,{store:this,transaction,lifetime,branchId,shiftId,countId,raw,basisHash:hash(raw),ready,serverBasisId,expected:token.expected});
  return token;
  }catch(error){ended();throw error;}
 }
 async intent(transaction,intentId,branchId){
  const row=(await this.query(transaction,'SELECT intent_id,branch_id,shift_id,intent_kind,payload_json,payload_hash FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE intent_id=@intent AND branch_id=@branch;',{intent:intentId,branch:branchId})).recordset?.[0];
  if(!row||typeof row.payload_json!=='string'||hash(row.payload_json)!==row.payload_hash)fail();
  let payload;try{payload=parseExactJson(row.payload_json,{maxBytes:6*1024*1024,maxDepth:64});}catch{fail();}
  if(!isExactNumber(payload.version)||payload.version.raw!=='1'||payload.intentId!==intentId||payload.branchId!==branchId||payload.shiftId!==uid(row.shift_id)||payload.kind!==row.intent_kind||!['ORIGINAL','RECOUNT'].includes(payload.kind)||!Array.isArray(payload.operations))fail();
  return{row,payload};
 }
 async author(transaction,intentId,payload,payloadHash){
  const saved=(await this.query(transaction,'SELECT attestation_json FROM dbo.pos_sync_shift_authors WHERE intent_id=@intent;',{intent:intentId})).recordset??[];
  if(saved.length!==1)fail('EFINANCIAL_AUTHOR_PENDING');
  let proof;try{proof=authorProtocol.normalizeAttestation(JSON.parse(saved[0].attestation_json));}catch{fail();}
  if(proof.intentId!==intentId||proof.branchId!==payload.branchId||proof.shiftId!==payload.shiftId||proof.action!==payload.kind||proof.payloadHash!==payloadHash)fail();
  const keys=(await this.query(transaction,'SELECT key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE project_origin=@project AND terminal_id=@terminal AND author_id=@author;',{project:proof.projectOrigin,terminal:proof.terminalId,author:proof.authorId})).recordset??[];
  if(keys.length!==1||uid(keys[0].key_id)!==proof.keyId)fail();
  let publicKey;try{authorProtocol.normalizeEnrollment({version:1,algorithm:'Ed25519',keyId:proof.keyId,projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId,publicKey:keys[0].public_key});publicKey=crypto.createPublicKey({key:Buffer.from(keys[0].public_key,'base64url'),format:'der',type:'spki'});}catch{fail();}
  if(!crypto.verify(null,Buffer.from(authorProtocol.intentMessage(unsigned(proof))),publicKey,Buffer.from(proof.signature,'base64url')))fail();
  return{proof,publicKey};
 }
 async facts(transaction,payload,countId,expected,{current=false}={}){
  const rows=name=>payload.operations.filter(op=>op.table===name).flatMap(op=>op.rows??[]);
  const parents=rows('shifts'),counts=rows('shift_cash_counts').filter(row=>row.id===countId),reconciliations=rows('shift_reconciliations').filter(row=>row.count_id===countId);
  if(parents.length!==1||counts.length!==1||reconciliations.length!==1)fail();
  const parent=parents[0],count=counts[0],recon=reconciliations[0];
  if(parent.status!=='CLOSED'||parent.state!=='CLOSED'||!parent.closed_at||parent.id!==payload.shiftId||parent.store_id!==payload.branchId||count.shift_id!==payload.shiftId||count.store_id!==payload.branchId||count.kind!==payload.kind||recon.shift_id!==payload.shiftId||recon.store_id!==payload.branchId)fail();
  const variances=[];
  for(const tender of['cash','card','digital']){
   if(canonicalExactCents(parent['expected_'+tender])!==expected[tender]||canonicalExactCents(recon['expected_'+tender])!==expected[tender])fail();
   const counted=nullableMoney(count['counted_'+tender]);if(tender==='cash'&&counted===null)fail();
   if(nullableMoney(recon['counted_'+tender])!==counted||nullableMoney(parent['counted_'+tender])!==counted)fail();
   const variance=counted===null?null:format(cents(counted)-cents(expected[tender]));
   if(nullableMoney(recon['variance_'+tender])!==variance||nullableMoney(parent['variance_'+tender])!==variance)fail();variances.push(variance===null?0n:cents(variance));
  }
  const variance=variances.reduce((a,b)=>a+b,0n),status=variance===0n?'NO_VARIANCE':variance>0n?'OVER':'SHORT';
  if(canonicalExactCents(parent.final_counted_cash)!==canonicalExactCents(count.counted_cash)||canonicalExactCents(parent.variance_total)!==format(variance)||canonicalExactCents(recon.variance_total)!==format(variance)||parent.variance_status!==status||recon.variance_status!==status)fail();
  const fields=['counted_cash','counted_card','counted_digital'];
  const countRow=(await this.query(transaction,`SELECT id,shift_id,store_id,kind,counted_by_name,counted_by_staff_id,${fields.map(name=>'CONVERT(nvarchar(80),['+name+']) ['+name+']').join(',')} FROM dbo.shift_cash_counts WITH(UPDLOCK,HOLDLOCK) WHERE id=@count;`,{count:countId})).recordset?.[0];
  if(!countRow||uid(countRow.shift_id)!==payload.shiftId||countRow.store_id!==payload.branchId||countRow.kind!==payload.kind||fields.some(name=>nullableMoney(countRow[name])!==nullableMoney(count[name])))fail();
  const reconFields=[...fields,...['expected_cash','expected_card','expected_digital','variance_cash','variance_card','variance_digital','variance_total']];
  const saved=(await this.query(transaction,`SELECT count_id,shift_id,store_id,variance_status,${reconFields.map(name=>'CONVERT(nvarchar(80),['+name+']) ['+name+']').join(',')} FROM dbo.shift_reconciliations WITH(UPDLOCK,HOLDLOCK) WHERE id=@recon;`,{recon:recon.id})).recordset?.[0];
  if(!saved||uid(saved.count_id)!==countId||uid(saved.shift_id)!==payload.shiftId||saved.store_id!==payload.branchId||saved.variance_status!==status||reconFields.some(name=>nullableMoney(saved[name])!==nullableMoney(recon[name])))fail();
  if(current){
   const all=[...reconFields,'final_counted_cash'];const savedParent=(await this.query(transaction,`SELECT store_id,status,state,closed_at,${all.map(name=>'CONVERT(nvarchar(80),['+name+']) ['+name+']').join(',')} FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift;`,{shift:payload.shiftId})).recordset?.[0];
   if(!savedParent||savedParent.status!=='CLOSED'||savedParent.state!=='CLOSED'||!savedParent.closed_at||savedParent.store_id!==payload.branchId||all.some(name=>nullableMoney(savedParent[name])!==nullableMoney(parent[name])))fail();
  }
  return countRow;
 }
 async save(transaction,token,{intentId,graphPayloadHash,countId,author}={}){
  if(!this.enabled)return null;
  const capture=captures.get(token);
  if(!capture||capture.store!==this||capture.transaction!==transaction||capture.lifetime.ended||capture.countId!==countId||!UUID.test(intentId??'')||!author||typeof author.assertCurrent!=='function')fail('EFINANCIAL_CAPTURE_INVALID');
  author.assertCurrent();const{row,payload}=await this.intent(transaction,intentId,capture.branchId);
  if(row.payload_hash!==graphPayloadHash||payload.shiftId!==capture.shiftId)fail();
  const actor=await this.author(transaction,intentId,payload,row.payload_hash),count=await this.facts(transaction,payload,countId,capture.expected,{current:true});
  if(actor.proof.keyId!==author.keyId||actor.proof.authorId!==author.binding?.authorId||actor.proof.subject!==author.subject||count.counted_by_name!==author.subject||count.counted_by_staff_id!==author.subject)fail();
  const prior=(await this.query(transaction,'SELECT graph_payload_hash,basis_hash,basis_json,count_id FROM dbo.pos_sync_shift_financial_bases WITH(UPDLOCK,HOLDLOCK) WHERE intent_id=@intent;',{intent:intentId})).recordset?.[0];
  if(prior){if(prior.graph_payload_hash!==graphPayloadHash||prior.basis_hash!==capture.basisHash||prior.basis_json!==capture.raw||uid(prior.count_id)!==countId)fail();return this.get(intentId,capture.branchId,transaction);}
  let proof=null;
  if(capture.ready){
   if(typeof author.signFinancialBasis!=='function')fail('EFINANCIAL_AUTHOR_PENDING');
   proof=financialProtocol.normalizeFinancialBasisAttestation(author.signFinancialBasis({branchId:capture.branchId,shiftId:capture.shiftId,intentId,action:payload.kind,graphPayloadHash,basisHash:capture.basisHash,serverBasisId:capture.serverBasisId,formula:'canonical-exact-decimal-v2'}));
   this.verifyCompanion(proof,actor,capture.raw,intentId,payload,graphPayloadHash);
  }
  author.assertCurrent();if(capture.lifetime.ended)fail('EFINANCIAL_CAPTURE_INVALID');
  await this.query(transaction,'INSERT dbo.pos_sync_shift_financial_bases(intent_id,branch_id,shift_id,count_id,basis_version,graph_payload_hash,basis_json,basis_hash,captured_at) VALUES(@intent,@branch,@shift,@count,1,@graph,@basis,@hash,SYSDATETIMEOFFSET());',{intent:intentId,branch:capture.branchId,shift:capture.shiftId,count:countId,graph:graphPayloadHash,basis:capture.raw,hash:capture.basisHash});
  if(proof)await this.query(transaction,'INSERT dbo.pos_sync_shift_financial_proofs(intent_id,proof_json) VALUES(@intent,@proof);',{intent:intentId,proof:JSON.stringify(proof)});
  author.assertCurrent();return{financialRequired:true,shiftFinancialBasis:proof?{basisJson:capture.raw,proof}:null,status:proof?'ready':'pending',...(proof?{}:{code:'EFINANCIAL_BASIS_PENDING'})};
 }
 verifyCompanion(proof,actor,raw,intentId,payload,graphHash){
  for(const field of['keyId','projectOrigin','terminalId','authorId','subject','branchId','shiftId','intentId','action'])if(proof[field]!==actor.proof[field])fail();
  if(proof.intentId!==intentId||proof.shiftId!==payload.shiftId||proof.graphPayloadHash!==graphHash||proof.basisHash!==hash(raw)||proof.formula!=='canonical-exact-decimal-v2')fail();
  if(!crypto.verify(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(proof))),actor.publicKey,Buffer.from(proof.signature,'base64url')))fail();
 }
 async get(intentId,branchId,transaction=null){
  if(!this.enabled)return null;
  if(!UUID.test(intentId??'')||typeof branchId!=='string'||!branchId)fail();
  if(!transaction){
   const sql=this.manager.sql(),tx=new sql.Transaction(this.manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
   try{const result=await this.get(intentId,branchId,tx);await tx.commit();return result;}catch(error){await Promise.resolve(tx.rollback()).catch(()=>{});throw error;}
  }
  await this.schema(transaction);
  const basis=(await this.query(transaction,'SELECT * FROM dbo.pos_sync_shift_financial_bases WHERE intent_id=@intent;',{intent:intentId})).recordset?.[0];
  const proofs=(await this.query(transaction,'SELECT proof_json FROM dbo.pos_sync_shift_financial_proofs WHERE intent_id=@intent;',{intent:intentId})).recordset??[];
  if(!basis){if(proofs.length)fail();return null;}
  if(basis.branch_id!==branchId||basis.basis_version!==1||typeof basis.basis_json!=='string'||hash(basis.basis_json)!==basis.basis_hash)fail();
  const{row,payload}=await this.intent(transaction,intentId,branchId);
  if(row.payload_hash!==basis.graph_payload_hash||payload.shiftId!==uid(basis.shift_id))fail();
  const calculated=calculateKnownTenderTotals(basis.basis_json),actor=await this.author(transaction,intentId,payload,row.payload_hash);
  const count=await this.facts(transaction,payload,uid(basis.count_id),calculated.expected);
  if(count.counted_by_name!==actor.proof.subject||count.counted_by_staff_id!==actor.proof.subject)fail();
  if(!proofs.length)return{financialRequired:true,shiftFinancialBasis:null,status:'pending',code:'EFINANCIAL_BASIS_PENDING'};
  if(proofs.length!==1)fail();let proof;try{proof=financialProtocol.normalizeFinancialBasisAttestation(JSON.parse(proofs[0].proof_json));}catch{fail();}
  this.verifyCompanion(proof,actor,basis.basis_json,intentId,payload,row.payload_hash);
  return{financialRequired:true,shiftFinancialBasis:{basisJson:basis.basis_json,proof},status:'ready'};
 }
}
module.exports={ShiftFinancialBases};
