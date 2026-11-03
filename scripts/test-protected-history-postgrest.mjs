// Opt-in actual PostgREST wire acceptance against a disposable, in-memory PGlite.
// No application configuration, project credentials or operator database is read.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

assert.equal(process.argv[2], '--run', 'Opt in explicitly with --run');
const executable = process.env.POSTGREST_TEST_EXE;
const socketModule = process.env.PGLITE_SOCKET_TEST_MODULE;
const postgresBin=process.env.POSTGRES_TEST_BIN;
assert(executable && (socketModule||postgresBin), 'Provide portable PostgREST and either native PostgreSQL or PGlite socket test paths');
const version = execFileSync(executable, ['--version'], {encoding:'utf8',windowsHide:true,timeout:10_000}).trim();
assert.equal(version, 'PostgREST 16.5');
const PGLiteSocketServer=socketModule?(await import(pathToFileURL(socketModule).href)).PGLiteSocketServer:null;
const root = fileURLToPath(new URL('../', import.meta.url));
const migration = await readFile(new URL('../supabase/migrations/20261103074926_protected_byte_bounded_history_download.sql',import.meta.url),'utf8');
const schema = await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const prologue=migration.split('scoped_prefix text := $scoped$')[1].split('$scoped$;')[0];
const auditCase=schema.match(/WHEN 'change_history' THEN SELECT COALESCE\(jsonb_agg[\s\S]*?;/)[0].replaceAll('GREATEST(p_limit,100)','GREATEST(p_limit,10)');
let db, socket, worker, nativeDirectory, nativeStarted=false;
let stderr='';
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const freePort = () => new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});
let passed=0;
try {
  const pgPort=await freePort();
  if(postgresBin){
    nativeDirectory=await mkdtemp(join(root,'.tmp/postgrest-acceptance/native-'));
    const command=(name,args,options={})=>execFileSync(join(postgresBin,name+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:30_000,...options});
    command('initdb',['-D',nativeDirectory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
    nativeStarted=true;
    command('pg_ctl',['-D',nativeDirectory,'-l',join(nativeDirectory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${pgPort} -c max_connections=10 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});
    const sql=text=>command('psql',['-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','postgres'],{input:text});
    db={exec:async text=>sql(text),query:async(text,values)=>sql(text.replace(/\$(\d+)/g,(_,index)=>`'${String(values[Number(index)-1]).replaceAll("'","''")}'`)),close:async()=>{}};
  }else db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_user::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.pos_sync_validate_read_scope(org text,branch text,terminal text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF org<>'default' OR branch<>'A' OR terminal<>'terminal' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END $$;
    CREATE TABLE public.app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
    CREATE TABLE public.change_history(id uuid PRIMARY KEY,new_value jsonb);
    CREATE FUNCTION public.pos_sync_bootstrap_scoped(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text,p_history_days integer,p_limit integer)
    RETURNS jsonb LANGUAGE plpgsql AS $$ ${prologue} ${auditCase} ELSE RAISE EXCEPTION 'TABLE'; END CASE;
      RETURN jsonb_build_object('rows',v_rows,'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,10),2000) THEN v_cursor ELSE NULL END); END $$;
    CREATE FUNCTION public.pos_sync_bootstrap(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text,p_history_days integer,p_limit integer)
    RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
    BEGIN IF p_table<>'issued_vouchers' THEN RETURN public.pos_sync_bootstrap_scoped(p_organization_id,p_branch_id,p_terminal_id,p_table,p_after_cursor,p_history_days,p_limit); END IF; RETURN NULL; END $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT SELECT ON public.change_history,public.app_users TO service_role;`);
  await db.exec(migration);
  const records = [
    {id:'00000000-0000-4000-8000-000000000001',new_value:{note:'雪😀',table_name:'terminal_tokens',claim_proof:'fixture-secret',safe:1}},
    {id:'00000000-0000-4000-8000-000000000002',new_value:{table_name:'products',ecom_price:99,price:5}},
  ];
  for(const row of records) await db.query('INSERT INTO public.change_history VALUES($1,$2::jsonb)',[row.id,JSON.stringify(row.new_value)]);
  if(!postgresBin){socket=new PGLiteSocketServer({db,port:pgPort,host:'127.0.0.1',maxConnections:2});await socket.start();}
  const port=await freePort();
  const secret=randomBytes(48).toString('hex');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+120});
  const token=signed+'.'+createHmac('sha256',secret).update(signed).digest('base64url');
  worker=spawn(executable,[],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,
    PGRST_DB_URI:`postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,
    PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_POOL:'1',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_CONFIG:'false',PGRST_DB_PREPARED_STATEMENTS:'false',
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port),PGRST_JWT_SECRET:secret,PGRST_LOG_LEVEL:'error'}});
  worker.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
  const url=`http://127.0.0.1:${port}/rpc/pos_sync_history_page_v1`;
  for(let attempt=0;attempt<80;attempt++){
    if(worker.exitCode!==null)throw Error(`PostgREST exited ${worker.exitCode}: ${stderr}`);
    try { const ready=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)});if(ready.status!==503)break; } catch { /* Starting isolated service. */ }
    await sleep(100);
  }
  const args={p_organization_id:'default',p_branch_id:'A',p_terminal_id:'terminal',p_after_cursor:null,p_history_days:90,p_keep_commerce:false,p_max_bytes:2097152};
  const call=(overrides={},authorized=true,encoding='identity')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept-Encoding':encoding,...(authorized?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({...args,...overrides}),signal:AbortSignal.timeout(15_000)});
  const inspect=async response=>{
    assert.equal(response.status,200,`${await response.clone().text()}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(response.headers.get('x-pos-history-projection'),'1');
    assert.equal(Number(response.headers.get('x-pos-history-bytes')),bytes.length,'Actual PostgREST wire byte count must match SQL attestation');
    assert.equal(response.headers.get('content-encoding'),null,'identity request must remain uncompressed');
    return JSON.parse(bytes.toString('utf8'));
  };
  const body=await inspect(await call());
  assert.equal(body.rows.length,2);assert.equal(body.cursor,null);assert.equal(body.rows[0].new_value.claim_proof,undefined);assert.equal(body.rows[1].new_value.ecom_price,undefined);passed++;
  const management=await inspect(await call({p_keep_commerce:true}));assert.equal(management.rows[1].new_value.ecom_price,99);passed++;
  await db.query('UPDATE public.change_history SET new_value=$1::jsonb WHERE id=$2',[JSON.stringify({note:'x'.repeat(1_649_340)}),records[0].id]);
  const wide=await inspect(await call());assert.equal(wide.rows[0].new_value.note.length,1_649_340);passed++;
  await inspect(await call({},true,'gzip, br'));passed++;
  await db.query('UPDATE public.change_history SET new_value=$1::jsonb WHERE id=$2',[JSON.stringify({note:'y'.repeat(1_649_340)}),records[1].id]);
  const first=await inspect(await call());assert.equal(first.rows.length,1);assert(first.cursor);passed++;
  const second=await inspect(await call({p_after_cursor:first.cursor}));assert.equal(second.rows.length,1);assert.equal(second.cursor,null);assert.equal(second.rows[0].id,records[1].id);passed++;
  await db.exec('TRUNCATE public.change_history');
  const empty=await inspect(await call());assert.deepEqual(empty,{rows:[],cursor:null});passed++;
  // Actual deny-response formatting is outside this wire fixture: PGlite's
  // multiplexing socket maps PostgreSQL errors to a disconnected client (503).
  // SQL-role/scope denials remain tested by the separate 994-scenario harness.
  if(postgresBin){
    const anonymous=await call({},false);assert.equal(anonymous.status,401,await anonymous.text());passed++;
    const foreign=await call({p_branch_id:'B'});assert.equal(foreign.status,400,await foreign.text());passed++;
  }
  console.log(`PASS ${passed} actual PostgREST16.5 wire / privacy / wide-row / cursor scenarios (${postgresBin?'isolated native PostgreSQL':'isolated PGlite socket'})`);
} finally {
  if(worker&&worker.exitCode===null){worker.kill();await Promise.race([new Promise(resolve=>worker.once('exit',resolve)),sleep(3000)]);}
  if(socket)await socket.stop();
  if(db)await db.close();
  if(nativeStarted){
    assert(resolve(nativeDirectory).startsWith(resolve(root,'.tmp/postgrest-acceptance')+sep));
    execFileSync(join(postgresBin,'pg_ctl.exe'),['-D',nativeDirectory,'-m','immediate','-w','stop'],{encoding:'utf8',windowsHide:true,timeout:30_000,stdio:'ignore'});
  }
}
