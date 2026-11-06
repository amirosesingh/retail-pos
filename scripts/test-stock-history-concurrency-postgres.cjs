// Opt-in, uniquely owned loopback PostgreSQL. No URL/operator profile accepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {execFileSync}=require('node:child_process');
assert.deepEqual(process.argv.slice(2),['--run']);
const bin=process.env.POSTGRES_TEST_BIN;assert(bin,'Existing portable POSTGRES_TEST_BIN required');
const base=path.resolve('.tmp/stock-history-concurrency');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'owned-')),environment={...process.env};
for(const key of Object.keys(environment))if(/^PG/i.test(key)||key==='DATABASE_URL')delete environment[key];
const command=(name,args,options={})=>execFileSync(path.join(bin,name+'.exe'),args,{env:environment,windowsHide:true,encoding:'utf8',timeout:30000,...options});
const freePort=()=>new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
function connection(port){
 const socket=net.createConnection({host:'127.0.0.1',port}),queue=[];
 let input=Buffer.alloc(0),current=null,columns=[],rows=[],error=null;
 const int=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
 const ready=new Promise((resolve,reject)=>{current={resolve,reject};socket.once('connect',()=>{
  const body=Buffer.concat([int(196608),Buffer.from('user\0postgres\0database\0postgres\0client_encoding\0UTF8\0\0')]);socket.write(Buffer.concat([int(body.length+4),body]));
 });});
 const dispatch=()=>{if(current||!queue.length)return;current=queue.shift();rows=[];columns=[];error=null;
  const body=Buffer.from(current.sql+'\0');socket.write(Buffer.concat([Buffer.from('Q'),int(body.length+4),body]));};
 socket.on('error',failure=>{current?.reject(failure);for(const item of queue)item.reject(failure);});
 socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=5){
  const size=input.readInt32BE(1);if(size<4||size>16*1024*1024){socket.destroy(Error('Invalid bounded fixture frame'));return;}
  if(input.length<size+1)return;const type=String.fromCharCode(input[0]),body=input.subarray(5,size+1);input=input.subarray(size+1);
  if(type==='T'){columns=[];let at=2;for(let n=0;n<body.readInt16BE(0);n++){const end=body.indexOf(0,at);columns.push(body.toString('utf8',at,end));at=end+19;}}
  if(type==='D'){const row={};let at=2;for(const name of columns){const length=body.readInt32BE(at);at+=4;row[name]=length<0?null:body.toString('utf8',at,at+length);if(length>=0)at+=length;}rows.push(row);}
  if(type==='E'){let at=0,message='Owned fixture query failed',code;while(at<body.length&&body[at]){const field=String.fromCharCode(body[at++]),end=body.indexOf(0,at);if(field==='M')message=body.toString('utf8',at,end);if(field==='C')code=body.toString('utf8',at,end);at=end+1;}error=Object.assign(Error(message),{code});}
  if(type==='Z'){const done=current;current=null;if(done){if(error)done.reject(error);else done.resolve(rows);}dispatch();}
 }});
 return{ready,query:sql=>new Promise((resolve,reject)=>{queue.push({sql,resolve,reject});dispatch();}),close:()=>socket.end()};
}
let started=false;const sessions=[];
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
(async()=>{try{
 const port=await freePort();command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
 command('pg_ctl',['-D',directory,'-l',path.join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=6 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
 const connect=async()=>{const client=connection(port);sessions.push(client);await client.ready;await client.query("SET statement_timeout='1500ms';SET lock_timeout='750ms';");return client;};
 const control=await connect(),first=await connect(),second=await connect();
 await control.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE TABLE app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
  CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,management_sync_enabled boolean);
  CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,owner_store_id text,stock_by_store jsonb);
  CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
  CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,quantity_delta integer);
  CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);CREATE TABLE stores(id text PRIMARY KEY);`);
 await control.query(fs.readFileSync('supabase/migrations/20261105113916_stock_history_effective_ledger.sql','utf8'));
 await control.query(fs.readFileSync('supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql','utf8'));
 await control.query(`INSERT INTO products VALUES('${a}','A',NULL,NULL,'a','{"a":3}'),('${b}','B',NULL,NULL,'a','{"a":3}');
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_source_receipts,private.stock_history_capture_gaps;
  INSERT INTO stock_history_heads(store_id) VALUES('a');`);
 await first.query(`BEGIN;SELECT id FROM products WHERE id='${a}' FOR UPDATE;`);
 await second.query(`BEGIN;UPDATE products SET stock_by_store='{"a":2}' WHERE id='${b}';`);
 // A must not wait behind B's report head while A already owns its product.
 await first.query(`UPDATE products SET stock_by_store='{"a":2}' WHERE id='${a}';`);
 assert.equal((await first.query("SELECT count(*) n FROM pg_locks WHERE pid=pg_backend_pid() AND relation='stock_history_heads'::regclass AND mode='RowExclusiveLock'"))[0].n,'0');
 await first.query('COMMIT;');await second.query(`UPDATE products SET stock_by_store='{"a":1}' WHERE id='${a}';COMMIT;`);
 assert.equal((await control.query('SELECT count(*) n FROM private.stock_history_accepted_effects'))[0].n,'3');
 console.log('PASS separate product writers add no shared report-head contention or lost effects');
 await first.query("BEGIN;SELECT store_id FROM stock_history_heads WHERE store_id='a' FOR SHARE;");
 await second.query(`BEGIN;UPDATE products SET stock_by_store='{"a":1}' WHERE id='${b}';ROLLBACK;`);
 await first.query('ROLLBACK;');assert.equal((await control.query('SELECT count(*) n FROM private.stock_history_accepted_effects'))[0].n,'3');
 console.log('PASS a report-head reader does not block business stock capture; rollback leaves no metadata');
 const values=await control.query('SELECT id,stock_by_store::text stock FROM products ORDER BY id');
 assert.deepEqual(values,[{id:a,stock:'{"a": 1}'},{id:b,stock:'{"a": 2}'}]);
 console.log('PASS actual quantities unchanged beyond the three authorized synthetic writes');
 console.log('PASS3 concurrent capture groups on '+command('postgres',['--version']).trim());
}finally{
 for(const client of sessions)client.close();
 if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
 const resolved=path.resolve(directory);assert(resolved.startsWith(base+path.sep)&&path.basename(resolved).startsWith('owned-'));
 fs.rmSync(resolved,{recursive:true});console.log('Cleaned uniquely owned stock-history PostgreSQL fixture');
}})().catch(error=>{console.error(error);process.exitCode=1;});
