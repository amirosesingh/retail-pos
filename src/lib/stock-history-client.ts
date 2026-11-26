import {getPosCallerAuth} from './pos-caller-auth';
import {hostedFunction} from './hosted-function-client';
import {loadStockHistoryPageDirect,readStockRolloutReadinessDirect,recordStockRolloutOpeningDirect} from './stock-history.functions';
import {checkedStockHistoryPage,stockHistoryRequestSchema} from './stock-history-validation';
import {sessionEpoch} from './session-epoch';
import {stockHistoryDesktopReader,usesLocalStockHistory} from './stock-report-desktop-reader';
import type {StockHistoryPage,StockHistoryRequest,StockRolloutOpening,StockRolloutReadiness} from './stock-history-report';
const hosted=hostedFunction('stock-history.page',loadStockHistoryPageDirect);
const rollout=hostedFunction('stock-history.rollout-opening',recordStockRolloutOpeningDirect);
const rolloutReadiness=hostedFunction('stock-history.rollout-readiness',readStockRolloutReadinessDirect);
export async function readStockRolloutReadiness(branchId:string):Promise<StockRolloutReadiness>{
 const proof=await getPosCallerAuth();
 return rolloutReadiness({data:{...proof,branchId}});
}
export async function recordStockRolloutOpening(branchId:string):Promise<StockRolloutOpening>{
 const proof=await getPosCallerAuth();
 return rollout({data:{...proof,branchId}});
}
export async function loadStockHistoryPage(input:StockHistoryRequest):Promise<StockHistoryPage>{
 const request=stockHistoryRequestSchema.parse(input),epoch=sessionEpoch(),native=usesLocalStockHistory();
 const current=()=>{if(sessionEpoch()!==epoch||usesLocalStockHistory()!==native)throw Object.assign(new Error('The signed-in account or database changed. Open the report again.'),{code:'SESSION_CHANGED'});};
 if(native){
  const bridge=stockHistoryDesktopReader();
  if(!bridge?.stockHistory)throw new Error('This desktop version does not include the stock-history reader. Update the app before opening this report.');
  const result=await bridge.stockHistory(request);current();
  if(!result.ok)throw Object.assign(new Error(result.error||'Historical stock could not be read from local SQL Server.'),{code:result.code});
  return checkedStockHistoryPage(result.page,request.branchId);
 }
 const proof=await getPosCallerAuth();current();
 const page=await hosted({data:{...proof,request}});current();return checkedStockHistoryPage(page,request.branchId);
}
