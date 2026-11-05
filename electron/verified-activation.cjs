const {recordId}=require('./sync/uuid-fields.cjs');
const normalize = value => recordId(String(value ?? '').trim());
function refuse(message) { throw Object.assign(new Error(message), {code:'EACTIVATION_BINDING'}); }
function binding(config) {
  if (!config?.tokenId) return null;
  const branches=[config.locationId,config.storeId,config.branchId].map(normalize).filter(Boolean);
  if (new Set(branches).size>1) refuse('The terminal has inconsistent branch assignments.');
  const branchId=branches[0]??null;
  const mode=config.deviceUse??(branchId?'operations':'management');
  if (!['operations','management'].includes(mode) || (mode==='management'&&branchId) || (mode==='operations'&&!branchId)) refuse('The terminal registration is incomplete.');
  return {id:normalize(config.tokenId),platform:config.deviceType??'pc',mode,branchId};
}
function sameBinding(a,b) { return a&&b&&['id','platform','mode','branchId'].every(key=>normalize(a[key])===normalize(b[key])); }
function assertUnchanged(existing,candidate) {
  const old=binding(existing), next=binding(candidate);
  if(old&&!sameBinding(old,next)) refuse('Changing the registered terminal requires explicit unpairing and registration.');
  return next;
}
function canonicalConfig(candidate,descriptor,existing=null) {
  const requested=assertUnchanged(existing,candidate);
  if(!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor)||
     typeof descriptor.id!=='string'||!descriptor.id.trim()||!['pc','mobile'].includes(descriptor.platform)||
     !['operations','management'].includes(descriptor.mode)||
     (descriptor.mode==='operations'?(typeof descriptor.branchId!=='string'||!descriptor.branchId.trim()):descriptor.branchId!==null))
    throw Object.assign(new Error('The POS backend must be updated to verify this terminal registration.'),{code:'EBACKEND_UPGRADE_REQUIRED',status:426});
  if(descriptor.platform!=='pc'||!sameBinding(requested,descriptor)) refuse('The activation does not match the verified computer registration.');
  // Ordinary adoption cannot replace operator-managed connection settings or
  // replica secrets. A missing legacy claim proof may be filled only here,
  // after the backend has verified that proof and returned this descriptor.
  return {...(existing??candidate),deviceBindingProof:existing?.deviceBindingProof||candidate.deviceBindingProof,tokenId:descriptor.id,deviceType:descriptor.platform,deviceUse:descriptor.mode,locationId:descriptor.branchId??'',storeId:undefined,branchId:undefined};
}
function authorizedBranch(config,accountBranch) {
  const terminal=binding(config);
  if(!terminal||terminal.mode!=='operations') refuse('A registered operations terminal is required.');
  if(accountBranch&&normalize(accountBranch)!==normalize(terminal.branchId)) refuse('The signed-in account is not authorized for this terminal branch.');
  return terminal.branchId;
}
module.exports={binding,sameBinding,assertUnchanged,canonicalConfig,authorizedBranch};
