import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { installFeedFixture } from './lib/feed-page-fixture.mjs';
const db=new PGlite();let passed=0;
let lastHeaders=[];
const call=async(after='0',keep=false,max=2097152)=>{const row=(await db.query("WITH response AS MATERIALIZED(SELECT public.pos_sync_feed_page_v1($1,$2,$3,$4::bigint,$5,$6) value) SELECT value,current_setting('response.headers') headers FROM response",['default','A','terminal',after,keep,max])).rows[0];lastHeaders=JSON.parse(row.headers);return row.value;};
const headers=async()=>lastHeaders;
const seed=async(rows)=>{await db.exec('TRUNCATE fixture_feed');for(const r of rows)await db.query('INSERT INTO fixture_feed VALUES($1::bigint,$2,$3,$4,$5,$6::bigint,$7,$8::jsonb)',[r.cursor,r.branch??'A',r.table??'products',String(r.cursor),'U','1',r.tombstone??false,JSON.stringify(r.data??null)]);};
try{
 const {production}=await installFeedFixture(db);
 assert(production.includes("'e3171846683edb5d58c7a5291526555a'"));assert(production.includes("'4633e04e150c350518938f2ba661fca1'"));passed++;
 assert.deepEqual(await call(),[]);assert.equal((await headers()).find(h=>h['X-POS-Feed-Continue'])['X-POS-Feed-Continue'],'0');passed++;
 await seed([{cursor:'9007199254740993',data:{price:2,ecom_price:4,ecom_visible:true,nested:{table_name:'terminal_tokens',claim_proof:'secret',safe:1}}},{cursor:'9007199254740994',tombstone:true,data:null},{cursor:'9007199254740995',branch:'B',data:{private:true}}]);
 const exact=await db.query("SELECT public.pos_sync_feed_page_v1('default','A','terminal',0,false,2097152)::text value");assert(exact.rows[0].value.includes('9007199254740993'));const rows=await call();assert.equal(rows.length,2);assert(!('ecom_price' in rows[0].row_data));assert(!('claim_proof' in rows[0].row_data.nested));assert.equal(rows[1].row_data,null);assert.equal(rows[1].tombstone,true);passed++;
 assert.equal((await call('9007199254740993',true))[0].cursor,9007199254740994);passed++;
 await seed(Array.from({length:12},(_,i)=>({cursor:String(i+1),data:{x:i}})));assert.equal((await call()).length,10);assert.equal((await headers()).find(h=>h['X-POS-Feed-Continue'])['X-POS-Feed-Continue'],'1');assert.equal((await call('10')).length,2);passed++;
 await seed([{cursor:'1',data:{wide:'雪'.repeat(600)}},{cursor:'2',data:{wide:'x'.repeat(500)}}]);const prefix=await call('0',false,1024);assert.equal(prefix.length,1);assert.equal((await headers()).find(h=>h['X-POS-Feed-Continue'])['X-POS-Feed-Continue'],'1');assert.equal((await call('1',false,1024)).length,1);passed++;
 await seed([{cursor:'1',data:{wide:'x'.repeat(5242880)}}]);await assert.rejects(call(),/POS_FEED_STREAM_ROW_TOO_LARGE/);passed++;
 for(const args of [[null,false,1024],['0',null,1024],['0',false,1023],['0',false,2097153]]){await assert.rejects(call(...args),/INVALID_ARGUMENT/);passed++;}
 await assert.rejects(db.query("SELECT public.pos_sync_feed_page_v1('default','B','terminal')"),/SYNC_BRANCH_FORBIDDEN/);passed++;
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(call(),/permission denied/);await db.exec('RESET ROLE');passed++;}
 await seed([{cursor:'1',data:{ok:true}}]);await db.exec('SET ROLE service_role');assert.equal((await call()).length,1);await db.exec('RESET ROLE');passed++;
 await db.exec("COMMENT ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) IS 'comment not definition';");assert.equal((await call()).length,1);passed++;
 await db.exec("ALTER FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) SET statement_timeout='1s'");await assert.rejects(call(),/UNSUPPORTED_SOURCE/);passed++;
 console.log(`PASS ${passed} isolated feed SQL contract/privacy/prefix/bigint/access/source-guard scenarios`);
}catch(error){console.error(error);throw error;}finally{await db.close();}


