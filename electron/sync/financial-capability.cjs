// Exact device-scoped authority descriptor. No permission grant or user claim.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=()=>{throw Object.assign(new Error('Financial synchronization capability must be verified before this action. Saved work remains intact.'),{code:'EFINANCIAL_CAPABILITY_UNVERIFIED',table:'shifts'});};
function normalizeFinancialCapability(value,expected){
 const keys=['version','mode','financialProtocol','localSchema','organizationId','branchId','terminalId','projectOrigin','rolloutId','revision','shiftId','shiftMode'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.version!==1||value.financialProtocol!==2||value.localSchema!==26||!['disabled','required','blocked'].includes(value.mode))fail();
 for(const key of['organizationId','branchId','terminalId','projectOrigin'])if(typeof value[key]!=='string'||value[key]!==expected[key])fail();
 const shiftId=expected.shiftId??null;if(value.shiftId!==shiftId||(shiftId!==null&&!UUID.test(shiftId)))fail();
 if(shiftId===null?value.shiftMode!==null:!['legacy','required','unknown'].includes(value.shiftMode))fail();
 if(typeof value.revision!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value.revision)||BigInt(value.revision)>9223372036854775807n)fail();
 if(value.mode==='disabled'?(value.rolloutId!==null||value.revision!=='0'):(!UUID.test(value.rolloutId??'')||value.revision==='0'))fail();
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,value[key]])));
}
module.exports={normalizeFinancialCapability};
