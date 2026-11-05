// Pure FIN62 draft foundation. No reads, writes, current-total lookup or activation.
const {canonicalExactCents,roundExactMoney,exactFinancialDecimalKey}=require('../sync/shift-financial-math.cjs');
const FORMULA='canonical-exact-decimal-v2';
function invalid(){throw Object.assign(new Error('The exact shift financial draft is invalid.'),{code:'EFINANCIAL_DRAFT_INVALID'});}
// Existing endpoints normalize NEW counted input to currency before saving.
// Preserve that behaviour with exact decimal half-away rounding, never binary
// arithmetic. Stored/accepted counted fields remain strict and are never repriced.
function normalizeCountedInput(value){
 const numeric=typeof value==='number';
 if((!numeric&&typeof value!=='string')||(numeric&&!Number.isFinite(value)))invalid();
 let text;try{const raw=numeric?String(value):value;if(BigInt(exactFinancialDecimalKey(raw))<0n)invalid();text=roundExactMoney(raw);}catch{invalid();}
 const amount=BigInt(text.replace('.',''));
 // At 2^46 the double spacing exceeds one cent; adjacent decimal cent inputs
 // can collapse to one Number. Require a string from that boundary onward.
 if(amount<0n||(numeric&&amount>=7036874417766400n))invalid();
 return text;
}
function cents(value,{nonnegative=false,canonical=false}={}){
 if(typeof value!=='string')invalid();
 let text;try{text=canonicalExactCents(value);}catch{invalid();}
 if(canonical&&text!==value)invalid();
 const negative=text.startsWith('-'),digits=(negative?text.slice(1):text).replace('.','');
 const result=BigInt(digits)*(negative?-1n:1n);
 if(nonnegative&&result<0n)invalid();
 return result;
}
function money(value){const negative=value<0n,absolute=negative?-value:value;return `${negative?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;}
function buildShiftFinancialDraft(input){
 const computed=input?.computed,expected=computed?.expected,counted=input?.counted;
 if(computed?.status!=='computed'||computed.formula!==FORMULA||!expected||!counted)invalid();
 const e={cash:cents(expected.cash,{canonical:true}),card:cents(expected.card,{canonical:true}),digital:cents(expected.digital,{canonical:true})};
 const c={cash:cents(counted.cash,{nonnegative:true}),card:counted.card===null?null:cents(counted.card,{nonnegative:true}),digital:counted.digital===null?null:cents(counted.digital,{nonnegative:true})};
 let opening;try{opening=cents(roundExactMoney(input.openingFloat));}catch{invalid();}
 const v={cash:c.cash-e.cash,card:c.card===null?null:c.card-e.card,digital:c.digital===null?null:c.digital-e.digital};
 const total=v.cash+(v.card??0n)+(v.digital??0n);
 return Object.freeze({formula:FORMULA,opening_float:money(opening),net_cash_sales:money(e.cash-opening),expected_cash:money(e.cash),expected_card:money(e.card),expected_digital:money(e.digital),counted_cash:money(c.cash),counted_card:c.card===null?null:money(c.card),counted_digital:c.digital===null?null:money(c.digital),variance_cash:money(v.cash),variance_card:v.card===null?null:money(v.card),variance_digital:v.digital===null?null:money(v.digital),variance_total:money(total),variance_status:total===0n?'NO_VARIANCE':total>0n?'OVER':'SHORT'});
}
// Explicit summary inputs prevent a partial tender basis from pretending to be
// a complete sales/discount/refund aggregate. Return exact strings for storage.
function formatShiftFinancialSummary(input){
 if(!input||typeof input.branchName!=='string'||!input.branchName||typeof input.actor!=='string'||!input.actor||typeof input.transactions!=='string'||!/^(0|[1-9][0-9]{0,75})$/.test(input.transactions))invalid();
 const d=input.draft;if(d?.formula!==FORMULA)invalid();
 const expected=money(cents(d.expected_cash,{canonical:true})),counted=money(cents(d.counted_cash,{canonical:true}));
 let total,discounts,refunds;try{total=roundExactMoney(input.totalSales);discounts=roundExactMoney(input.discounts);refunds=roundExactMoney(input.refunds);}catch{invalid();}
 return Object.freeze({total_sales:total,transactions:input.transactions,discounts,refunds,expected_cash:expected,counted_cash:counted,payment_breakdown:Object.freeze({cash:money(cents(d.net_cash_sales,{canonical:true})),card:money(cents(d.expected_card,{canonical:true})),digital:money(cents(d.expected_digital,{canonical:true}))}),summary:`Shift closed — ${input.branchName}\nClosed by ${input.actor}\nTotal sales: ${total} over ${input.transactions} bill(s)\nCash expected ${expected} / counted ${counted}`});
}
module.exports={buildShiftFinancialDraft,formatShiftFinancialSummary,normalizeCountedInput};
