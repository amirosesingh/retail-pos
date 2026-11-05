// Separate Main-only vault: generic config IPC cannot manufacture a rollout.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{normalizeFinancialCapability}=require('../sync/financial-capability.cjs');
const fail=()=>{throw Object.assign(new Error('The saved financial capability cannot be verified. Saved work remains intact.'),{code:'EFINANCIAL_CAPABILITY_VAULT',table:'shifts'});};
const json=value=>JSON.stringify(value);
function createFinancialCapabilityVault({safeStorage,directory}){
 const requireVault=()=>{if(!safeStorage?.isEncryptionAvailable())fail();};
 const filename=binding=>path.join(directory(),'financial-capability-'+crypto.createHash('sha256').update(json(binding)).digest('hex')+'.enc');
 function read(binding,scope){
  requireVault();const file=filename(binding);let raw;
  try{if(!fs.existsSync(file))return null;if(fs.statSync(file).size>4*1024*1024)fail();raw=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{fail();}
  if(raw?.version!==1||json(raw.binding)!==json(binding)||!raw.descriptors||typeof raw.descriptors!=='object'||Array.isArray(raw.descriptors))fail();
  const value=raw.descriptors[scope.shiftId??'terminal'];return value===undefined?null:normalizeFinancialCapability(value,scope);
 }
 function save(binding,scope,descriptor){
  requireVault();const value=normalizeFinancialCapability(descriptor,scope),file=filename(binding);let saved={version:1,binding,descriptors:{}};
  if(fs.existsSync(file)){try{if(fs.statSync(file).size>4*1024*1024)fail();saved=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{fail();}if(saved.version!==1||json(saved.binding)!==json(binding)||!saved.descriptors||typeof saved.descriptors!=='object'||Array.isArray(saved.descriptors))fail();}
  const key=scope.shiftId??'terminal',prior=saved.descriptors[key];
  if(prior){const old=normalizeFinancialCapability(prior,scope);if(old.mode!=='disabled'&&(value.mode==='disabled'||old.rolloutId!==value.rolloutId||BigInt(value.revision)<BigInt(old.revision))||old.shiftMode==='required'&&value.shiftMode!=='required')fail();if(json(old)===json(value))return old;}
  if(Object.keys(saved.descriptors).length>=20001&&!Object.hasOwn(saved.descriptors,key))fail();
  saved.descriptors[key]=value;const raw=json(saved);if(Buffer.byteLength(raw,'utf8')>3*1024*1024)fail();const bytes=safeStorage.encryptString(raw),temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}catch{fail();}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return value;
 }
 return Object.freeze({read,save});
}
module.exports={createFinancialCapabilityVault};
