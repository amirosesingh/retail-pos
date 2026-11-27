import type { StockSourceAction, StockSourceManifest } from './stock-source-manifest.mjs';

export type StockSourceMembership = Readonly<{
  version: 1;
  index: number;
  count: number;
  root: string;
  manifestJson: string;
  siblings: readonly string[];
}>;
export type StockSourceCohort = Readonly<{
  version: 1;
  operationId: string;
  action: StockSourceAction;
  authorId: string;
  terminalId: string;
  branchId: string;
  count: number;
  root: string;
  members: readonly StockSourceMembership[];
}>;
export type VerifiedStockSourceCohortBinding = Readonly<{ count: number; root: string }>;
/** Pure bounded representation, not authorship, acceptance or clock verification. */
export function buildStockSourceCohort(manifests: unknown): Promise<StockSourceCohort>;
/** expected must be independently bound to the verified signed count AND root. */
export function verifyStockSourceMembership(member: unknown, expected: VerifiedStockSourceCohortBinding): Promise<StockSourceManifest>;
