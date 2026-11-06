import { z } from "zod";
import { normalizeFinancialBasisAttestation,normalizeOpeningFinancialBasisAttestation } from "../../electron/security/shift-financial-protocol.cjs";
import { normalizeAttestation, normalizeClosingStart } from "../../electron/security/shift-author-protocol.cjs";

export const syncOperationSchema = z.object({
  deletePhase: z.boolean().optional(),
  table: z.string().regex(/^[a-z_][a-z0-9_]*$/).max(64),
  rows: z.array(z.record(z.string(), z.unknown())).max(2000),
  changes: z.array(z.record(z.string(), z.unknown())).max(2000),
});
const token = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const intentFields = {
  version: z.literal(1), intentId: z.string().uuid(), shiftId: z.string().uuid(),
  kind: z.enum(["ORIGINAL", "RECOUNT", "VARIANCE"]), baseToken: token,
  predecessorIntentId: z.string().uuid().nullable(), predecessorIntentHash: token,
};
export const shiftIntentSchema = z.object({ ...intentFields, payloadJson: z.string().min(2).max(6 * 1024 * 1024) }).strict();
const frozenSchema = z.object({ ...intentFields, branchId: z.string().min(1).max(128),
  operations: z.array(syncOperationSchema.strict()).min(1).max(7),
}).strict();

export const syncAggregateSchema = z.object({
  batchId: z.string().uuid(), organizationId: z.string().min(1).max(128), branchId: z.string().min(1).max(128),
  operations: z.array(syncOperationSchema).min(1).max(200).optional(), shiftIntent: shiftIntentSchema.optional(), shiftAuthor: z.unknown().optional(), shiftClosingStart: z.unknown().optional(),
  shiftFinancialBasis: z.object({basisJson:z.string().min(2).max(6*1024*1024),proof:z.unknown()}).strict().optional(),
  registerFinancialBoundary:z.literal(true).optional(),
  financialLedgerProjection:z.literal(true).optional(),
  shiftFinancialOpening:z.object({openingJson:z.string().min(2).max(6*1024*1024),proof:z.unknown()}).strict().optional(),
  stockSourceCohorts:z.array(z.object({proofJson:z.string().min(2).max(8192)}).strict()).min(1).max(8).optional(),
}).transform((aggregate, ctx) => {
  const invalid = () => { ctx.addIssue({ code: "custom", message: "Invalid frozen shift intent" }); return z.NEVER; };
  if(aggregate.shiftFinancialOpening&&aggregate.financialLedgerProjection)return invalid();
  if(aggregate.stockSourceCohorts&&(aggregate.shiftIntent||aggregate.shiftFinancialOpening||aggregate.financialLedgerProjection||aggregate.registerFinancialBoundary))return invalid();
  if (!aggregate.shiftIntent) return aggregate.operations && aggregate.shiftAuthor === undefined && aggregate.shiftClosingStart === undefined && aggregate.shiftFinancialBasis === undefined && aggregate.registerFinancialBoundary===undefined ? { ...aggregate, operations: aggregate.operations } : invalid();
  if (aggregate.operations !== undefined || aggregate.shiftAuthor === undefined) return invalid();
  if(aggregate.shiftFinancialOpening||aggregate.financialLedgerProjection)return invalid();
  const intent = aggregate.shiftIntent;
  if (new TextEncoder().encode(intent.payloadJson).byteLength > 6 * 1024 * 1024 ||
      aggregate.batchId !== intent.intentId || intent.predecessorIntentId === intent.intentId ||
      (intent.predecessorIntentId === null) !== (intent.predecessorIntentHash === null) ||
      (intent.baseToken !== null && intent.predecessorIntentId !== null)) return invalid();
  try {
    const shiftAuthor = normalizeAttestation(aggregate.shiftAuthor);
    const shiftClosingStart = aggregate.shiftClosingStart === undefined ? undefined : normalizeClosingStart(aggregate.shiftClosingStart);
    const rawFinancialProof=aggregate.shiftFinancialBasis?.proof;
    const openingFinancialProof=rawFinancialProof!==null&&typeof rawFinancialProof==='object'&&Object.hasOwn(rawFinancialProof,'openingOrigin');
    const shiftFinancialBasis=aggregate.shiftFinancialBasis===undefined?undefined:{...aggregate.shiftFinancialBasis,proof:openingFinancialProof?normalizeOpeningFinancialBasisAttestation(rawFinancialProof):normalizeFinancialBasisAttestation(rawFinancialProof)};
    if(shiftFinancialBasis && (intent.kind==="VARIANCE" || new TextEncoder().encode(shiftFinancialBasis.basisJson).byteLength>6*1024*1024))return invalid();
    if(aggregate.registerFinancialBoundary && !shiftFinancialBasis)return invalid();
    if (shiftClosingStart && intent.kind !== "ORIGINAL") return invalid();
    const parsed = frozenSchema.parse(JSON.parse(intent.payloadJson));
    const { operations, branchId, ...fields } = parsed;
    const { payloadJson: _raw, ...headers } = intent;
    if (branchId !== aggregate.branchId || Object.entries(fields).some(([name, value]) => headers[name as keyof typeof headers] !== value)) return invalid();
    const allowed = new Set(["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts", "activity_events"]);
    const required = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
    if (operations.some(op => !allowed.has(op.table) || op.deletePhase || op.changes.some(change => ["D", "DELETE"].includes(String(change.operation).toUpperCase()))) ||
        required.some(table => !operations.some(op => op.table === table)) ||
        new Set(operations.map(op => op.table)).size !== operations.length) return invalid();
    return { ...aggregate, shiftAuthor, ...(shiftClosingStart ? { shiftClosingStart } : {}), ...(shiftFinancialBasis ? {shiftFinancialBasis}:{}), operations };
  } catch { return invalid(); }
});
