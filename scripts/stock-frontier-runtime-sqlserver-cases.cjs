'use strict';
// Only composed into the existing uniquely-owned disposable LocalDB runner.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{randomUUID,createHash,verify}=require('node:crypto');
const{createStockCoverageFrontierRuntime}=require('../electron/stock-coverage-frontier-runtime.cjs');
const{createShiftAuthorKeys}=require('../electron/security/shift-author-key.cjs');
const{scopeHash}=require('../electron/shift-authority.cjs');
const protocol=require('../electron/security/stock-event-author-protocol.cjs'),contract=require('../electron/db/stock-history-contract.cjs');
module.exports=async({pool,sql,saved,session,pass})=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stock-frontier-native-')),author=randomUUID(),binding={projectOrigin:'https://stock.fixture',terminalId:'t',authorId:author};
 try{
  const source=fs.readFileSync(path.join(__dirname,'../database/sqlserver/migrations/023_shift_author_attestations.sql'),'utf8');
  const create=/CREATE TABLE dbo\.pos_sync_shift_author_keys\([\s\S]*?UNIQUE\(key_id\)\);/.exec(source)?.[0];assert(create);await pool.request().query(create);
  const keys=createShiftAuthorKeys({directory:()=>directory,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
  const info=keys.prepare(binding);keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});
  await pool.request().input('hash',scopeHash(binding)).input('project',binding.projectOrigin).input('terminal','t').input('author',author).input('key',info.keyId).input('public',info.publicKey)
   .query('INSERT dbo.pos_sync_shift_author_keys VALUES(@hash,@project,@terminal,@author,@key,@public);');
  const state={epoch:1,profile:'fixture',clock:0,change:false},captured=[];
  const manager={pool,sql:()=>sql},sessionAuthority={hasPosAuthority:()=>true,epoch:()=>state.epoch,identity:()=>({source:'pos',level:'staff',authorId:author,canonicalSubject:'fixture',branchId:'a'})};
  const cloud={async requestStockFrontierChallenge(input){
    assert.equal((await pool.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,0);
    if(state.change)state.profile='changed';
    const at=contract.canonicalInstant((await pool.request().query("SELECT CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' at;")).recordset[0].at);
    return{ok:true,version:1,branchId:'a',terminalId:'t',challenge:{challengeId:input.challengeId,nonce:'A'.repeat(43),cohortHash:'a'.repeat(64),issuedAt:at,expiresAt:contract.utc(contract.instant(at)+3000000000n)}};
   },async acceptStockFrontier(input){
    assert.equal((await pool.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,0);captured.push(input);
    const proof=JSON.parse(input.proofJson),{signature,...fields}=proof,frontier=JSON.parse(input.frontierJson);
    assert.equal(proof.frontierHash,createHash('sha256').update(input.frontierJson).digest('hex'));
    assert(verify(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),{key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'},Buffer.from(signature,'base64url')));
    assert.equal(frontier.databaseId,contract.identifier(String((await pool.request().query('SELECT database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset[0].database_guid),true));
    const at=contract.canonicalInstant((await pool.request().query("SELECT CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' at;")).recordset[0].at);
    return{ok:true,version:1,branchId:'a',terminalId:'t',receipt:{challengeId:frontier.challengeId,frontierHash:proof.frontierHash,state:'unconfirmed',reasons:['PENDING_UNKNOWN'],acceptedAt:at,observationGrade:'author_claimed'}};
   }};
  const options={manager,keys,session:sessionAuthority,terminal:()=>({tokenId:'t',locationId:'a',deviceUse:'operations',deviceType:'pc'}),branch:()=> 'a',project:()=>binding.projectOrigin,context:()=>state.profile,cloud,now:()=>state.clock};
  const before=await saved(),beforeSession=await session(),runtime=createStockCoverageFrontierRuntime(options);
  assert.deepEqual(await runtime.run({assertLease:()=>true}),{state:'unconfirmed',reason:'PENDING_UNKNOWN',coverageProven:false});assert.equal(captured.length,1);
  const frontier=JSON.parse(captured[0].frontierJson);assert(BigInt(frontier.pending.unknown)>0n);assert(BigInt(frontier.pending.business)>0n);
  assert.equal(await saved(),before);assert.deepEqual(await session(),beforeSession);
  pass('actual Main factory reads/signs exact private SQL evidence with no SQL transaction held during either network leg, and leaves all data/settings intact');
  state.profile='fresh';state.change=true;const changed=createStockCoverageFrontierRuntime(options);
  assert.deepEqual(await changed.run({assertLease:()=>true}),{state:'unconfirmed',reason:'ESTOCK_HISTORY_CONTEXT_CHANGED',coverageProven:false});assert.equal(captured.length,1);
  assert.equal(await saved(),before);assert.deepEqual(await session(),beforeSession);
  pass('actual Main profile change after the challenge prevents source signing/submission without resetting any native work');
 }finally{
  const target=path.resolve(directory),root=path.resolve(os.tmpdir());assert(target.startsWith(root+path.sep)&&path.basename(target).startsWith('stock-frontier-native-'));fs.rmSync(target,{recursive:true,force:true});
 }
};
