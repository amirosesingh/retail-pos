const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const {LocalDataLifecycle}=require('../electron/jobs/lifecycle.cjs');
const {CloudClient}=require('../electron/sync/cloud-client.cjs');

function load(file,names,deps={}) {
  const source=stripTypeScriptTypes(readFileSync(file,'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
  return new Function(...Object.keys(deps),`${source}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
const identity=load('src/lib/company-identity.ts',['withoutCompanyIdentity','isCompanyIdentityPath']);

test('branch and terminal overrides cannot mask global identity; layout still resolves',()=>{
  const {sectionAllowsTier}=load('src/lib/settings-sections.ts',['sectionAllowsTier']);
  const {resolveScopedSettings}=load('src/lib/branch-settings.ts',['resolveScopedSettings'],{...identity,sectionAllowsTier});
  const base={receipt:{companyName:'Cloud Company',logo:'cloud-logo',phone:'123',paper:'80mm',showLogo:true}};
  const branch={receipt:{companyName:'',logo:'old-logo',phone:'999'}};
  const scope={locks:{},overrides:{CLUSTER:{},BRANCH:{receiptIdentity:branch},TERMINAL:{receiptLayout:{receipt:{logo:'terminal-logo',paper:'58mm',showLogo:false}}}}};
  const result=resolveScopedSettings(base,scope,(a,b)=>({...a,...b,receipt:{...a.receipt,...b.receipt}}));
  assert.deepEqual(result.settings.receipt,{companyName:'Cloud Company',logo:'cloud-logo',phone:'123',paper:'58mm',showLogo:false});
  assert.equal(branch.receipt.logo,'old-logo');
  assert.equal(identity.isCompanyIdentityPath('receipt.logo'),true);
  assert.equal(identity.isCompanyIdentityPath('receipt.paper'),false);
});

test('only GLOBAL field rows can overlay the global settings snapshot',()=>{
  const file=readFileSync('src/core/api/pos-db.ts','utf8');
  const piece=file.slice(file.indexOf('export const applySettingsFields ='),file.indexOf('const rowToShift ='));
  const source=stripTypeScriptTypes(piece).replace(/\bexport /g,'');
  const apply=new Function('settingsText',`${source};return applySettingsFields;`)(String);
  assert.deepEqual(apply({id:1,company_name:'Cloud',logo_data_url:'global-logo'},[
    {scope:'GLOBAL',scope_id:'',key:'pos_field:phone',value:'123'},
    {scope:'BRANCH',scope_id:'A',key:'pos_field:company_name',value:'Wrong'},
    {scope:'TERMINAL',scope_id:'T',key:'pos_field:logo_data_url',value:''},
  ]),{id:1,company_name:'Cloud',logo_data_url:'global-logo',phone:'123'});
  const base={id:1,logo_data_url:'cloud-logo',updated_at:'2026-10-09T00:00:00Z'};
  assert.equal(apply(base,[{key:'pos_field:logo_data_url',value:'',updated_at:'2026-10-08T00:00:00Z'}]).logo_data_url,'cloud-logo');
  assert.equal(apply(base,[{key:'pos_field:logo_data_url',value:'',updated_at:'2026-10-10T00:00:00Z'}]).logo_data_url,'');
});

test('all empty company identity columns are repaired without replacing nonempty local values',async()=>{
  const queries=[];const inputs=new Map();
  class Request {input(k,v){inputs.set(k,v);return this;}async query(sql){queries.push(sql);return {};}}
  const fields=['company_name','logo_data_url','tax_number','reg_number','phone','website','header_text','footer_text'];
  const client=new CloudClient({configStore:{},terminalStore:{},connectionManager:{sql:()=>({Request})}});
  const table={cloudTable:'pos_settings',sqlServerTable:'pos_settings',columns:[{cloudColumn:'id',sqlServerColumn:'id',primaryKey:true},...fields.map(name=>({cloudColumn:name,sqlServerColumn:name}))]};
  await client.applyLocalBatch({},table,{rows:[{row_data:{id:1,...Object.fromEntries(fields.map(name=>[name,`cloud-${name}`]))}}],tombstones:[]});
  assert.equal(queries.length,9);
  for(const [index,field] of fields.entries()){
    assert.ok([...inputs.values()].includes(`cloud-${field}`));
    assert.ok(queries[index+1].includes(`SET [${field}]=@`));
    assert.ok(queries[index+1].includes(`NULLIF(LTRIM(RTRIM([${field}])),N'') IS NULL`));
    assert.ok(queries[index+1].includes('CHANGE_TRACKING_CONTEXT (0x434C4F5544)'));
  }
});

function setupLifecycle(pending=false) {
  const events=[];
  class Transaction {async begin(){}async commit(){events.push('commit');}async rollback(){events.push('rollback');}}
  const registry={tables:['pos_settings','settings_scoped'].map(name=>({cloudTable:name,sqlServerTable:name,columns:[{cloudColumn:'id',primaryKey:true}]}))};
  const lifecycle=new LocalDataLifecycle({registry,connectionManager:{pool:{},sql:()=>({Transaction})},
    cloud:{bootstrapPage:async({table})=>{events.push(`read:${table}`);return {rows:[{id:1}],cursor:null};},applyLocalBatch:async(_tx,table)=>events.push(`merge:${table.cloudTable}`)},
    reader:{unacknowledged:async()=>pending?new Set(['{"id":1}']):new Set()},
    databaseService:{transition(){}},jobRepository:{active:async()=>null,completed:async()=>true},syncCoordinator:{},
    publish:event=>events.push(`notify:${event.tables[0]}`)});
  lifecycle.pushWithGapRecovery=async()=>{events.push('push');throw new Error('Unrelated sales upload failed');};
  return {lifecycle,events};
}

test('setup downloads and announces shared settings before an unrelated upload can fail',async()=>{
  const {lifecycle,events}=setupLifecycle();
  await assert.rejects(lifecycle.ensure({branchId:'A'}),/sales upload failed/);
  assert.deepEqual(events,['read:pos_settings','merge:pos_settings','commit','notify:pos_settings','read:settings_scoped','merge:settings_scoped','commit','notify:settings_scoped','push']);
});

test('early shared-settings refresh preserves unacknowledged local edits',async()=>{
  const {lifecycle,events}=setupLifecycle(true);
  await assert.rejects(lifecycle.ensure({branchId:'A'}),/sales upload failed/);
  assert.ok(!events.some(event=>event.startsWith('merge:')));
});

test('fresh terminal setup never writes a replacement company name',()=>{
  const source=readFileSync('src/platforms/web/components/pos/FirstRunSetup.tsx','utf8');
  assert.ok(!source.includes('updateSettings'));
  assert.ok(!source.includes('companyName:'));
  assert.ok(source.includes('writeBranding({ terminal:'));
});
