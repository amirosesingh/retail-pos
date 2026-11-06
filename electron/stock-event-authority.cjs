'use strict';
// Main-only, optional evidence authority. No renderer signer or new enrollment.
const crypto=require('node:crypto');
const protocol=require('./security/stock-event-author-protocol.cjs');
const bindingProtocol=require('./security/shift-author-protocol.cjs');
const contract=require('./db/stock-history-contract.cjs');
const {stockHistoryUploadRow}=require('./sync/stock-history-ack.cjs');
const {binding:terminalBinding}=require('./verified-activation.cjs');
const {scopeHash}=require('./shift-authority.cjs');
const fail=(code='ESTOCK_AUTHOR_CHANGED')=>contract.fail(code);
class StockEventAuthority{
 constructor({keys,session,connectionManager,terminal,project,branch,context=()=>null}){
  Object.assign(this,{keys,session,connectionManager,terminal,project,branch,context});this.captures=new WeakSet();
 }
 capture(action){
  const rule=protocol.ACTIONS[action],person=this.session.identity();
  const permits=()=>{const now=this.session.identity();return!!now&&now.source==='pos'&&(rule?.adminOnly?now.level==='admin':rule?.permissions.every(flag=>this.session.hasPermission(flag)));};
  if(!Object.hasOwn(protocol.ACTIONS,action)||!permits())fail('PERMISSION_DENIED');
  const terminal=terminalBinding(this.terminal()),branch=contract.identifier(this.branch());
  if(!terminal||terminal.platform!=='pc'||terminal.mode!=='operations'||terminal.branchId!==branch||
   (person.branchId&&contract.identifier(person.branchId)!==branch))fail('SYNC_BRANCH_FORBIDDEN');
  const binding=Object.freeze(bindingProtocol.normalizeBinding({projectOrigin:this.project(),terminalId:terminal.id,authorId:person.authorId}));
  const subject=person.canonicalSubject;
  // Protocol validates labels before any key or database access.
  protocol.unsignedStockEvent({version:1,algorithm:'Ed25519',keyId:'00000000-0000-4000-8000-000000000000',...binding,
   subject,branchId:branch,operationId:'00000000-0000-4000-8000-000000000001',movementId:'00000000-0000-4000-8000-000000000002',action,payloadHash:'0'.repeat(64)});
  const epoch=this.session.epoch(),pool=this.connectionManager.pool,
   context=JSON.stringify([this.terminal(),this.project(),this.branch(),this.context()]);
  if(!pool)fail('ESTOCK_AUTHOR_SETUP_PENDING');
  const captured=Object.freeze({binding,subject,branchId:branch,action,assertCurrent:()=>{
   const now=this.session.identity();
   if(!now||now.source!=='pos'||this.session.epoch()!==epoch||now.authorId!==binding.authorId||now.canonicalSubject!==subject||
    (now.branchId&&contract.identifier(now.branchId)!==branch)||this.connectionManager.pool!==pool||
    JSON.stringify([this.terminal(),this.project(),this.branch(),this.context()])!==context)fail();
   if(!permits())fail('ESTOCK_AUTHOR_PERMISSION_REVOKED');
  }});this.captures.add(captured);return captured;
 }
 async prepare(capture){
  if(!this.captures.has(capture))fail('ESTOCK_AUTHOR_INVALID');capture.assertCurrent();
  const sql=this.connectionManager.sql(),request=new sql.Request(this.connectionManager.pool);
  // Read only an existing key reference. Missing material remains pending;
  // never call prepare without expectedKeyId and never insert a new reference.
  const rows=(await request.input('stock_scope',scopeHash(capture.binding)).query(
   'SELECT project_origin,terminal_id,author_id,key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE scope_hash=@stock_scope;')).recordset??[];
  capture.assertCurrent();if(rows.length!==1)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
  const row=rows[0],keyId=contract.identifier(String(row.key_id),true);
  if(row.project_origin!==capture.binding.projectOrigin||row.terminal_id!==capture.binding.terminalId||
   contract.identifier(String(row.author_id),true)!==capture.binding.authorId)fail('ESYNC_SHIFT_AUTHOR_KEY_MISMATCH');
  const info=this.keys.prepare(capture.binding,{expectedKeyId:keyId});
  if(!info.enrolled||info.keyId!==keyId||info.publicKey!==row.public_key)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
  capture.assertCurrent();return Object.freeze({binding:capture.binding,subject:capture.subject,branchId:capture.branchId,keyId,
   action:capture.action,assertCurrent:capture.assertCurrent,signMovement:(row,sourceManifestJson)=>{
    capture.assertCurrent();
    const upload=stockHistoryUploadRow(row,{branchId:capture.branchId,terminalId:capture.binding.terminalId});
    if(row.actor_id!==capture.binding.authorId||row.source_kind!==protocol.ACTIONS[capture.action].kind)fail('ESTOCK_AUTHOR_INVALID');
    if(sourceManifestJson!=null){
     const{stockSourceManifestJson}=require('./shared/stock-source-manifest.mjs');let source;
     try{source=JSON.parse(sourceManifestJson);}catch{fail('ESTOCK_AUTHOR_INVALID');}
     if(stockSourceManifestJson(source)!==sourceManifestJson||source.operationId!==row.operation_id||source.action!==capture.action||
      source.authorId!==row.actor_id||source.branchId!==row.store_id||source.terminalId!==row.terminal_id||source.productId!==row.product_id||
      source.delta!==String(row.quantity_delta)||source.effectiveAt!==row.effective_at_raw||source.recordedAt!==row.recorded_at_raw||
      JSON.stringify(source.sourceRefs)!==JSON.stringify(row.source_refs??[]))fail('ESTOCK_AUTHOR_INVALID');
    }
    const proof=this.keys.signStockEvent(capture.binding,{expectedKeyId:keyId,subject:capture.subject,branchId:capture.branchId,
     operationId:row.operation_id,movementId:upload.id,action:capture.action,payloadHash:upload.payloadHash,...(sourceManifestJson!=null?{sourceManifestJson}:{})});
    capture.assertCurrent();return proof;
   },signSourceCohort:async input=>{
    capture.assertCurrent();
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==5||
      ['operationId','sourceDatabaseId','sourceSequence','sourcePredecessorRoot','manifests'].some(field=>!Object.hasOwn(input,field)))fail('ESTOCK_AUTHOR_INVALID');
    const result=await this.keys.signStockSourceCohort(capture.binding,{expectedKeyId:keyId,subject:capture.subject,branchId:capture.branchId,
      action:capture.action,operationId:input.operationId,sourceDatabaseId:input.sourceDatabaseId,sourceSequence:input.sourceSequence,
      sourcePredecessorRoot:input.sourcePredecessorRoot,manifests:input.manifests});
    capture.assertCurrent();return result;
   }});
 }
 validatePending(value){
  const proof=protocol.normalizeStockEvent(value),terminal=terminalBinding(this.terminal());
  if(!terminal||terminal.platform!=='pc'||terminal.mode!=='operations'||proof.terminalId!==terminal.id||proof.branchId!==terminal.branchId||
   proof.branchId!==contract.identifier(this.branch())||proof.projectOrigin!==bindingProtocol.normalizeBinding({projectOrigin:this.project(),terminalId:terminal.id,authorId:proof.authorId}).projectOrigin)fail('SYNC_BRANCH_FORBIDDEN');
  const binding={projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId},info=this.keys.prepare(binding,{expectedKeyId:proof.keyId});
  if(!info.enrolled)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
  const{signature,...fields}=proof;
  if(!crypto.verify(null,Buffer.from(protocol.stockEventMessage(fields)),crypto.createPublicKey({key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'}),Buffer.from(signature,'base64url')))fail('ESTOCK_AUTHOR_INVALID');
  return proof;
 }
}
module.exports={StockEventAuthority};
