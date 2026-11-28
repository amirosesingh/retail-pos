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
 /** Optional opening business-day boundary for a movement period with an inclusive cutoff. */
 periodStart?:string;
};
export type StockHistoryRow={
 productId:string;locationId:string;name:string;sku:string|null;barcode:string|null;
 quantity:string|null;negative:boolean|null;
 openingQuantity?:string|null;inQuantity?:string|null;outQuantity?:string|null;
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
 /** Last supported central-ledger admission cutoff, when recorded stock is available. */
 recordedThrough?:string;
 sourceRevision?:string|null;
 pendingCount?:string;
 restatable?:true;
 /** Accepted ledger and all-writer knowledge are separate. No clock proof. */
 coverage?:{acceptedLedger:'complete'|'incomplete';writers:'confirmed'|'pending'|'unknown';
  balanceGrade:'verified'|'recorded_provisional';timeGrade:'accepted'|'recorded'|'author_entered'|'mixed'};
 /** The exclusive end bounds the final business day; fullDay indicates that its last tick was requested. */
 period?:{start:string;endExclusive:string;through:string;fullDay:boolean};
 rows:StockHistoryRow[];
 next:string|null;
};
export const STOCK_HISTORY_PAGE_SIZE=100;
export type StockRolloutOpening =
 | {status:'already_verified';branchId:string;cutoff:string}
 | {status:'recorded';branchId:string;cutoff:string;productCount:number}
 | {status:'waiting';branchId:string;reasons:string[]};
export type StockRolloutReadiness={
 branchId:string;writers:number;confirmed:number;reasons:string[];
 registrationInventory?:{desktop:number;mobile:number;unknown:number;hasUnassignedLocalCandidate:boolean};
};

export function stockHistoryExplanation(reason:string):string{
 switch(reason){
  case 'SCHEMA_NOT_INSTALLED':return 'This database needs the reviewed stock-history upgrade.';
  case 'MULTI_DAY_SCHEMA_NOT_INSTALLED':return 'This database needs the reviewed multi-day stock-history upgrade to verify this date range.';
  case 'PARTIAL_SCHEMA':case 'UNKNOWN_SCHEMA':return 'The stock-history database structure needs review; existing stock has not been changed.';
  case 'NO_VERIFIED_OPENING':return 'This location needs a verified opening stocktake. Historical quantities can be shown from that opening when movement coverage is verified.';
  case 'UNVERIFIED_OPENING':return 'The opening balance is not fully verified.';
  case 'MISSING_OPENING':return 'An item has no verified opening or creation evidence in this historical scope.';
  case 'BEFORE_BASELINE':return 'This date is earlier than the verified opening balance.';
  case 'FUTURE_CUTOFF':return 'Choose a date and time that has already occurred.';
  case 'PENDING_UPLOADS':return 'Some stock movements are waiting to synchronize. Historical coverage is incomplete.';
  case 'INCOMPLETE_MOVEMENTS':return 'Complete stock movement coverage has not been proved for this date and time.';
  case 'BASELINE_PREHISTORY_CHANGED':return 'A late movement predates the opening balance; it needs reconciliation before quantities can be shown.';
  case 'CLOCK_UNVERIFIED':return 'An original device clock is unverified; the exact historical timing needs review.';
  case 'WRITER_COVERAGE_PENDING':case 'WRITER_COVERAGE_UNKNOWN':return 'Some terminals have not confirmed uploads; this recorded balance may change.';
  case 'UNVALIDATED_STOCK_EFFECTS':return 'Accepted stock changes are waiting for their original movement and coverage checks.';
  case 'CAPTURE_GAPS':return 'Some stock changes have incomplete history evidence and need review.';
  case 'OPENING_SCOPE_OVERSIZED':return 'This location exceeds the supported size for a single opening snapshot.';
  case 'STOCK_VALUE_UNVERIFIED':return 'Some opening quantities or product identities could not be validated.';
  case 'CAPTURE_CONTRACT_UNVERIFIED':return 'The stock history capture schema could not be verified.';
  case 'UNSCOPED_STOCK_PAIRS':return 'Some stocked products could not be matched to this location’s catalogue.';
  case 'ROLLOUT_SCOPE_UNCONFIRMED':return 'This location has no approved writer scope for ledger activation.';
  case 'ROLLOUT_WRITER_ROSTER_UNCONFIRMED':return 'The registered stock writers need to be reconciled with this location’s approved scope.';
  case 'ROLLOUT_WRITERS_PENDING':return 'Some tills still need to confirm their latest stock uploads.';
  case 'MANAGEMENT_LOCAL_HISTORY_UNAVAILABLE':return 'Historical stock on a management terminal uses its authorized online report.';
  default:return 'The requested historical stock could not be verified.';
 }
}
