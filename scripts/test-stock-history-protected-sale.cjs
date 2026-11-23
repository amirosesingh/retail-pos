'use strict';
// Owned in-memory PostgreSQL only. Actual existing protected business writers;
// no POS profile, connection argument, real key, stock or transaction is used.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {randomUUID,generateKeyPairSync}=require('node:crypto');
const {createFullFinancialCloud}=require('./lib/financial-cloud-fixture.cjs');
const {commitProtectedStockSale}=require('./lib/protected-stock-sale-fixture.cjs');
assert.deepEqual(process.argv.slice(2),['--run']);
const schema=fs.readFileSync('supabase/schema.sql','utf8').replaceAll('\r\n','\n');
function fn(name){const at=schema.lastIndexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert(at>=0,name);const tail=schema.slice(at),tag=tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1],start=tail.indexOf(tag),end=tail.indexOf(tag+';',start+tag.length);assert(end>start);return tail.slice(0,end+tag.length+1);}
let f,passed=0;
const pass=name=>{passed++;console.log('PASS '+name);};
(async()=>{try{
 f=await createFullFinancialCloud();const{db,terminal,author}=f;
 const scalar=async(sql,args=[])=>(Object.values((await db.query(sql,args)).rows[0]))[0];
 const pair=generateKeyPairSync('ed25519'),keyId=randomUUID(),project='https://fixture.supabase.co';
 await db.query("UPDATE app_users SET permissions=permissions||'{\"can_open_shift\":true}'::jsonb WHERE id=$1",[author]);
 await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify({version:1,algorithm:'Ed25519',keyId,projectOrigin:project,terminalId:terminal,authorId:author,publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')}),author]);
 await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A',$1,1,$2,'approved')",[terminal,randomUUID()]);
 await db.exec("ALTER TABLE item_activity_logs ADD COLUMN IF NOT EXISTS item_id uuid,ADD COLUMN IF NOT EXISTS sale_id uuid,ADD COLUMN IF NOT EXISTS transfer_id uuid,ADD COLUMN IF NOT EXISTS quantity integer,ADD COLUMN IF NOT EXISTS created_by text,ADD COLUMN IF NOT EXISTS notes text;");
 for(const name of['sync_apply_item_activity_logs','sync_delete_item_activity_logs'])await db.exec(fn(name));
 for(const path of['20261105113916_stock_history_effective_ledger.sql','20261105172030_stock_history_accepted_effect_capture.sql','20261105232647_stock_history_author_claim_admission.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const {stockAck,rows,accept}=await commitProtectedStockSale(f,{pair,keyId,project,pass});
 await db.query('UPDATE app_users SET is_active=false WHERE id=$1',[author]);rows[0].authorState.allowed=false;assert.deepEqual(await accept(),stockAck);pass('original accepted history remains acknowledged after authority revocation without new writes');
 console.log('PASS '+passed+' actual protected-sale stock-history groups; no complete cohort/baseline or production acceptance claimed');
}finally{await f?.db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
