'use strict';
// Opt-in uniquely owned loopback PostgreSQL. No operator URLs/profile accepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const original=fs.readFileSync('scripts/test-stock-history-concurrency-postgres.cjs','utf8');
const prefix=original.slice(0,original.indexOf('let started=false;const sessions=[];'));
const{assert,base,directory,command,freePort,connection}=new Function('require','process',prefix.replace('.tmp/stock-history-concurrency','.tmp/stock-frontier-postgres')+';return{assert,base,directory,command,freePort,connection};')(require,process);
const{createActualStockWriter}=require('./lib/stock-actual-writer-fixture.cjs'),protocol=require('../electron/security/stock-event-author-protocol.cjs');
const{stockCoverageFrontierJson}=require('../electron/shared/stock-coverage-frontier.mjs');
const literal=value=>value==null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const bind=(sql,values=[])=>sql.replace(/\$(\d+)\b/g,(_,n)=>literal(values[Number(n)-1]));
const parse=value=>{if(typeof value==='string'&&(value.startsWith('{')||value.startsWith('['))){try{return JSON.parse(value);}catch{/* PostgreSQL ACL/array text is not JSON. */}}return value;},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let started=false,groups=0;const sessions=[],pass=name=>{groups++;console.log('PASS '+name);};
(async()=>{try{
 const version=command('postgres',['--version']).trim();assert.match(version,/PostgreSQL\) 18\./);
 const port=await freePort();command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
 command('pg_ctl',['-D',directory,'-l',path.join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=6 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
 const connect=async()=>{const c=connection(port);sessions.push(c);await c.ready;await c.query("SET statement_timeout='5000ms';SET lock_timeout='2000ms';SET test.auth_role='service_role';");return c;};
 const control=await connect(),one=await connect(),two=await connect();
 const db={exec:sql=>control.query(sql),query:async(sql,values)=>({rows:(await control.query(bind(sql,values))).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,parse(v)])))}),close:async()=>{}};
 const f=await createActualStockWriter({db,capturedAdjustment:true,sourceAdmission:true}),op=await f.sourceOperation();await op.upload();await op.accept();
 const{key,pair,project,database}=f.stockSourceFixture,header=JSON.parse(JSON.parse(op.submission.sourceCohortJson).proofJson);
 await control.query(fs.readFileSync('supabase/migrations/20261106073851_stock_history_coverage_frontiers.sql','utf8'));
 const scalar=async sql=>Object.values((await control.query(sql))[0])[0];
 const challengeSql=id=>bind("SELECT pos_stock_history_frontier_challenge($1,$2,'A',$3,$4,$5) result",[id,project,f.terminal,f.author,key]);
 const challenge=async()=>JSON.parse((await control.query(challengeSql(crypto.randomUUID())))[0].result);
 const sign=(c,changes={})=>{
  const raw=stockCoverageFrontierJson({version:1,projectOrigin:project,branchId:'A',terminalId:f.terminal,authorId:f.author,databaseId:database,
   challengeId:c.challengeId,nonce:c.nonce,cohortHash:c.cohortHash,writerRevision:'stock-history-source.v1',sourceSequence:'1',sourceRoot:header.sourceRoot,
   sourceGeneration:'a'.repeat(64),gapHash:'b'.repeat(64),pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:c.issuedAt,...changes});
  const fields={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:project,terminalId:f.terminal,authorId:f.author,subject:f.author,branchId:'A',challengeId:c.challengeId,frontierHash:crypto.createHash('sha256').update(raw).digest('hex')};
  return{raw,proof:JSON.stringify({...fields,signature:crypto.sign(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),pair.privateKey).toString('base64url')})};
 };
 const accept=(observation,branch='A')=>bind('SELECT pos_stock_history_accept_frontier($1,$2,$3,$4,$5,true) result',[project,branch,f.terminal,observation.raw,observation.proof]);
 const id=crypto.randomUUID();await one.query('BEGIN;');const first=JSON.parse((await one.query(challengeSql(id)))[0].result);
 const waiting=two.query(challengeSql(id));await pause(30);await one.query('COMMIT;');assert.deepEqual(JSON.parse((await waiting)[0].result),first);
 assert.equal(await scalar('SELECT count(*) FROM private.stock_history_frontier_challenges'),'1');pass('concurrent identical nonce requests return one immutable challenge and original expiry');
 const observed=sign(first);await one.query('BEGIN;');const accepted=JSON.parse((await one.query(accept(observed)))[0].result);
 const replay=two.query(accept(observed));await pause(30);await one.query('COMMIT;');assert.deepEqual(JSON.parse((await replay)[0].result),accepted);
 assert.equal(await scalar('SELECT count(*) FROM private.stock_history_frontier_receipts'),'1');pass('concurrent identical signed frontiers retain one exact receipt with a genuine accepted source prefix');
 const c=await challenge(),a=sign(c),b=sign(c,{sourceGeneration:'c'.repeat(64)});await one.query('BEGIN;');await one.query(accept(a));
 const changed=two.query(accept(b)),changedDenied=assert.rejects(changed,/STOCK_FRONTIER_REPLAY_CONFLICT/);await pause(30);await one.query('COMMIT;');await changedDenied;
 assert.equal(await scalar('SELECT count(*) FROM private.stock_history_frontier_receipts'),'2');pass('concurrent changed same-nonce bytes cannot replace or create a second accepted observation');
 const rolled=await challenge(),r=sign(rolled);await one.query('BEGIN;');await one.query(accept(r));await one.query('ROLLBACK;');
 assert.equal(await scalar(bind('SELECT count(*) FROM private.stock_history_frontier_receipts WHERE challenge_id=$1',[rolled.challengeId])),'0');
 assert.equal(JSON.parse((await two.query(accept(r)))[0].result).state,'accepted');pass('caller rollback leaves no consumed nonce/phantom receipt and the same observation can retry');
 const foreign=sign(await challenge());await one.query('BEGIN;');await one.query(accept(foreign));
 await assert.rejects(two.query(accept(foreign,'a')),/SYNC_(?:BRANCH|TERMINAL_SCOPE)_FORBIDDEN/);
 assert.equal((await one.query("SELECT count(*) n FROM pg_locks WHERE pid=pg_backend_pid() AND relation='products'::regclass"))[0].n,'0');
 await one.query('COMMIT;');pass('foreign branch denies while valid metadata is pending and frontier admission takes no business product lock');
 const timed=crypto.randomUUID();await one.query('BEGIN;');await one.query(challengeSql(timed));await two.query("SET statement_timeout='100ms';");
 await assert.rejects(two.query(challengeSql(timed)),error=>error.code==='57014');await two.query("SET statement_timeout='5000ms';");await one.query('COMMIT;');
 assert.equal(JSON.parse((await two.query(challengeSql(timed)))[0].result).challengeId,timed);pass('actual lock-wait cancellation changes no business work or duplicate nonce and later retry recovers');
 assert.equal(await f.stock(),'7');assert.equal(await scalar('SELECT count(*) FROM sync_idempotency_receipts'),'1');assert.equal(await scalar('SELECT count(*) FROM stock_history_movements'),'1');
 pass('all concurrent observation groups preserve actual original business stock, business ACK and movement receipt');
 console.log('PASS '+groups+' actual PostgreSQL frontier groups on '+version+'; provider/installed acceptance separate');
}finally{
 for(const client of sessions)client.close();if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
 const target=path.resolve(directory);assert(target.startsWith(base+path.sep)&&path.basename(target).startsWith('owned-'));fs.rmSync(target,{recursive:true});console.log('Cleaned uniquely owned frontier PostgreSQL fixture');
}})().catch(error=>{console.error(error);process.exitCode=1;});
