export type ShiftFinancialBasisAttestation={
 version:1;algorithm:'Ed25519';keyId:string;projectOrigin:string;terminalId:string;
 authorId:string;subject:string;branchId:string;shiftId:string;intentId:string;
 action:'ORIGINAL'|'RECOUNT';graphPayloadHash:string;basisHash:string;serverBasisId:string;
 formula:'canonical-exact-decimal-v2';signature:string;
};
export function normalizeFinancialBasisAttestation(input:unknown):ShiftFinancialBasisAttestation;
export function financialBasisMessage(input:unknown):string;export type ShiftFinancialOpeningOrigin=Readonly<{localAggregateId:string;rowHash:string}>;
export type OpeningShiftFinancialBasisAttestation=Omit<ShiftFinancialBasisAttestation,'serverBasisId'> & {
 openingOrigin:ShiftFinancialOpeningOrigin;
};
export type AnyShiftFinancialBasisAttestation=ShiftFinancialBasisAttestation|OpeningShiftFinancialBasisAttestation;
export function normalizeOpeningFinancialBasisAttestation(input:unknown):OpeningShiftFinancialBasisAttestation;
export function openingFinancialBasisMessage(input:unknown):string;