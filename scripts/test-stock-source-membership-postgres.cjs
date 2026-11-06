'use strict';
// Opt-in uniquely owned loopback PostgreSQL. Synthetic ordinary delegation is
// explicit; this tests real concurrent witness/admission/cancellation semantics.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const original=fs.readFileSync('scripts/test-stock-history-concurrency-postgres.cjs','utf8');
const prefix=original.slice(0,original.indexOf('let started=false;const sessions=[];'));
const {assert,base,directory,command,freePort,connection}=new Function('require','process',prefix.replace('.tmp/stock-history-concurrency','.tmp/stock-source-membership-postgres')+
 ';return {assert,base,directory,command,freePort,connection};')(require,process);
const {createStockSourceAdmissionCloud}=require('./lib/stock-source-admission-fixture.cjs');
const literal=value=>value==null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const bind=(sql,values=[])=>sql.replace(/\$(\d+)\b/g,(_,n)=>literal(values[Number(n)-1]));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parse=value=>typeof value==='string'&&(value.startsWith('{')||value.startsWith('['))?JSON.parse(value):value;
let started=false,groups=0;const sessions=[];const pass=name=>{groups++;console.log('PASS '+name);};
(async()=>{try{
 const version=command('postgres',['--version']).trim();assert.match(version,/PostgreSQL\) 18\./);
 const port=await freePort();command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
 command('pg_ctl',['-D',directory,'-l',path.join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=6 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
 const connect=async()=>{const c=connection(port);sessions.push(c);await c.ready;await c.query("SET statement_timeout='3000ms';SET lock_timeout='1500ms';");return c;};
 const control=await connect(),one=await connect(),two=await connect();
 const db={exec:sql=>control.query(sql),query:async(sql,values)=>({rows:(await control.query(bind(sql,values))).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,parse(v)])))}),close:async()=>{}};
 const f=await createStockSourceAdmissionCloud({db});
 const business=op=>bind('SELECT pos_sync_push_stock_source_aggregate($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb) ack',
  [op.batch,'default','a',f.terminal,JSON.stringify(op.operations),f.project,JSON.stringify([{proofJson:JSON.stringify(op.header)}])]);
 const claims=rows=>bind('SELECT pos_stock_history_accept_claims($1,$2,$3,$4::jsonb) ack',[f.project,'a',f.terminal,JSON.stringify(rows)]);
 const scalar=async query=>Object.values((await control.query(query))[0])[0];
 const first=await f.operation();await one.query('BEGIN;');const firstAck=JSON.parse((await one.query(business(first)))[0].ack);
 const repeat=two.query(business(first));await pause(35);await one.query('COMMIT;');const secondAck=JSON.parse((await repeat)[0].ack);
 assert.equal(firstAck.stockSourceStatus,'captured_unverified');assert.deepEqual(secondAck.stockSourceReceipts,firstAck.stockSourceReceipts);
 assert.equal(await scalar('SELECT count(*) n FROM private.stock_history_original_sources'),'1');assert.equal(await scalar("SELECT stock_by_store->>'a' n FROM products"),'2');
 pass('concurrent identical business retries retain one original witness and one stock effect');
 await one.query('BEGIN;');const admitted=JSON.parse((await one.query(claims([first.submission])))[0].ack);
 const duplicate=two.query(claims([first.submission]));await pause(35);await one.query('COMMIT;');assert.deepEqual(JSON.parse((await duplicate)[0].ack),admitted);
 assert.equal(await scalar('SELECT count(*) n FROM stock_history_movements'),'1');assert.equal(await scalar('SELECT count(*) n FROM private.stock_history_source_claim_verifications'),'1');
 pass('concurrent identical membership requests return one cursor, effect consumption and verification receipt');
 const next=await f.operation({sequence:'2',predecessor:first.header.sourceRoot});await next.upload();
 const alternative=JSON.parse(JSON.stringify(next.submission)),payload=JSON.parse(alternative.payloadJson);payload[1]=crypto.randomUUID();alternative.id=payload[1];
 alternative.payloadJson=JSON.stringify(payload);alternative.payloadHash=crypto.createHash('sha256').update(alternative.payloadJson).digest('hex');
 const proof=JSON.parse(alternative.authorProofJson);delete proof.signature;proof.movementId=alternative.id;proof.payloadHash=alternative.payloadHash;
 alternative.authorProofJson=JSON.stringify(f.signFixtureStockProof(proof));
 await one.query('BEGIN;');await one.query(claims([next.submission]));const conflict=two.query(claims([alternative]));
 // Attach rejection handling before allowing the waiting transaction to resume.
 const rejected=assert.rejects(conflict,/STOCK_HISTORY_EFFECT_ALREADY_CONSUMED/);await pause(35);await one.query('COMMIT;');await rejected;
 assert.equal(await scalar('SELECT count(*) n FROM stock_history_movements'),'2');assert.equal(await scalar('SELECT count(*) n FROM private.stock_history_source_claim_verifications'),'2');
 assert.equal(await scalar("SELECT stock_by_store->>'a' n FROM products"),'1');pass('competing claims cannot consume one original effect or source member twice and leave no orphan receipt');
 const third=await f.operation({sequence:'3',predecessor:next.header.sourceRoot});await third.upload();
 await one.query('BEGIN;');await one.query(claims([third.submission]));
 await assert.rejects(two.query(bind('SELECT pos_stock_history_accept_claims($1,$2,$3,$4::jsonb)',[f.project,'A',f.terminal,JSON.stringify([third.submission])])),/SYNC_BRANCH_FORBIDDEN/);
 await one.query('COMMIT;');assert.equal(await scalar('SELECT count(*) n FROM stock_history_movements'),'3');pass('case-distinct foreign branch is denied while valid metadata is in flight without a head/product deadlock');
 const receiptDefinition=(await control.query("SELECT pg_get_functiondef('private.stock_history_original_source_receipts(private.stock_history_original_sources)'::regprocedure) definition"))[0].definition;
 await control.query(`CREATE OR REPLACE FUNCTION private.stock_history_original_source_receipts(p_source private.stock_history_original_sources) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(1);RETURN '[]'::jsonb;END$$;`);
 const canceled=await f.operation({sequence:'4',predecessor:third.header.sourceRoot});
 await one.query("SET statement_timeout='100ms';");const canceledAck=JSON.parse((await one.query(business(canceled)))[0].ack);await one.query("SET statement_timeout='3000ms';");
 assert.equal(canceledAck.ok,true);assert.equal(canceledAck.stockSourceStatus,'held');assert.deepEqual(canceledAck.stockSourceReceipts,[]);
 assert.equal(await scalar("SELECT stock_by_store->>'a' n FROM products"),'-1');assert.equal(await scalar('SELECT count(*) n FROM sync_idempotency_receipts'),'4');
 assert.equal(await scalar('SELECT count(*) n FROM private.stock_history_original_sources'),'3');await control.query(receiptDefinition);
 pass('actual statement timeout inside optional receipt work keeps the accepted business transaction and reports held evidence');
 const businessDefinition=(await control.query("SELECT pg_get_functiondef('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure) definition"))[0].definition;
 assert(businessDefinition.includes('INSERT INTO sync_idempotency_receipts VALUES($1,md5($5::text));'));
 await control.query(businessDefinition.replace('INSERT INTO sync_idempotency_receipts VALUES($1,md5($5::text));','INSERT INTO sync_idempotency_receipts VALUES($1,md5($5::text));PERFORM pg_sleep(1);'));
 const coreCancel=await f.operation({sequence:'5',predecessor:canceled.header.sourceRoot});await one.query("SET statement_timeout='100ms';");
 await assert.rejects(one.query(business(coreCancel)),error=>error.code==='57014');await one.query("SET statement_timeout='3000ms';");
 assert.equal(await scalar("SELECT stock_by_store->>'a' n FROM products"),'-1');assert.equal(await scalar('SELECT count(*) n FROM sync_idempotency_receipts'),'4');
 pass('actual cancellation in the ordinary writer still rolls back its unaccepted stock and receipt');
 console.log('PASS '+groups+' actual PostgreSQL source-witness/member groups on '+version+'; synthetic ordinary delegate, no production acceptance');
}finally{
 for(const client of sessions)client.close();if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
 const resolved=path.resolve(directory);assert(resolved.startsWith(base+path.sep)&&path.basename(resolved).startsWith('owned-'));
 fs.rmSync(resolved,{recursive:true});console.log('Cleaned uniquely owned source-membership PostgreSQL fixture');
}})().catch(error=>{console.error(error);process.exitCode=1;});
