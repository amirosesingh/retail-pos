// Isolated FIN62 prototype: owned LocalDB only, no profile/URL/POS_Local access.
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {randomUUID}=require("node:crypto");
const {execFileSync}=require("node:child_process");
const sql=require("mssql/msnodesqlv8");
const {OperationsRepository}=require("../electron/db/repositories/operations.cjs");
const {calculateKnownTenderTotals}=require("../electron/sync/shift-financial-math.cjs");
async function main(){
 assert.deepEqual(process.argv.slice(2),["--run"]);
 const suffix=randomUUID().replaceAll("-",""),instance="CodexBasis_"+suffix,database="BasisFixture_"+suffix;
 const control=(...args)=>{const output=execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe",args,{windowsHide:true,timeout:30000});const text=output.toString(output.includes(0)?"utf16le":"utf8").replace(/^\uFEFF/,"");assert(!/failed|unexpected error/i.test(text),text);return text;};
 let owned=false,created=false,master,pool,server,passed=0;
 const connect=name=>new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:2},requestTimeout:10000}).connect();
 try{
  control("create",instance,"-s");owned=true;server=control("info",instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
  master=await connect("master");await master.request().batch(`CREATE DATABASE [${database}];`);created=true;pool=await connect(database);
  await pool.request().batch("CREATE TABLE dbo.shifts(id uniqueidentifier PRIMARY KEY,store_id nvarchar(450),opening_float decimal(38,12));CREATE TABLE dbo.sales(id uniqueidentifier PRIMARY KEY,store_id nvarchar(450),shift_id nvarchar(max),total_amount decimal(38,12),payment_type nvarchar(max),payments nvarchar(max),is_refunded bit,row_version bigint,discount_amount decimal(38,12));CREATE TABLE dbo.saved_basis(label nvarchar(40) PRIMARY KEY,basis_json nvarchar(max));");
  const shift=randomUUID(),other=randomUUID(),branch="A";
  await pool.request().input("shift",shift).input("other",other).query("INSERT dbo.shifts VALUES(@shift,N'A',20),(@other,N'B',500);");
  const prototype=readFileSync(require.resolve("../electron/db/shift-financial-basis.sql"),"utf8");
  let queryText;
  class TraceRequest extends sql.Request{async query(text){queryText=text;return super.query(text);}}
  const repository=new OperationsRepository({pool,sql:()=>({...sql,Request:TraceRequest})},{tables:[]});
  const normalize=value=>{const [whole,fraction=""]=String(value).split(".");const negative=whole.startsWith("-");const digits=(whole.replace(/^-/ ,"")+fraction).replace(/^0+/ ,"")||"0";if(digits==="0")return"0:0";let scale=fraction.length,result=digits;while(scale&&result.endsWith("0")){result=result.slice(0,-1);scale--;}return(negative?"-":"")+result+":"+scale;};
  const read=async(tx,b=branch,s=shift)=>(await new sql.Request(tx).input("branch",b).input("shift",s).query(prototype)).recordset[0].basis_json;
  const transaction=async work=>{const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const value=await work(tx);await tx.commit();return value;}catch(error){await tx.rollback().catch(()=>{});throw error;}};
  let sequence=0;
  const add=async(row={})=>{const id=row.id??"aaaaaaaa-aaaa-4aaa-8aaa-"+String(++sequence).padStart(12,"0");await pool.request().input("id",id).input("branch",row.branch??branch).input("shift",row.shift??shift)
   .input("total",row.total??null).input("method",row.method??null).input("payments",row.rawPayments??(row.payments===undefined?null:JSON.stringify(row.payments)))
   .input("refunded",row.refunded??null).input("version",row.version??"1").query("INSERT dbo.sales(id,store_id,shift_id,total_amount,payment_type,payments,is_refunded,row_version) VALUES(@id,@branch,@shift,TRY_CONVERT(decimal(38,12),@total),@method,@payments,@refunded,TRY_CONVERT(bigint,@version));");};
  const compare=async(tx)=>{
   const raw=await read(tx),basis=JSON.parse(raw);
   assert(Array.isArray(basis.inputs),"Synthetic basis missing inputs: "+raw);
   await repository.shiftExpectedTotals(branch,shift,tx);
   // Repeat the unchanged repository SQL under the same locked snapshot. SQL's
   // JSON preserves numeric lexemes that the driver otherwise maps to Number.
   const rows=await new sql.Request(tx).input("branch",branch).input("shift",shift).query(queryText.replace(/;\s*$/,"")+" FOR JSON PATH,INCLUDE_NULL_VALUES;");
   const exact=Object.values(rows.recordset[0])[0];
   assert.equal(basis.prototypeVersion,2);assert.equal(basis.numericScale,12);assert.equal(basis.formula,"canonical-exact-decimal-v2");
   for(const tender of ["cash","card","digital"]){const match=exact.match(new RegExp('"expected_'+tender+'":(-?\\d+(?:\\.\\d+)?)'));assert(match);assert.equal(normalize(basis.expectedNativeRaw[tender]),normalize(match[1]),tender+" exact native raw repository parity");}
   return{raw,basis};
  };
  const cases=[
   ["empty",[]],["single cash",[{total:"100",method:"cash"}]],["single card",[{total:"100",method:"card"}]],
   ["canonical half-cent",[{total:"1.005",method:"cash"}]],
   ["split change",[{total:"100",payments:[{method:"cash",amount:50},{method:"card",amount:80}]}]],
   ["change capped to cash",[{total:"50",payments:[{method:"cash",amount:10},{method:"card",amount:80}]}]],
   ["digital aliases",["wallet","bank_transfer","transfer","qr","online","ewallet"].map(method=>({total:"1.005",method}))],
   ["refunded inputs retained",[{total:"99",method:"cash",refunded:true},{total:"1",method:"cash",refunded:false}]],
   ["null and empty",[{total:null,method:"cash"},{total:"5",method:"cash",payments:[]},{total:"7",method:"card",payments:{bad:true}}]],
   ["null split total parity",[{total:null,payments:[{method:"cash",amount:5},{method:"card",amount:3}]}]],
   ["raw whitespace and invalid JSON",[{total:"5",method:"cash",rawPayments:"[  ]"},{total:"7",method:"card",rawPayments:"invalid-json"}]],
   ["case and duplicates",[{total:"10",payments:[{method:"CASH",amount:2},{method:"cash",amount:3},{method:"QR",amount:5}]}]],
   ["points and unknown",[{total:"10",method:"points"},{total:"9",method:"unknown"}]],
   ["negative precision",[{total:"-1.005",method:"cash"},{total:"-2.005",method:"card"}]],
   ["exact bigint and decimal",[{total:"9007199254740993.005",method:"cash",version:"9007199254740993"}]],
   ["exact embedded payment number",[{total:"9007199254740993.005",method:"card",rawPayments:'[{"method":"card","amount":9007199254740993.005}]'}]],
   ["canonical UUID text ordering",[{id:"00000001-0000-4000-8000-000000000000",total:"1",method:"cash"},{id:"00000000-0000-4000-8000-000000000001",total:"2",method:"cash"}]],
  ];
  for(const[name,inputs]of cases){await pool.request().query("DELETE dbo.sales;");for(const input of inputs)await add(input);await add({branch:"B",total:"9999",method:"cash"});await add({shift:other,total:"8888",method:"cash"});
   await transaction(async tx=>{const{basis,raw}=await compare(tx);assert.equal(basis.inputs.length,inputs.length);assert(basis.inputs.every(row=>row.branchId===branch&&row.shiftId===shift));
    assert.deepEqual(basis.inputs.map(row=>row.id),basis.inputs.map(row=>row.id).sort());
    if(name==="single cash")assert.deepEqual(calculateKnownTenderTotals(raw).expected,{cash:"120.00",card:"0.00",digital:"0.00"});
    if(name==="canonical half-cent"){assert.equal(calculateKnownTenderTotals(raw).expected.cash,"21.01");basis.expectedNativeRaw.cash="9999";assert.equal(calculateKnownTenderTotals(JSON.stringify(basis)).expected.cash,"21.01");}
    if(name==="refunded inputs retained")assert.equal(basis.inputs.filter(row=>row.isRefunded).length,1);
    if(name==="exact bigint and decimal"){assert.equal(basis.inputs[0].totalAmount,"9007199254740993.005000000000");assert.equal(basis.inputs[0].rowVersion,"9007199254740993");}
    if(name==="exact embedded payment number")assert.equal(basis.inputs[0].paymentsJson,'[{"method":"card","amount":9007199254740993.005}]');
   });passed++;console.log("PASS "+name);
  }
  await transaction(async tx=>{assert.equal(await read(tx,"B",shift),null);assert.equal(await read(tx,"A",other),null);});passed++;
  await assert.rejects(pool.request().input("branch",branch).input("shift",shift).query(prototype));passed++;
  const readCommitted=new sql.Transaction(pool);await readCommitted.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try{await new sql.Request(readCommitted).query("SET XACT_ABORT ON;INSERT dbo.saved_basis VALUES(N'caller-sentinel',N'untouched caller work');");
   await assert.rejects(read(readCommitted));
   const state=(await new sql.Request(readCommitted).query("SELECT XACT_STATE() state,@@TRANCOUNT transactions,(SELECT count(*) FROM dbo.saved_basis WHERE label=N'caller-sentinel') kept;")).recordset[0];
   assert.deepEqual(state,{state:1,transactions:1,kept:1});
  }finally{await readCommitted.rollback();}passed++;
  await pool.request().query("DELETE dbo.sales;");await add({total:"100",method:"cash"});
  const original=await transaction(async tx=>(await compare(tx)).raw);await pool.request().input("basis",original).query("INSERT dbo.saved_basis VALUES(N'original',@basis);");
  await pool.request().query("UPDATE dbo.sales SET is_refunded=1,row_version=2;");
  const recount=await transaction(async tx=>(await compare(tx)).raw);assert.notEqual(original,recount);assert.equal(normalize(JSON.parse(original).expectedNativeRaw.cash),normalize("120"));assert.equal(normalize(JSON.parse(recount).expectedNativeRaw.cash),normalize("20"));
  assert.equal((await pool.request().query("SELECT basis_json FROM dbo.saved_basis;")).recordset[0].basis_json,original);
  assert.equal(calculateKnownTenderTotals(original).expected.cash,"120.00");assert.equal(calculateKnownTenderTotals(recount).expected.cash,"20.00");passed++;
  console.log(passed+" isolated SQL Server financial-basis prototype groups passed; no persistence/admission/authentication claim.");
 }finally{
  await pool?.close();if(created){assert(owned&&/^BasisFixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}await master?.close();if(owned){control("stop",instance,"-k");control("delete",instance);console.log("Cleaned owned basis fixture "+instance+" / "+database);}
 }
}
main().catch(error=>{console.error(error.message);for(const preceding of error.precedingErrors??[])console.error(preceding.message);process.exitCode=1;});
