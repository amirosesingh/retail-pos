// Optional transaction-local adapter. Disabled callers retain their complete
// legacy callback unchanged; this module does not read, sign, freeze or persist.
const {buildShiftFinancialDraft,formatShiftFinancialSummary}=require('./shift-financial-draft.cjs');
function invalid(){throw Object.assign(new Error('The exact closing draft cannot be prepared.'),{code:'EFINANCIAL_DRAFT_INVALID'});}
class ShiftFinancialDraftAdapter{
 constructor({enabled=false}={}){this.enabled=enabled===true;}
 prepare(input){
  if(!this.enabled)return null;
  const capture=input?.capture;
  if(capture?.financialRequired!==true||!['ready','pending'].includes(capture.status)||!capture.expected)invalid();
  const draft=buildShiftFinancialDraft({computed:{status:'computed',formula:'canonical-exact-decimal-v2',expected:capture.expected},counted:input.counted,openingFloat:input.openingFloat});
  const result={draft};
  if(input.summary!==undefined){
   if(!input.summary||Object.hasOwn(input.summary,'draft'))invalid();
   result.summary=formatShiftFinancialSummary({...input.summary,draft});
  }
  return Object.freeze(result);
 }
 // The legacy callback is not even evaluated on the exact path. Conversely a
 // disabled adapter must not query a financial capture or change replay facts.
 async run({legacy,exact}={}){
  const work=this.enabled?exact:legacy;
  if(typeof work!=='function')invalid();
  return work(this);
 }
}
module.exports={ShiftFinancialDraftAdapter};

// Trusted Main wiring seam, not a capability switch. The caller must explicitly
// opt in after backend capability and persistence readiness have been verified.
function createShiftFinancialDraftProvider(store,{enabled=false}={}){
 if(enabled!==true)return null;
 if(!store||store.enabled!==true||typeof store.readDraft!=='function')invalid();
 const adapter=new ShiftFinancialDraftAdapter({enabled:true});
 return Object.freeze({async readDraft({branchId,shiftId,kind,counted,branchName,actor}){
  if(!['ORIGINAL','RECOUNT'].includes(kind))invalid();
  const source=await store.readDraft({branchId,shiftId});
  if(!source||typeof source.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceHash))invalid();
  const prepared=adapter.prepare({capture:{financialRequired:true,status:'pending',expected:source.computed?.expected},counted,openingFloat:source.openingFloat,...(kind==='ORIGINAL'?{summary:{...source.summary,branchName,actor}}:{})});
  if(source.computed?.status!=='computed'||source.computed.formula!=='canonical-exact-decimal-v2')invalid();
  return Object.freeze({...prepared,sourceHash:source.sourceHash,totals:Object.freeze({expected_cash:prepared.draft.expected_cash,expected_card:prepared.draft.expected_card,expected_digital:prepared.draft.expected_digital})});
 }});
}
module.exports.createShiftFinancialDraftProvider=createShiftFinancialDraftProvider;
