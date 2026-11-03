// Disposable in-memory PostgreSQL. Never connects to an operator database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFile(new URL('../' + path,import.meta.url),'utf8');
const migration = await read('supabase/migrations/20261103074926_protected_byte_bounded_history_download.sql');
const reference = ts.transpileModule(await read('src/lib/sync-download-redaction.ts'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const exports = {};
runInNewContext(reference,{exports,Object,Set,Array});
const normalized = value => JSON.parse(JSON.stringify(value));
const db = new PGlite();
let passed = 0;
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(migration);
  const fixtures = [null,true,false,0,1.5,'雪😀',[],{},
    JSON.parse('{"__proto__":{"ecommerceEnabled":true},"constructor":{"name":"safe"}}'),
    {table_name:'terminal_tokens',claim_secret_hash:'secret',claim_proof:'secret',claimed_proof_hash:'secret',child:{claim_proof:'secret',keep:1}},
    {table_name:'products',ecom_price:12,ecom_visible:true,ecom_enabled:true,is_published:true,price:2,child:[{ecom_price:7,ecommerceEnabled:true}]},
    {table_name:'settings_scoped',key:'product_price:abc',value:{ecom_price:5,price:4,nested:{ecom_price:3}}},
    {table_name:'settings_scoped',key:'product_price:abc',value:[{ecom_price:5},'雪',null]},
    {table_name:'settings_scoped',key:'productXprice:abc',value:{ecom_price:5}},
    {table_name:'products',child:{table_name:3,ecom_price:2},reset:{table_name:'terminal_tokens',claim_proof:'secret',ecom_price:2}},
    {key:'product_price:x',value:[1,2,3]},
    {large:9007199254740992,tiny:1e-100,ecommerceEnabled:true},
  ];
  let seed = 127;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const keys = ['table_name','claim_proof','ecom_price','ecommerceEnabled','value','key','__proto__','normal'];
  function generated(depth) {
    if (!depth || random() < .3) return [null,true,7,'products','terminal_tokens','settings_scoped','product_price:a','é😀'][Math.floor(random()*8)];
    if(random()<.25) return Array.from({length:3},()=>generated(depth-1));
    return Object.fromEntries(Array.from({length:5},()=>[keys[Math.floor(random()*keys.length)],generated(depth-1)]));
  }
  for(let index=0;index<80;index++) fixtures.push(generated(4));
  for(const value of fixtures) for(const table of ['', 'change_history','products','settings_scoped','terminal_tokens']) for(const keep of [false,true]) {
    const expected = normalized(exports.redactSyncDownload(value,table,keep));
    const actual = (await db.query('SELECT public.pos_sync_history_project_v1($1::jsonb,$2,$3) AS value',[JSON.stringify(value),table,keep])).rows[0].value;
    assert.deepEqual(actual,expected,`Projection mismatch ${JSON.stringify({value,table,keep})}`);
    passed++;
  }
  for(const literal of ['1e400','-1e400','1.7976931348623158e308','1.7976931348623159e308','1e-400','-0','900719925474099312345','0.1234567890123456789012345']) {
    const text=`{"number":${literal}}`;
    const expected=normalized(exports.redactSyncDownload(JSON.parse(text),'change_history',false));
    const actual=(await db.query("SELECT public.pos_sync_history_project_v1($1::jsonb,'change_history',false) AS value",[text])).rows[0].value;
    assert.deepEqual(actual,expected,`Transport numeric parity: ${literal}`); passed++;
  }
  for(const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query("SELECT public.pos_sync_history_project_v1('{}'::jsonb)"),/permission denied/);
    await assert.rejects(db.query("SELECT public.pos_sync_history_page_v1('default','A','terminal')"),/permission denied/);
    await db.exec('RESET ROLE');
    passed++;
  }
  await assert.rejects(db.query("SELECT public.pos_sync_history_page_v1('default','A','terminal')"),/UNSUPPORTED_SOURCE/);
  const schema = await read('supabase/schema.sql');
  const auditCase = schema.match(/WHEN 'change_history' THEN SELECT COALESCE\(jsonb_agg[\s\S]*?;/)[0];
  const prologue=migration.split('scoped_prefix text := $scoped$')[1].split('$scoped$;')[0];
  const stub = minimum => `CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap_scoped(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text,p_history_days integer,p_limit integer)
    RETURNS jsonb LANGUAGE plpgsql AS $$ ${prologue} ${auditCase.replaceAll('GREATEST(p_limit,100)',`GREATEST(p_limit,${minimum})`)} ELSE RAISE EXCEPTION 'TABLE'; END CASE;
    RETURN jsonb_build_object('rows',v_rows,'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,${minimum}),2000) THEN v_cursor ELSE NULL END); END $$;`;
  await db.exec(`CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.pos_sync_validate_read_scope(org text,branch text,terminal text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
    PERFORM set_config('test.raw_called','yes',false);
    IF branch <> 'A' OR terminal <> 'terminal' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END $$;
    CREATE TABLE public.app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
    CREATE TABLE public.change_history(id uuid PRIMARY KEY,new_value jsonb);
    CREATE FUNCTION public.pos_sync_bootstrap(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text,p_history_days integer,p_limit integer)
    RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
    BEGIN IF p_table <> 'issued_vouchers' THEN RETURN public.pos_sync_bootstrap_scoped(p_organization_id,p_branch_id,p_terminal_id,p_table,p_after_cursor,p_history_days,p_limit); END IF; RETURN NULL; END $$;`);
  for(const minimum of [100,10]) {
    await db.exec(stub(minimum));
    const original = await db.query("SELECT oid::regprocedure::text AS identity,to_jsonb(p) AS metadata FROM pg_proc p WHERE oid IN ('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure,'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'::regprocedure) ORDER BY 1");
    await db.exec(migration);
    const after = await db.query("SELECT oid::regprocedure::text AS identity,to_jsonb(p) AS metadata FROM pg_proc p WHERE oid IN ('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure,'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'::regprocedure) ORDER BY 1");
    assert.deepEqual(after.rows,original.rows,'Original selector metadata/grants/source unchanged');
    await db.exec("SELECT set_config('test.raw_called','no',false)");
    if(minimum===100) {
      await assert.rejects(db.query("SELECT public.pos_sync_history_page_v1('default','A','terminal')"),/UNSUPPORTED_SOURCE/);
      assert.equal((await db.query("SELECT current_setting('test.raw_called') AS value")).rows[0].value,'no');
      passed++;
    }
  }
  let lastHeaders;
  const page = async (cursor=null,budget=2097152,branch='A') => {
    const result = await db.query("WITH result AS MATERIALIZED (SELECT public.pos_sync_history_page_v1('default',$1,'terminal',$2,90,false,$3) AS value) SELECT value,current_setting('response.headers') AS headers FROM result",[branch,cursor,budget]);
    lastHeaders=result.rows[0].headers; return result.rows[0].value;
  };
  await assert.rejects(page(null,2097152,'B'),/SYNC_BRANCH_FORBIDDEN/); passed++;
  for(const budget of [0,1023,2097153,null]) {
    await assert.rejects(page(null,budget),/INVALID_ARGUMENT/); passed++;
  }
  const row = index => `00000000-0000-0000-0000-${String(index).padStart(12,'0')}`;
  for(let index=1;index<=12;index++) await db.query('INSERT INTO change_history VALUES ($1,$2::jsonb)',[row(index),JSON.stringify({table_name:'products',ecom_price:4,note:'😀'.repeat(300)})]);
  let cursor=null, ids=[];
  do {
    const value = await page(cursor,2400);
    ids.push(...value.rows.map(item=>item.id));
    const headers = JSON.parse(lastHeaders);
    const map=Object.assign({},...headers);
    const exact=(await db.query('SELECT octet_length($1::jsonb::text) AS value',[JSON.stringify(value)])).rows[0].value;
    assert.equal(Number(map['X-POS-History-Bytes']),exact);
    assert.equal(Number(map['X-POS-History-Rows']),value.rows.length);
    assert.equal(map['X-POS-History-Projection'],'1');
    assert(exact<=2400);
    assert(!JSON.stringify(value).includes('ecom_price'));
    cursor=value.cursor;
  } while(cursor);
  assert.deepEqual(ids,Array.from({length:12},(_,index)=>row(index+1))); passed++;
  await db.exec('TRUNCATE change_history');
  for(let index=1;index<=10;index++) await db.query('INSERT INTO change_history VALUES ($1,$2::jsonb)',[row(index),JSON.stringify({note:'x'.repeat(1649340)})]);
  const started=performance.now();
  const wide=await page();
  assert.equal(wide.rows.length,1); assert.deepEqual(JSON.parse(wide.cursor),{id:row(1)});
  console.log(`MEASURE isolated PGlite 10 x 1,649,340-byte notes: ${Math.round(performance.now()-started)}ms; raw aggregation remains 10 rows`);
  passed++;
  await db.exec('TRUNCATE change_history');
  await db.query('INSERT INTO change_history VALUES ($1,$2::jsonb)',[row(1),JSON.stringify({note:'x'.repeat(2300000)})]);
  assert.equal((await page()).rows.length,1); passed++;
  await db.exec('TRUNCATE change_history');
  await db.query('INSERT INTO change_history VALUES ($1,$2::jsonb)',[row(1),JSON.stringify({note:'x'.repeat(5242880)})]);
  await assert.rejects(page(),/ROW_TOO_LARGE/); passed++;
  await db.exec("COMMENT ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) IS 'metadata-only does not change functiondef';");
  await db.exec(stub(10).replace('BEGIN PERFORM','BEGIN p_limit:=100; PERFORM'));
  await db.exec("SELECT set_config('test.raw_called','no',false)");
  await assert.rejects(page(),/UNSUPPORTED_SOURCE/);
  assert.equal((await db.query("SELECT current_setting('test.raw_called') AS value")).rows[0].value,'no'); passed++;
  await db.exec(migration);
  await assert.rejects(page(),/UNSUPPORTED_SOURCE/);
  assert.equal((await db.query("SELECT current_setting('test.raw_called') AS value")).rows[0].value,'no'); passed++;
  await db.exec(stub(10));
  const wrapperDefinition=(await db.query("SELECT pg_get_functiondef('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure) AS value")).rows[0].value;
  await db.exec(wrapperDefinition.replace(',p_history_days,p_limit);',',p_history_days,100);'));
  await db.exec(migration);
  await db.exec("SELECT set_config('test.raw_called','no',false)");
  await assert.rejects(page(),/UNSUPPORTED_SOURCE/);
  assert.equal((await db.query("SELECT current_setting('test.raw_called') AS value")).rows[0].value,'no'); passed++;
  const canonical=(await read('supabase/schema.sql')).split('-- PROTECTED_HISTORY_PAGE_BEGIN')[1]?.split('-- PROTECTED_HISTORY_PAGE_END')[0];
  assert.equal(canonical.trim(),migration.trim(),'Canonical protected contract must match additive migration'); passed++;
  console.log(`PASS ${passed} projection parity / denied-access scenarios`);
} finally { await db.close(); }
