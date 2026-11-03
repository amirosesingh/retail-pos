// Disposable in-memory PostgreSQL only. No operator database or profile is read.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const original=await read('supabase/migrations/20261103074926_protected_byte_bounded_history_download.sql');
const correction=await read('supabase/migrations/20261103091907_optimize_protected_history_projection.sql');
const schema=await read('supabase/schema.sql');
const helper=original.slice(0,original.indexOf('REVOKE ALL ON FUNCTION public.pos_sync_history_project_v1'));
const signature="'public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure";
const db=new PGlite();
let passed=0;
const metadata=async()=> (await db.query(`SELECT to_jsonb(p) AS value FROM pg_proc p WHERE oid=${signature}`)).rows[0].value;
const check=async(name,work)=>{await work();passed++;console.log('PASS '+name);};
async function rejectedAlter(sql){
  await db.exec('BEGIN');
  try{
    await db.exec(sql);const before=await metadata();await db.exec('SAVEPOINT guard');
    await assert.rejects(db.exec(correction),/HISTORY_PROJECTION_REQUIRES_REVIEWED_PREREQUISITE/);
    await db.exec('ROLLBACK TO SAVEPOINT guard');assert.deepEqual(await metadata(),before);
  }finally{await db.exec('ROLLBACK');}
}
try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(original);
  await check('changes only the reviewed helper body, preserving owner, identity, ACL and attributes',async()=>{
    const before=await metadata();await db.exec(correction);const after=await metadata();
    assert.notEqual(before.prosrc,after.prosrc);
    delete before.prosrc;delete after.prosrc;assert.deepEqual(after,before);
  });
  await check('repeat upgrade is an exact no-op',async()=>{const before=await metadata();await db.exec(correction);assert.deepEqual(await metadata(),before);});
  await check('normal database roles still cannot execute the helper',async()=>{
    for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(db.query("SELECT public.pos_sync_history_project_v1('{}'::jsonb)"),/permission denied/);await db.exec('RESET ROLE');}
  });
  for(const [name,alter] of [
    ['definer','SECURITY DEFINER'],['strictness','CALLED ON NULL INPUT'],['volatility','VOLATILE'],['search path','SET search_path=public'],
  ])await check('unknown '+name+' aborts without changing the routine',()=>rejectedAlter(`ALTER FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) ${alter};`));
  await check('an unknown source body aborts without replacing it',()=>rejectedAlter(helper.replace('v_row jsonb := p_value;','v_row jsonb := p_value; -- unexpected body')));
  await check('missing prerequisite aborts without creating a replacement',async()=>{
    await db.exec('BEGIN; DROP FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean); SAVEPOINT guard');
    await assert.rejects(db.exec(correction),/HISTORY_PROJECTION_REQUIRES_REVIEWED_PREREQUISITE/);
    await db.exec('ROLLBACK TO SAVEPOINT guard');
    assert.equal((await db.query("SELECT to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)') value")).rows[0].value,null);
    await db.exec('ROLLBACK');
  });
  await check('LF and CRLF reviewed source definitions both upgrade identically',async()=>{
    const expected=(await metadata()).prosrc;
    for(const source of [helper.replaceAll('\r\n','\n'),helper.replaceAll('\r\n','\n').replaceAll('\n','\r\n')]){
      await db.exec(source);await db.exec(correction);assert.equal((await metadata()).prosrc,expected);
    }
  });
  await check('operator-managed existing grants remain exact during replacement',async()=>{
    await db.exec(helper);await db.exec('GRANT EXECUTE ON FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) TO authenticated');
    const before=(await metadata()).proacl;await db.exec(correction);assert.deepEqual((await metadata()).proacl,before);
  });
  await check('large scalar and structured branches preserve all required values and privacy',async()=>{
    const plain=Object.fromEntries(Array.from({length:57899},(_,n)=>['s'+n,n<3?Boolean(n%2):'v']));
    const value={table_name:'products',old_value:{plain},new_value:{plain},ecommerceEnabled:true,ecom_price:9};
    const result=(await db.query("SELECT public.pos_sync_history_project_v1($1::jsonb,'change_history',false) value",[JSON.stringify(value)])).rows[0].value;
    assert.deepEqual(result,{table_name:'products',old_value:{plain},new_value:{plain}});
  });
  await check('canonical corrective block matches the reviewed additive migration',async()=>{
    const block=schema.split('-- PROTECTED_HISTORY_PROJECTION_PERFORMANCE_BEGIN')[1]?.split('-- PROTECTED_HISTORY_PROJECTION_PERFORMANCE_END')[0];
    assert.equal(block.trim(),correction.trim());
  });
  console.log(`PASS ${passed} isolated history projection upgrade scenarios`);
}finally{await db.close();}
