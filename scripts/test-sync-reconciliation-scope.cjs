#!/usr/bin/env node
/** Opt-in SQL Server #temp fixtures; no POS database, persistent schema or credentials. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,execFileSync}=require('node:child_process');
const {createRequire}=require('node:module'),{runInNewContext}=require('node:vm');
const root=path.resolve(__dirname,'..'),BASELINE='2c51e338f164514120685c9a57f6e1894e835408';
const usage='node scripts/test-sync-reconciliation-scope.cjs --run [--server "(localdb)\\MSSQLLocalDB"] [--sqlcmd PATH]';
const args=process.argv.slice(2),options={};
if(!args.length||args.includes('--help')){console.log(usage);process.exit(0);}
assert.equal(args.shift(),'--run',usage);
for(let i=0;i<args.length;i+=2){assert(['--server','--sqlcmd'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]),usage);options[args[i]]=args[i+1];}
const server=options['--server']||'(localdb)\\MSSQLLocalDB',host=server.split('\\')[0].toLowerCase();
assert(/^(?:[\w.-]+|\(local\)|\(localdb\))(?:\\[\w-]+)?$/i.test(server),'Only a local named instance is allowed.');
assert(['.','(local)','(localdb)','localhost','127.0.0.1',os.hostname().toLowerCase()].includes(host),'External servers are forbidden.');
if(host==='(localdb)')assert.equal(server.split('\\')[1]?.toLowerCase(),'mssqllocaldb','Use only the default local test instance.');
const sqlcmd=options['--sqlcmd']||'C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/180/Tools/Binn/SQLCMD.EXE';
assert(/^sqlcmd(?:\.exe)?$/i.test(path.basename(sqlcmd))&&fs.existsSync(sqlcmd),'Use the installed sqlcmd, without credentials.');
const scope=require('../electron/db/branch-scope.cjs');
const {localTableCounts}=require('../electron/sync/reconciliation.cjs');
const {localSignature,signatureRows}=require('../electron/sync/verifier.cjs');
const {toCloudRow}=require('../electron/sync/row-codec.cjs');
const baselineModule={exports:{}};
runInNewContext(execFileSync('git',['show',`${BASELINE}:electron/db/branch-scope.cjs`],{cwd:root,encoding:'utf8'}),{
 module:baselineModule,exports:baselineModule.exports,require:createRequire(path.join(root,'electron/db/branch-scope.cjs')),
},{filename:'reviewed-before-SYNC78/branch-scope.cjs'});
const baseline=baselineModule.exports;
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const col=(name,type='text',extra={})=>({cloudColumn:name,sqlServerColumn:name,cloudType:type,...extra});
const key=(type='uuid')=>col('id',type,{primaryKey:true});
const fk=(name,table)=>col(name,'uuid',{foreignKey:true,foreignKeyTarget:{table,column:'id'}});
const data={},tables=[];
function table(name,columns,rows,retentionClass='reference'){
 tables.push({cloudTable:name,sqlServerTable:name,scope:'branch',retentionClass,columns});data[name]=rows;
}
const productCases=[
 ['own_a','a',{a:2}],['sibling_b','b',{b:1}],['foreign_c','c',{c:9}],
 ['unowned_positive_a',null,{a:1.5}],['unowned_negative_b',null,{b:-1}],['unowned_foreign_c',null,{c:2}],
 ['unowned_zero_a',null,{a:0}],['empty_unowned',null,{}],['posted_b','c',{}],['pending_b','c',{}],
 ['zero_transfer_b','c',{}],['cached_b','c',{},['b']],['cached_unknown','c',{},['missing']],
 ['posted_a','c',{}],['cancelled_b','c',{}],['unposted_b','c',{}],['own_zero_a','a',{a:0}],['sibling_zero_b','b',{b:0}],
];
table('products',[key(),col('name'),col('owner_store_id'),col('stock_by_store','jsonb'),col('catalogue_store_ids','jsonb'),col('stock_quantity','numeric')],
 productCases.map(([name,owner,stock,cached=[]],i)=>({id:uuid(i+1),name,owner_store_id:owner,stock_by_store:stock,catalogue_store_ids:cached,stock_quantity:2})));
table('stores',[key('text'),col('group_id'),col('private_catalogue','boolean')],[{id:'a',group_id:'g1',private_catalogue:false},{id:'b',group_id:'g1',private_catalogue:false},{id:'c',group_id:'g2',private_catalogue:false}]);
table('pos_settings',[key('integer'),col('integration_settings','jsonb')],[{id:1,integration_settings:{}}]);
const settingsRows=[['GLOBAL',''],['BRANCH','a'],['BRANCH','b'],['CLUSTER','g1'],['CLUSTER','g2'],['TERMINAL','t1'],['TERMINAL','t2'],['PRIVATE','a']]
 .map(([scope,scope_id],i)=>({id:uuid(300+i),scope,scope_id,key:'fixture_'+i,value:{enabled:true}}));
for(const name of['settings_scoped','settings_overrides'])table(name,[key(),col('scope'),col('scope_id'),col('key'),col('value','jsonb')],settingsRows);
const transferCases=[['b','completed','2099-01-01T00:00:00Z',9,2,2],['b','approved',null,10,2,2],['b','completed','2099-01-01T00:00:00Z',11,0,2],['b','cancelled','2099-01-01T00:00:00Z',15,2,2],['a','completed_with_discrepancy','2099-01-01T00:00:00Z',14,null,2],['b','completed',null,16,2,2]];
table('stock_transfers',[key(),col('from_store_id'),col('to_store_id'),col('status'),col('posted_at','timestamptz')],
 transferCases.map(([to,status,posted],i)=>({id:uuid(100+i),from_store_id:'c',to_store_id:to,status,posted_at:posted})));
table('stock_transfer_items',[key(),fk('transfer_id','stock_transfers'),fk('product_id','products'),col('quantity_verified','numeric'),col('quantity_received','numeric')],
 transferCases.map(([, , ,product,verified,received],i)=>({id:uuid(200+i),transfer_id:uuid(100+i),product_id:uuid(product),quantity_verified:verified,quantity_received:received})));
table('product_barcodes',[key(),fk('product_id','products'),col('barcode')],data.products.map((product,i)=>({id:uuid(1000+i),product_id:product.id,barcode:'000'+i})));
table('promotions',[key(),fk('foc_product_id','products'),col('name')],[...data.products.map((product,i)=>({id:uuid(2000+i),foc_product_id:product.id,name:'promotion_'+i})),{id:uuid(2999),foc_product_id:null,name:'shared_without_foc'}]);
table('purchase_orders',[key(),col('store_id'),col('reference')],['a','b',null,''].map((store_id,i)=>({id:uuid(400+i),store_id,reference:'PO-'+i})));
for(const name of['authorization_actions','authorization_action_history'])table(name,[key(),col('scope_type'),col('scope_id')],
 [['global',''],['branch','a'],['cluster','g1'],['branch','b'],['cluster','g2'],['terminal','t1']].map(([scope_type,scope_id],i)=>({id:uuid(500+i),scope_type,scope_id})));
table('sales',[key(),col('store_id'),col('created_at','timestamptz'),col('total','numeric')],[{id:uuid(600),store_id:'a',created_at:'2099-01-01T00:00:00Z',total:10},{id:uuid(601),store_id:'a',created_at:'2000-01-01T00:00:00Z',total:20},{id:uuid(602),store_id:'b',created_at:'2099-01-01T00:00:00Z',total:30}],'historical');
table('pin_attempts',[key(),col('key'),col('attempts','integer')],['electron:cashier','approval-lookup:cashier','cloud:cashier','cashier'].map((key,i)=>({id:uuid(700+i),key,attempts:i})));
const registry={tables},byName=name=>tables.find(t=>t.cloudTable===name);
const visible=[1,2,4,5,9,12,14,17,18].map(uuid),owned=[1,4,5,6,7,8,17].map(uuid);
const wanted={
 products:visible,stores:['a','b','c'],pos_settings:[1],settings_scoped:[300,301,303,305].map(uuid),settings_overrides:[300,301,303,305].map(uuid),
 stock_transfers:[uuid(104)],stock_transfer_items:[uuid(204)],product_barcodes:[1,2,4,5,9,12,14,17,18].map(n=>uuid(999+n)),
 promotions:[...[1,2,4,5,9,12,14,17,18].map(n=>uuid(1999+n)),uuid(2999)],purchase_orders:[uuid(400)],
 authorization_actions:[500,501,502].map(uuid),authorization_action_history:[500,501,502].map(uuid),sales:[uuid(600)],pin_attempts:[uuid(702),uuid(703)],
};
const literal=value=>value==null?'NULL':`N'${String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")}'`;
function setup(collation){
 assert(['SQL_Latin1_General_CP1_CI_AS','Latin1_General_BIN2'].includes(collation));
 const sqlType=column=>column.cloudType==='uuid'?'uniqueidentifier':column.cloudType==='integer'?'int':column.cloudType==='numeric'?'decimal(38,8)':column.cloudType==='boolean'?'bit':column.cloudType==='timestamptz'?'datetimeoffset(7)':`nvarchar(${column.cloudType==='jsonb'?'max':'450'}) COLLATE ${collation}`;
 let sql="SET NOCOUNT ON;SET XACT_ABORT ON;IF DB_NAME()<>N'tempdb' THROW 51078,N'Only tempdb is allowed',1;\n";
 for(const t of tables){
  sql+=`CREATE TABLE #sync78_${t.sqlServerTable}(${t.columns.map(c=>`[${c.sqlServerColumn}] ${sqlType(c)} NULL`).join(',')});\n`;
  sql+=`INSERT #sync78_${t.sqlServerTable} VALUES ${data[t.cloudTable].map(row=>'('+t.columns.map(c=>literal(c.cloudType==='boolean'?Number(row[c.cloudColumn]):row[c.cloudColumn])).join(',')+')').join(',')};\n`;
 }
 return sql;
}
function fixtureQuery(sql){
 assert(/^SELECT\b/i.test(sql.trim()),'Only captured SELECTs may run.');
 const rewritten=sql.replace(/\bdbo\.\[?([A-Za-z_][A-Za-z0-9_]*)\]?/g,(_all,name)=>{assert(byName(name),'Unexpected table '+name);return '#sync78_'+name;});
 assert(!/\b(?:dbo|public)\s*\.|\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|EXEC|USE)\b/i.test(rewritten),'Unsafe query escaped the fixture namespace.');
 return rewritten.replace(/;\s*$/,'');
}
const ownedTemp=fs.mkdtempSync(path.join(os.tmpdir(),'CodexSyncReconciliation-'));
let executions=0,groups=0;
function queryRows(sql,inputs,collation){
 const declarations=Object.entries(inputs).map(([name,value])=>{
  assert(/^(?:branch|terminal|cutoff|limit|cursor\d+)$/.test(name),'Unexpected captured parameter '+name);
  return `DECLARE @${name} ${name==='limit'?'int':name==='cutoff'?'datetimeoffset(7)':'nvarchar(450)'}=${literal(value instanceof Date?value.toISOString():value)};`;
 }).join('\n');
 const file=path.join(ownedTemp,'fixture.sql');
 fs.writeFileSync(file,'\ufeff'+setup(collation)+declarations+`\nDECLARE @sync78_wire nvarchar(max)=(SELECT result.* FROM (${fixtureQuery(sql)}) result FOR JSON PATH,INCLUDE_NULL_VALUES);SELECT N'SYNC78_RESULT:'+COALESCE(@sync78_wire,N'[]');`,'utf8');
 const result=spawnSync(sqlcmd,['-S',server,'-E','-C','-d','tempdb','-X1','-x','-b','-l','8','-t','30','-i',file,'-r1','-y','0','-w','65535'],{encoding:'utf8',timeout:45000,windowsHide:true,maxBuffer:4*1024*1024});
 if(result.error)throw result.error;
 assert.equal(result.status,0,'SQL #fixture failed: '+String(result.stderr||result.stdout));
 const output=String(result.stdout).trim(),marker='SYNC78_RESULT:';assert(output.startsWith(marker),'Unexpected sqlcmd output: '+output.slice(0,180));
 const rows=JSON.parse(output.slice(marker.length).replace(/\r?\n/g,''));assert(Array.isArray(rows));executions++;return rows;
}
function managerFor(collation){
 const calls=[];
 return{calls,manager:{pool:{request:()=>{const inputs={};return{input(name,value){inputs[name]=value;return this;},async query(sql){calls.push({sql,inputs});return{recordset:queryRows(sql,inputs,collation)};}};}}}};
}
const ids=rows=>rows.map(row=>String(row.id).toLowerCase()).sort();
function pass(name){groups++;console.log('PASS '+name);}
function select(tableName,predicate,collation,branch='a',historyDays=90){
 return queryRows(`SELECT source.* FROM dbo.[${tableName}] source WHERE ${predicate||'1=1'}`,{branch,terminal:'t1',cutoff:new Date(Date.now()-Math.max(30,historyDays)*86400000)},collation);
}
async function main(){try{
 for(const collation of['SQL_Latin1_General_CP1_CI_AS','Latin1_General_BIN2']){
  const countsFixture=managerFor(collation),counts=await localTableCounts(countsFixture.manager,registry,'a',90,'t1');
  assert.equal(countsFixture.calls.length,1,'All registered counts must share one parameterized SQL read.');
  assert.deepEqual({...counts},Object.fromEntries(tables.map(t=>[t.cloudTable,String(wanted[t.cloudTable].length)])));
  assert.equal(countsFixture.calls[0].inputs.branch,'a');assert.equal(countsFixture.calls[0].inputs.terminal,'t1');
  pass(collation+': actual localTableCounts returns all14 scoped exact counts in one read');
  for(const name of['products','product_barcodes','promotions','purchase_orders']){
   const t=byName(name),comp=select(name,scope.comparisonWhere(registry,t),collation);
   assert.deepEqual(ids(comp),wanted[name].map(String).sort());
   for(const method of['scopedWhere','branchPredicate']){
    const before=select(name,baseline[method](registry,t),collation),after=select(name,scope[method](registry,t),collation);
    assert.deepEqual(ids(after),ids(before),'Comparison must not modify existing '+method+' for '+name);
    const expected=name==='products'?owned:name==='product_barcodes'?owned.map(id=>uuid(999+Number(id.slice(-12)))):name==='promotions'?[...owned.map(id=>uuid(1999+Number(id.slice(-12)))),uuid(2999)]:[uuid(400)];
    assert.deepEqual(ids(after),expected.sort());
   }
   pass(collation+': '+name+' comparison expands only catalogue reads; upload/write predicates retain exact records');
  }
  assert.deepEqual(ids(select('products',scope.comparisonWhere(registry,byName('products')),collation,'b')),visible.slice().sort());
  assert.equal(select('products',scope.comparisonWhere(registry,byName('products')),collation,'missing').length,0);
  pass(collation+': sibling catalogue, negative stock and posted-transfer proof work; unknown branch sees no products');
  const purchase=byName('purchase_orders');
  assert.deepEqual(ids(select('purchase_orders',scope.rendererReadBranchPredicate(registry,purchase),collation)),[400,402,403].map(uuid).sort());
  assert.deepEqual(ids(select('purchase_orders',scope.comparisonWhere(registry,purchase),collation)),[uuid(400)]);
  pass(collation+': legacy unowned purchase-order renderer exception never widens comparison or writes');
  for(const name of['products','product_barcodes','promotions','purchase_orders','settings_scoped','settings_overrides','authorization_actions','authorization_action_history','sales','pin_attempts']){
   const t=byName(name),signatureFixture=managerFor(collation);
   const actual=await localSignature({connectionManager:signatureFixture.manager,registry,table:t,branchId:'a',historyDays:90,terminalId:'t1'});
   const expected=data[name].filter(row=>wanted[name].some(id=>String(id)===String(row.id))).map(row=>toCloudRow(t,row));
   assert.equal(actual,signatureRows(t,expected),'Actual selected signature differs for '+name);
   assert.equal(signatureFixture.calls.length,1,'Small signature fixture must issue one bounded read.');
   assert.equal(actual.split(':')[0],String(wanted[name].length));
  }
  pass(collation+': actual localSignature hashes exact selected rows for10 tables, including shared null-FOC promotions');
  const settings=select('settings_scoped',scope.comparisonWhere(registry,byName('settings_scoped')),collation);
  assert.deepEqual(settings.map(row=>row.scope).sort(),['BRANCH','CLUSTER','GLOBAL','TERMINAL']);
  const allHistory=select('sales',scope.comparisonWhere(registry,byName('sales'),{historyDays:7300}),collation,'a',7300);
  assert.deepEqual(ids(allHistory),[600,601].map(uuid));
  assert.deepEqual(ids(select('pin_attempts',scope.comparisonWhere(registry,byName('pin_attempts')),collation)),[702,703].map(uuid));
  pass(collation+': settings scope, historical retention and native-only PIN exclusions survive comparison/signature changes');
 }
 console.log(`PASS ${groups} groups / ${executions} genuine SQL Server #temp reads; no existing database/schema/data changed.`);
}finally{
 const resolved=path.resolve(ownedTemp),tempRoot=path.resolve(os.tmpdir());
 assert(resolved.startsWith(tempRoot+path.sep)&&path.basename(resolved).startsWith('CodexSyncReconciliation-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}}
main().catch(error=>{console.error(error);process.exitCode=1;});
