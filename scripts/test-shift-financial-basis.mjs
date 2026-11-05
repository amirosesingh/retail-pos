// FIN62 disposable PGlite prototype tests ONLY; no operator DB/network/profile.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
if(process.argv.length!==2)throw Error('This isolated prototype accepts no connection arguments.');
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const schema=await read('supabase/schema.sql');
const start=schema.indexOf('CREATE OR REPLACE FUNCTION public.shift_expected_totals(p_shift uuid)');
const end=schema.indexOf('END $$;',start);
assert.ok(start>=0&&end>start,'Existing authoritative formula must be present');
const db=new PGlite();let passed=0;
const shift='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
try{
 await db.exec(`CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,opening_float numeric);
 CREATE TABLE public.sales(id uuid PRIMARY KEY,store_id text,shift_id text,total_amount numeric,payment_type text,payments jsonb,is_refunded boolean,row_version bigint);
 INSERT INTO shifts VALUES('${shift}','A',20),('${other}','B',500);
 CREATE TABLE prototype_saved_basis(id text PRIMARY KEY,basis jsonb NOT NULL);`);
 await db.exec(schema.slice(start,end+'END $$;'.length));
 await db.exec(await read('scripts/preparation/shift-financial-basis.sql'));
 const basis=async(branch='A',id=shift)=>(await db.query('SELECT fin62_preparation.shift_financial_basis($1,$2)::text value',[branch,id])).rows[0].value;
 const baseline=async()=>(await db.query('SELECT expected_cash::text cash,expected_card::text card,expected_digital::text digital FROM public.shift_expected_totals($1)',[shift])).rows[0];
 let seq=0;
 const add=async(row={})=>{const n=++seq;await db.query('INSERT INTO sales VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[
  'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),row.branch??'A',row.shift??shift,row.total??null,row.method??null,
  row.payments===undefined?null:JSON.stringify(row.payments),row.refunded??null,row.version??1]);};
 const cases=[
  ['empty',[]],['single cash',[{total:100,method:'cash'}]],['single card',[{total:100,method:'card'}]],
  ['split cash change',[{total:100,method:'card',payments:[{method:'cash',amount:50},{method:'card',amount:80}]}]],
  ['change exceeds cash',[{total:50,payments:[{method:'cash',amount:10},{method:'card',amount:80}]}]],
  ['all digital aliases',['wallet','bank_transfer','transfer','qr','online','ewallet'].map(method=>({total:1.005,method}))],
  ['null and empty', [{total:null,method:'cash'},{total:5,method:'cash',payments:[]},{total:7,method:'card',payments:{bad:true}}]],
  ['refund excluded',[{total:99,method:'cash',refunded:true},{total:1,method:'cash',refunded:false}]],
  ['null amount split',[{total:null,payments:[{method:'cash',amount:5},{method:'card',amount:3}]}]],
  ['unknown and points',[{total:10,method:'points'},{total:9,method:'unknown'},{total:3,payments:[{method:'points',amount:3}]}]],
  ['case and duplicates',[{total:10,payments:[{method:'CASH',amount:2},{method:'cash',amount:3},{method:'QR',amount:5}]}]],
  ['negative formula parity',[{total:-1.005,method:'cash'},{total:-2.005,method:'card'}]],
  ['large exact precision',[{total:'9007199254740993.005',method:'cash',version:'9007199254740993'}]],
 ];
 for(const[name,rows]of cases){
  await db.exec('TRUNCATE sales');for(const row of rows)await add(row);
  await add({branch:'B',shift,total:9999,method:'cash'});await add({branch:'A',shift:other,total:8888,method:'cash'});
  const result=JSON.parse(await basis());assert.deepEqual(result.expected,await baseline(),name);
  assert.equal(result.inputs.length,rows.length,name+' complete selected input set');
  assert.ok(result.inputs.every(row=>row.branchId==='A'&&row.shiftId===shift),name+' branch/shift isolation');
  assert.deepEqual(result.inputs.map(row=>row.id),result.inputs.map(row=>row.id).sort(),name+' deterministic ordering');
  if(name==='large exact precision'){assert.equal(result.inputs[0].totalAmount,'9007199254740993.005');assert.equal(result.inputs[0].rowVersion,'9007199254740993');assert.equal(result.expected.cash,'9007199254741013.01');}
  passed++;console.log('PASS '+name);
 }
 await db.exec('TRUNCATE sales');
 await db.exec(`INSERT INTO sales VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','A','${shift}',9007199254740993.005,'card','[{"method":"card","amount":9007199254740993.005}]',false,1)`);
 const exactRaw=await basis();assert.ok(exactRaw.includes('9007199254740993.005'));
 assert.deepEqual(JSON.parse(exactRaw).expected,await baseline());passed++;
 assert.equal(await basis('B',shift),null);assert.equal(await basis('A',other),null);passed++;
 await db.exec('TRUNCATE sales');await add({total:100,method:'cash'});
 const original=await basis();await db.query('INSERT INTO prototype_saved_basis VALUES($1,$2)',['original',original]);
 await db.exec('UPDATE sales SET is_refunded=true,row_version=2');
 const recount=await basis();await db.query('INSERT INTO prototype_saved_basis VALUES($1,$2)',['recount',recount]);
 assert.equal(JSON.parse(original).expected.cash,'120.00');assert.equal(JSON.parse(recount).expected.cash,'20.00');
 const saved=(await db.query('SELECT id,basis::text value FROM prototype_saved_basis ORDER BY id')).rows;
 assert.equal(saved[0].value,original);assert.equal(saved[1].value,recount);
 await db.exec('DELETE FROM sales');assert.equal((await db.query("SELECT basis::text value FROM prototype_saved_basis WHERE id='original'")).rows[0].value,original);
 passed++;console.log('PASS saved original/recount copies preserve their distinct action points (fixture persistence only)');
 await db.exec('TRUNCATE sales');await add({total:1,method:'cash',payments:[{method:'cash',amount:'not-numeric'}]});
 await assert.rejects(()=>basis());await assert.rejects(()=>baseline());passed++;
 console.log(`FIN62 isolated SQL financial-basis prototype: ${passed} groups passed. No admission/security/deployment claim.`);
}finally{await db.close();}
