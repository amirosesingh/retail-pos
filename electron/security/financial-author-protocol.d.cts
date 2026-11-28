export type FinancialOperationAttestation={
 version:1;algorithm:'Ed25519';keyId:string;projectOrigin:string;terminalId:string;
 authorId:string;subject:string;branchId:string;operationId:string;
 action:'OPEN'|'SALE'|'REFUND'|'TENDER'|'VOID';payloadHash:string;signature:string;
};
export function normalizeFinancialAttestation(input:unknown):FinancialOperationAttestation;
export function financialOperationMessage(input:unknown):string;
export type CashCheckoutAttestation=Omit<FinancialOperationAttestation,'action'>&{
 installationGeneration:string;databaseGuid:string;feedEpoch:string;
};
export function cashCheckoutMessage(input:unknown):string;
export function normalizeCashCheckoutAttestation(input:unknown):CashCheckoutAttestation;
