export type StockEventAction='SALE'|'REFUND'|'RECEIVE'|'ADJUST'|'PRODUCT_CREATE'|'PRODUCT_MERGE'|'TRANSFER_DISPATCH'|'TRANSFER_RECEIVE'|'SPONSORSHIP_ISSUE'|'MISSED_BILL';
export type StockEventProof={version:1;algorithm:'Ed25519';keyId:string;projectOrigin:string;terminalId:string;authorId:string;subject:string;branchId:string;operationId:string;movementId:string;action:StockEventAction;payloadHash:string;sourceManifestJson?:string;signature:string};
export const ACTIONS:Readonly<Record<StockEventAction,{readonly kind:string;readonly permissions:readonly string[];readonly adminOnly?:boolean}>>;
export function unsignedStockEvent(input:unknown):Omit<StockEventProof,'signature'>;
export function stockEventMessage(input:unknown):string;
export function normalizeStockEvent(input:unknown):StockEventProof;
