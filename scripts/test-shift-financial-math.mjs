// Disposable PGlite math preparation only. Optional SQL Server oracle invokes
// only the existing owned LocalDB fixture; no profile/URL/operator DB accepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {calculateKnownTenderTotals} from '../electron/sync/shift-financial-math.mjs';
const oracle=process.argv.slice(2).join(' ')==='--sqlserver-oracle';
assert(process.argv.length===2||oracle,'Only --sqlserver-oracle is accepted');
const db=new PGlite();let passed=0;
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const branch='A',shift='11111111-1111-4111-8111-111111111111';
const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const basis=(rows=[],opening='20')=>({prototypeVersion:2,formula:'canonical-exact-decimal-v2',branchId:branch,shiftId:shift,openingFloat:opening,
 inputs:rows.map((row,index)=>({id:id(index+1),branchId:branch,shiftId:shift,totalAmount:null,paymentType:null,paymentsJson:null,isRefunded:false,rowVersion:'1',...row})),
});
const totals=(cash='20.00',card='0.00',digital='0.00')=>({cash,card,digital});
try{
 await db.exec(await read('scripts/preparation/shift-financial-math-postgres.sql'));
 const rawValidate=async raw=>(await db.query('SELECT fin62_preparation.validate_financial_math_text($1) value',[raw])).rows[0].value;
 const validate=async input=>{const raw=JSON.stringify(input),result=await rawValidate(raw);
  if(input?.prototypeVersion===2&&input?.formula==='canonical-exact-decimal-v2'){
   let js,error;try{js=calculateKnownTenderTotals(raw);}catch(caught){error=caught;}
   if(result.status==='computed'){assert.ifError(error);assert.deepEqual(result,js,'Independent JS/PG exact math parity');}
   else assert(error,'JS must also hold this unsupported PG basis');
  }return result;};
 const check=async(name,input,expected)=>{const result=await validate(input);assert.equal(result.status,'computed',name+': '+JSON.stringify(result));assert.deepEqual(result.expected,expected,name);passed++;console.log('PASS '+name);};
 const cases=[
  ['empty',basis(),totals()],['null opening float',basis([],null),totals('0.00')],
  ['cash single',basis([{totalAmount:'100',paymentType:'cash'}]),totals('120.00')],
  ['cash split change',basis([{totalAmount:'100',paymentsJson:'[{"method":"cash","amount":50},{"method":"card","amount":80}]'}]),totals('40.00','80.00')],
  ['cash change capped',basis([{totalAmount:'50',paymentsJson:'[{"method":"cash","amount":10},{"method":"card","amount":80}]'}]),totals('20.00','80.00')],
  ['actual empty array falls back',basis([{totalAmount:'5',paymentType:'cash',paymentsJson:'[\t]'}]),totals('25.00')],
  ['valid object falls back',basis([{totalAmount:'5',paymentType:'cash',paymentsJson:'{"other":1}'}]),totals('25.00')],
  ['valid scalar falls back',basis([{totalAmount:'5',paymentType:'cash',paymentsJson:'true'}]),totals('25.00')],
  ['blank payments fall back',basis([{totalAmount:'5',paymentType:'cash',paymentsJson:''}]),totals('25.00')],
  ['canonical 1.005 rounds half away',basis([{totalAmount:'1.005',paymentType:'card'}]),totals('20.00','1.01')],
  ['canonical negative half away',basis([{totalAmount:'-0.005',paymentType:'card'}]),totals('20.00','-0.01')],
  ['final rounding only across rows',basis([{totalAmount:'0.005',paymentType:'card'},{totalAmount:'0.005',paymentType:'card'}]),totals('20.00','0.01')],
  ['ASCII case fold',basis([{totalAmount:'1',paymentType:'CARD'}]),totals('20.00','1.00')],
  ['unknown non-ASCII remains unknown',basis([{totalAmount:'1',paymentType:'BANK_TRANSFER'}]),totals()],
  ['unknown points excluded',basis([{totalAmount:'10',paymentType:'points'},{totalAmount:'3',paymentType:'sponsorship'}]),totals()],
  ['all digital aliases',basis(['wallet','bank_transfer','transfer','qr','online','ewallet'].map(paymentType=>({totalAmount:'1.005',paymentType}))),totals('20.00','0.00','6.03')],
  ['missing amount is zero',basis([{paymentsJson:'[{"method":"cash"},{"method":"card","amount":null}]'}]),totals()],
  ['null split total',basis([{paymentsJson:'[{"method":"cash","amount":5},{"method":"card","amount":3}]'}]),totals('20.00','3.00')],
  ['exact embedded huge numeric token',basis([{totalAmount:'9007199254740993.005',paymentsJson:'[{"method":"card","amount":9007199254740993.005}]'}]),totals('20.00','9007199254740993.01')],
  ['numeric strings and exponent',basis([{paymentsJson:'[{"method":"card","amount":" +.5e00001 "}]'}]),totals('20.00','5.00')],
  ['refunded malformed amounts stay excluded',basis([{totalAmount:'old-unknown',isRefunded:true,paymentsJson:'invalid old JSON'}]),totals()],
  ['split ignores irrelevant header label',basis([{paymentType:'cash ',paymentsJson:'[{"method":"card","amount":2}]'}]),totals('20.00','2.00')],
 ];
 for(const[name,input,expected]of cases)await check(name,input,expected);
 const original=basis([{totalAmount:'100',paymentType:'cash'}]);const later=structuredClone(original);later.inputs[0].isRefunded=true;
 await check('saved original snapshot remains its own basis',original,totals('120.00'));await check('later action has its own refund basis',later,totals());
 await check('declared totals are ignored', {...original,expected:{cash:'999',card:'999',digital:'999'},expectedNativeRaw:{cash:'999'}},totals('120.00'));
 const unsupported=[
  [{},'FIN62_LEGACY_CONTEXT_REQUIRED'],
  [{...basis(),prototypeVersion:1,formula:'sqlserver-current-sales-net-refund-raw-v1'},'FIN62_LEGACY_NATIVE_MATH_UNVERIFIED'],
  [basis([{paymentsJson:'bad-json'}]),'FIN62_PAYMENTS_UNVERIFIED'],
  [basis([{paymentsJson:'[{"method":"cash","method":"card","amount":2}]'}]),'FIN62_DUPLICATE_JSON_KEY'],
  [basis([{paymentsJson:'{"irrelevant":{"a":1,"a":2}}'}]),'FIN62_DUPLICATE_JSON_KEY'],
  [basis([{paymentType:'cash ',totalAmount:'1'}]),'FIN62_METHOD_CONTEXT_REQUIRED'],
  [basis([{paymentsJson:'[{"method":"card","amount":true}]'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{totalAmount:'NaN',paymentType:'cash'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{totalAmount:'1e39',paymentType:'cash'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{totalAmount:'1e-39',paymentType:'cash'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{totalAmount:'1'.repeat(77),paymentType:'cash'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{totalAmount:'0'.repeat(129),paymentType:'cash'}]),'FIN62_NUMERIC_UNSUPPORTED'],
  [basis([{branchId:'B',isRefunded:true}]),'FIN62_INPUT_INVALID'],
  [basis([{isRefunded:'false'}]),'FIN62_INPUT_INVALID'],
  [basis([{id:id(1)},{id:id(1)}]),'FIN62_INPUT_INVALID'],
  [{...basis(),inputs:Array(20001).fill({})},'FIN62_BASIS_LIMIT'],
  [{...basis(),extra:'x'.repeat(6*1024*1024)},'FIN62_BASIS_LIMIT'],
 ];
 for(const[input,code]of unsupported){const result=await validate(input);assert.equal(result.status,'unsupported');assert.equal(result.code,code);assert(!('expected'in result));passed++;}
 for(const raw of [JSON.stringify(basis()).replace('"prototypeVersion":2','"prototypeVersion":2.0'),JSON.stringify(basis()).replace('"prototypeVersion":2','"prototypeVersion":"2"'),JSON.stringify(basis()).replace('"prototypeVersion":2','"prototypeVersion":2,"prototypeVersion":2')]){
  assert.equal((await rawValidate(raw)).status,'unsupported');assert.throws(()=>calculateKnownTenderTotals(raw));passed++;
 }
 for(const branchId of ['😀'.repeat(64),'😀'.repeat(65)]){const input={...basis(),branchId};const result=await validate(input);assert.equal(result.status,branchId.length<=128?'computed':'unsupported');passed++;}
 // Deterministic independent BigInt-vs-PostgreSQL comparisons. No random source
 // or floating-point value is used to calculate a financial expectation.
 let seed=6173;for(let n=0;n<128;n++){
  seed=(seed*48271)%2147483647;const value=((BigInt(seed)-1073741824n)*100000000003n).toString();
  const amount=value.slice(0,-12)+'.'+value.slice(-12);const total=amount.startsWith('-.')?amount.replace('-.','-0.'):amount;
  const input=basis([{totalAmount:total,paymentType:['cash','card','qr'][n%3]},{totalAmount:'0.005',paymentType:'card'}],n%2?'-.005':'20');
  const result=await validate(input);assert.equal(result.status,'computed');
 }passed++;console.log('PASS 128 independent BigInt/PostgreSQL parity fixtures');
 // Existing PG rounded-numeric basis keeps its own v1 label. Native legacy is
 // not inferred from this parity or recalculated through canonical new rules.
 await db.exec('CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,opening_float numeric);CREATE TABLE public.sales(id uuid PRIMARY KEY,store_id text,shift_id text,total_amount numeric,payment_type text,payments jsonb,is_refunded boolean,row_version bigint);');
 await db.exec(await read('scripts/preparation/shift-financial-basis.sql'));
 await db.query('INSERT INTO shifts VALUES($1,$2,0)',[shift,branch]);
 for(const[value,payments]of [['1.005','[]'],['-0.005','[]'],['2.675','[]'],['1','[null]'],['1','[{"method":"cash ","amount":1}]'],['1','[{"method":7,"amount":1}]']]){await db.exec('TRUNCATE sales');await db.query('INSERT INTO sales VALUES($1,$2,$3,$4,\'card\',$5,false,1)',[id(1),branch,shift,value,payments]);
  const input=(await db.query('SELECT fin62_preparation.shift_financial_basis($1,$2) value',[branch,shift])).rows[0].value;
  const result=await validate(input);assert.equal(result.status,'computed');assert.deepEqual(result.expected,input.expected);passed++;
 }
 if(oracle){
  const filename=decodeURIComponent(new URL('./test-shift-financial-basis-sqlserver.cjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/,'$1'));
  const source=await read('scripts/test-shift-financial-basis-sqlserver.cjs');const anchor='const raw=await read(tx),basis=JSON.parse(raw);';assert(source.includes(anchor));
  const extra=[['legacy cash precision counterexample',[{total:'0.00000000051',method:'cash'}]],['legacy duplicate JSON',[{total:'2',rawPayments:'[{"method":"cash","method":"card","amount":2,"amount":99}]'}]],['legacy tab empty',[{total:'5',method:'cash',rawPayments:'[\t]'}]],['legacy split 12dp',[{total:'0.123456789123',rawPayments:'[{"method":"cash","amount":0.223456789123},{"method":"card","amount":0.000000000011}]'}]]];
  const modified=source.replace(anchor,anchor+'console.log("FIN62_ORACLE "+raw);').replace('const cases=[','const cases=['+extra.map(row=>JSON.stringify(row)).join(',')+',');
  const program='const Module=require("node:module");const path=require("node:path");const filename='+JSON.stringify(filename)+';process.argv=[process.execPath,filename,"--run"];const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile('+JSON.stringify(modified)+',filename);';
  const output=execFileSync(process.execPath,['-e',program],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
  const captures=output.split(/\r?\n/).filter(line=>line.startsWith('FIN62_ORACLE ')).map(line=>JSON.parse(line.slice('FIN62_ORACLE '.length)));
  assert.equal(captures.length,23);assert.equal(captures[0].expectedNativeRaw.cash,'20.000000000510','Retain real SQL Server legacy counterexample, do not guess its scale');
  let computed=0,held=0;
  for(const input of captures){
   const legacy={...input,prototypeVersion:1,formula:'sqlserver-current-sales-net-refund-raw-v1'};
   const result=await validate(legacy);assert.equal(result.status,'unsupported');assert.equal(result.code,'FIN62_LEGACY_NATIVE_MATH_UNVERIFIED');assert(!('expected'in result));
   const current=await validate(input);if(current.status==='computed')computed++;else held++;
  }
  assert(computed>0&&held>0);assert(output.includes('Cleaned owned basis fixture'));passed++;
  console.log('PASS 23 captured native inputs: '+computed+' canonical JS/PG matches / '+held+' ambiguous bases held; all legacy variants unverified');
 }
 console.log(passed+' isolated canonical financial math groups passed. Preparation only; no completeness, admission or deployment claim.');
}finally{await db.close();}
