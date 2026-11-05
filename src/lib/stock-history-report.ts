/** Transport contract only. Rows must come from the authorized SQL adapter;
 * current product stock and activity rows are never historical substitutes. */
export type StockHistoryRequest={
 cutoff:string;
 timeZone:string;
 branchId?:string;
 after?:string|null;
 sourceRevision?:string|null;
 limit?:number;
 export?:boolean;
 /** Resolve the exact saved CLOSED instant at the authorized source. */
 closedShiftId?:string;
};
export type StockHistoryRow={
 productId:string;locationId:string;name:string;sku:string|null;barcode:string|null;
 quantity:string|null;negative:boolean|null;
};
export type StockHistoryPage={
 status:'unavailable'|'unsupported'|'incomplete'|'complete';
 reasons:string[];
 cutoff:string;
 timeZone:string;
 branchId:string;
 baselineAt?:string|null;
 readAt?:string;
 coverageThroughTicks?:string|null;
 sourceRevision?:string|null;
 pendingCount?:string;
 restatable?:true;
 rows:StockHistoryRow[];
 next:string|null;
};
export const STOCK_HISTORY_PAGE_SIZE=100;
export function stockHistoryExplanation(reason:string):string{
 switch(reason){
  case 'SCHEMA_NOT_INSTALLED':return 'This database needs the reviewed stock-history upgrade.';
  case 'PARTIAL_SCHEMA':case 'UNKNOWN_SCHEMA':return 'The stock-history database structure needs review; existing stock has not been changed.';
  case 'NO_VERIFIED_OPENING':return 'Historical quantities are unavailable until an opening balance and movement coverage have been verified.';
  case 'UNVERIFIED_OPENING':return 'The opening balance is not fully verified.';
  case 'MISSING_OPENING':return 'An item has no verified opening or creation evidence in this historical scope.';
  case 'BEFORE_BASELINE':return 'This date is earlier than the verified opening balance.';
  case 'FUTURE_CUTOFF':return 'Choose a date and time that has already occurred.';
  case 'PENDING_UPLOADS':return 'Some stock movements are waiting to synchronize. Historical coverage is incomplete.';
  case 'INCOMPLETE_MOVEMENTS':return 'Complete stock movement coverage has not been proved for this date and time.';
  case 'BASELINE_PREHISTORY_CHANGED':return 'A late movement predates the opening balance; it needs reconciliation before quantities can be shown.';
  case 'CLOCK_UNVERIFIED':return 'An original device clock is unverified; the exact historical timing needs review.';
  default:return 'The requested historical stock could not be verified.';
 }
}
