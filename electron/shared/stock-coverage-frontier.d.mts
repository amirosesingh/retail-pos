/** Representation only; does not prove authority, source acceptance or complete coverage. */
export type StockCoverageFrontier=Readonly<{
 version:1;projectOrigin:string;branchId:string;terminalId:string;authorId:string;databaseId:string;challengeId:string;nonce:string;cohortHash:string;
 writerRevision:'stock-history-source.v1';sourceSequence:string;sourceRoot:string|null;sourceGeneration:string;gapHash:string;
 pending:Readonly<{business:string;metadata:string;unsigned:string;unknown:string}>;observedAt:string;
}>;
export function normalizeStockCoverageFrontier(input:unknown):StockCoverageFrontier;
export function stockCoverageFrontierJson(input:unknown):string;
