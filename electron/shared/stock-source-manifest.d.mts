export type StockSourceAction = 'RECEIVE' | 'ADJUST' | 'PRODUCT_CREATE' | 'PRODUCT_MERGE' |
  'TRANSFER_DISPATCH' | 'TRANSFER_RECEIVE' | 'SPONSORSHIP_ISSUE' | 'MISSED_BILL';
export type StockSourceDocumentType = 'receivings' | 'stock_adjustments' | 'products' |
  'product_merge' | 'stock_transfers' | 'sponsorships' | 'missed_bill';
export type StockSourceReference = readonly [
  type: 'item_activity_logs' | 'stock_adjustments' | 'stock_delta_applied',
  id: string,
  delta: string,
];
/** A canonical original source claim, not authorization, acceptance or clock proof. */
export type StockSourceManifest = Readonly<{
  version: 1;
  operationId: string;
  action: StockSourceAction;
  document: Readonly<{ type: StockSourceDocumentType; id: string }>;
  authorId: string;
  terminalId: string;
  branchId: string;
  productId: string;
  delta: string;
  effectiveAt: string;
  recordedAt: string;
  sourceRefs: readonly StockSourceReference[];
}>;
export const STOCK_SOURCE_ACTIONS: Readonly<Record<StockSourceAction, StockSourceDocumentType>>;
export function normalizeStockSourceManifest(input: unknown): StockSourceManifest;
export function stockSourceManifestJson(input: unknown): string;
