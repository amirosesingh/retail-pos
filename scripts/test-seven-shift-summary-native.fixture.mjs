// Imported as a prelude by the isolated repair harness only. No URL/profile.
import { spawn as nativeSpawn, execFileSync as nativeCommand } from 'node:child_process';
import { mkdtemp as nativeTemp, mkdir as nativeMkdir, rm as nativeRemove } from 'node:fs/promises';
import { createServer as nativeServer } from 'node:net';
import { resolve as nativeResolve, join as nativeJoin, sep as nativeSep } from 'node:path';
async function createNativeFixture(){
 const bin=process.env.POSTGRES_TEST_BIN;
 if(!bin)throw new Error('POSTGRES_TEST_BIN must name existing portable binaries');
 const env={...process.env};for(const k of Object.keys(env))if(/^PG/i.test(k)||k==='DATABASE_URL')delete env[k];
 const base=nativeResolve('.tmp/seven-shift-summary-tests');await nativeMkdir(base,{recursive:true});
 const directory=await nativeTemp(nativeJoin(base,'owned-'));
 const port=await new Promise((accept,reject)=>{const server=nativeServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>accept(p));});});
 const command=(name,args,options={})=>nativeCommand(nativeJoin(bin,name+'.exe'),args,{env,encoding:'utf8',windowsHide:true,timeout:30000,...options});
 let started=false;
 try{
  command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
  command('pg_ctl',['-D',directory,'-l',nativeJoin(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=5 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
  const args=['-X','-q','-t','-A','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres'];
  const p=nativeSpawn(nativeJoin(bin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='',pending;
  p.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/__FIXTURE_END_([0-9]+)__ ([A-Z0-9]+)\r?\n/);if(m&&pending){const result=output.slice(0,m.index).trim();output=output.slice(m.index+m[0].length);const current=pending;pending=undefined;setTimeout(()=>{const error=errors;errors='';if(m[2]!=='00000')current.reject(new Error(error||m[2]));else current.accept(result);},10);}});
  p.stderr.on('data',chunk=>{errors+=chunk;});
  p.once('error',error=>pending?.reject(error));p.once('exit',code=>{if(pending)pending.reject(new Error(`Isolated psql exited ${code}`));});
  let sequence=0;
  const execute=sql=>new Promise((accept,reject)=>{if(pending)return reject(new Error('Fixture requests must be serial'));pending={accept,reject};p.stdin.write(sql.trimEnd()+(sql.trimEnd().endsWith(';')?'':';')+'\n\\echo __FIXTURE_END_'+(++sequence)+'__ :SQLSTATE\n');});
  const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
  return {
   exec:sql=>execute(sql),
   query:async(sql,params=[])=>{sql=sql.replace(/\$(\d+)/g,(_,i)=>quote(params[Number(i)-1])).trim().replace(/;$/,'');if(!/^(SELECT|WITH)\b/i.test(sql)){await execute(sql);return {rows:[]};}const value=await execute(`SELECT COALESCE(json_agg(f),'[]'::json)::text FROM (${sql}) f;`);return {rows:JSON.parse(value)};},
   testContention:async(sql,id)=>{
    const h=nativeSpawn(nativeJoin(bin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';h.stdout.on('data',c=>{text+=c;});h.stderr.on('data',()=>{});
    const finished=new Promise(accept=>h.once('exit',accept));h.stdin.write(`BEGIN; SELECT 1 FROM shifts WHERE id='${id}' FOR UPDATE;\n\\echo HOLDER_READY\n`);
    const limit=Date.now()+5000;while(!text.includes('HOLDER_READY')){if(Date.now()>limit)throw new Error('Isolated holder timed out');await new Promise(r=>setTimeout(r,20));}
    try{let error;try{await execute(sql);}catch(e){error=e;}if(!/could not obtain lock|55P03/.test(error?.message??''))throw new Error('Expected NOWAIT contention denial');}
    finally{h.stdin.end('ROLLBACK;\n\\q\n');await finished;}
   },
   close:async()=>{p.stdin.end('\\q\n');await new Promise(accept=>p.once('exit',accept));if(!nativeResolve(directory).startsWith(base+nativeSep))throw new Error('Unsafe fixture cleanup path');command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});started=false;await nativeRemove(directory,{recursive:true});console.log('Cleaned owned native fixture '+directory.split(nativeSep).at(-1));}
  };
 }catch(error){if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});throw error;}
}
