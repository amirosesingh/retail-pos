"use strict";
// Emits one plain SSMS file. Never connects to or executes a database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {digest,canonical,renderExistingLocalUpgrade}=require('./lib/existing-local-upgrade.cjs');
const {validationSql,literal}=require('./lib/local-upgrade-catalogue.cjs');
const root=path.resolve(__dirname,'..');
const manifestPath=path.join(root,'database/sqlserver/prepared/existing-upgrade-1.4.82.manifest.json');
const outputPath=path.join(root,'database/sqlserver/retail-pos-existing-upgrade-1.4.82.sql');
const SOURCES=[
 ['025_shift_financial_bases','database/sqlserver/prepared/025_shift_financial_bases.sql',true],
 ['026_shift_financial_operations','database/sqlserver/prepared/026_shift_financial_operations.sql',true],
 ['027_shift_branch_sharing','database/sqlserver/prepared/027_shift_branch_sharing.sql',true],
 ['028_retained_shift_evidence','docs/database/retained-shift-recovery-evidence.sql',false],
 ['029_legacy_shift_recovery','docs/database/legacy-shift-recovery-outbox.sql',false],
 ['030_reviewed_shift_adoption','docs/database/reviewed-shift-adoption.sql',false],
];
const SELECTORS={
 '025_shift_financial_bases':{tables:['pos_sync_shift_financial_bases','pos_sync_shift_financial_proofs']},
 '026_shift_financial_operations':{tables:['pos_sync_shift_financial_origins','pos_sync_shift_financial_heads','pos_sync_shift_financial_events','pos_sync_shift_financial_sale_lineage','pos_sync_shift_financial_observations','pos_sync_shift_financial_versions','pos_sync_shift_financial_refreshes','pos_sync_shift_financial_noops']},
 '027_shift_branch_sharing':{tables:[],columns:[{table:'pos_store_settings',column:'allow_branch_shift_sharing'}]},
 '028_retained_shift_evidence':{tables:['pos_shift_recovery_evidence']},
 '029_legacy_shift_recovery':{tables:['pos_sync_shift_legacy_recoveries','pos_sync_shift_legacy_recovery_receipts']},
 '030_reviewed_shift_adoption':{tables:['pos_shift_recovery_adoptions']},
};
function sourceModules(){return SOURCES.map(([id,file,standaloneGuard])=>{const sql=fs.readFileSync(path.join(root,file),'utf8');return{id,file,standaloneGuard,sql,sha256:digest(sql),canonicalHash:digest(canonical(sql)),selectors:SELECTORS[id]};});}
function packageUpgrade(manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))){
 assert.equal(manifest.version,'1.4.82');assert.equal(manifest.format,1);assert.equal(manifest.registryTables,70);
 const {installerSections}=require('../electron/db/installer-source.cjs');
 const core=installerSections();
 assert.equal(digest(canonical(core.schema)),manifest.coreSources.schema,'Reviewed core source changed');
 assert.deepEqual(core.migrations.map(m=>[m.name,digest(canonical(m.sql))]),manifest.coreSources.migrations,'Reviewed core migrations changed');
 const sources=sourceModules();
 assert(Array.isArray(manifest.modules),'Reviewed module manifest is missing');
 assert.deepEqual(manifest.modules.map(module=>module.id),sources.map(module=>module.id),'Reviewed module set/order changed; no upgrade was generated');
 const modules=sources.map(module=>{
  const saved=manifest.modules.find(item=>item.id===module.id);assert(saved&&saved.sourceHash===module.canonicalHash,'Reviewed module changed: '+module.id);
  assert.deepEqual(saved.shape.selectors,module.selectors);
  const probes=[...module.selectors.tables.map(name=>`OBJECT_ID(${literal('dbo.'+name)}) IS NOT NULL`),...(module.selectors.columns??[]).map(c=>`COL_LENGTH(${literal('dbo.'+c.table)},${literal(c.column)}) IS NOT NULL`)];
  return{...module,existingValidation:validationSql(saved.shape,module.id),existsSql:probes.join(' OR ')};
 });
 return renderExistingLocalUpgrade({version:manifest.version,modules,coreValidation:validationSql(manifest.core,'Retail schema24')});
}
if(require.main===module){
 assert.deepEqual(process.argv.slice(2),process.argv[2]==='--write'?['--write']:['--check'],'Use only --write or --check; no database connection arguments');
 const result=packageUpgrade();
 if(process.argv[2]==='--write')fs.writeFileSync(outputPath,result.sql,'utf8');
 else assert.equal(fs.readFileSync(outputPath,'utf8'),result.sql,'Regenerate the reviewed standalone upgrade file');
 console.log(JSON.stringify({file:path.relative(root,outputPath),sha256:result.sha256,modules:result.sources.map(s=>s.id)}));
}
module.exports={sourceModules,SELECTORS,packageUpgrade,manifestPath,outputPath};
