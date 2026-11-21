import { z } from "zod";
import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";

const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
const identity = { version: z.literal(1), stocktakeId: uuid, terminalId: uuid, branchId: z.string().min(1).max(128) };
const proofs = z.array(z.object({ terminalId: uuid, databaseId: uuid, challengeId: uuid, fenceGeneration: uuid,
  localFencedAt: instant, localExpiresAt: instant }).strict()).min(1).max(16);
const counts = z.array(z.tuple([uuid, z.string().regex(/^(?:0|[1-9][0-9]{0,37})$/)])).max(10000);
export const stocktakeCutoverSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("prepare") }).strict(),
  z.object({ ...identity, action: z.literal("lease"), databaseId: uuid, purpose: z.enum(["arm", "confirm", "release"]) }).strict(),
  z.object({ ...identity, action: z.literal("arm"), proofs }).strict(),
  z.object({ ...identity, action: z.literal("seal"), rosterHash: digest, cutoff: instant, counts }).strict(),
  z.object({ ...identity, action: z.literal("review") }).strict(),
  z.object({ ...identity, action: z.literal("publish"), evidenceHash: digest, proofs }).strict(),
  z.object({ ...identity, action: z.literal("release") }).strict(),
  z.object({ ...identity, action: z.literal("release-status"), databaseId: uuid }).strict(),
]);

export async function stocktakeCutover(input: z.infer<typeof stocktakeCutoverSchema>,
  terminal: VerifiedTerminalDescriptor, subject: string, signal: AbortSignal) {
  if (!subject || terminal.platform !== "pc" || terminal.mode !== "operations" ||
      terminal.id !== input.terminalId || terminal.branchId !== input.branchId)
    return Response.json({ ok: false, code: "STOCK_CUTOVER_SCOPE_DENIED" }, { status: 403 });
  const projectOrigin = new URL(supabaseConfig().url).origin;
  const scope = { p_subject: subject, p_terminal: terminal.id, p_project: projectOrigin, p_branch: input.branchId, p_id: input.stocktakeId };
  const names = {
    prepare: "prepare_stocktake_pause",
    lease: "load_stocktake_lease",
    arm: "arm_stocktake_pause",
    seal: "seal_stocktake",
    review: "stocktake_for_review",
    publish: "publish_stocktake",
    release: "release_stocktake_pause",
    "release-status": "load_stocktake_release",
  };
  let parameters: Record<string, unknown> = scope;
  if (input.action === "lease") parameters = { ...scope, p_database: input.databaseId, p_purpose: input.purpose };
  if (input.action === "release-status") parameters = { ...scope, p_database: input.databaseId };
  if (input.action === "arm") parameters = { ...scope, p_proofs: input.proofs };
  if (input.action === "publish") parameters = { ...scope, p_evidence_hash: input.evidenceHash, p_proofs: input.proofs };
  if (input.action === "seal") parameters = {
    p_subject: subject, p_terminal: terminal.id, p_branch: input.branchId, p_id: input.stocktakeId,
    p_roster_hash: input.rosterHash, p_cutoff: input.cutoff, p_counts: input.counts, p_movements: [],
  };
  if (input.action === "review")
    parameters = { p_subject: subject, p_terminal: terminal.id, p_branch: input.branchId, p_id: input.stocktakeId };
  const requestBytes = JSON.stringify(parameters);
  if (Buffer.byteLength(requestBytes, "utf8") > 2_100_000)
    return Response.json({ ok: false, code: "STOCK_CUTOVER_TOO_LARGE" }, { status: 413 });
  try {
    const response = await serviceRest("rpc/pos_stock_history_" + names[input.action],
      { method: "POST", body: requestBytes, signal });
    const raw = await response.text();
    // An armed count returns the frozen roster. Review also includes each
    // recorded count, so both use the bounded full-stocktake response limit.
    const responseLimit = input.action === "arm" || input.action === "review" ? 8 * 1024 * 1024 : 262144;
    if (Buffer.byteLength(raw, "utf8") > responseLimit)
      throw new Error("Unexpected stocktake response size");
    const result: unknown = JSON.parse(raw);
    if (!response.ok) {
      const error = z.object({ message: z.string() }).safeParse(result);
      const code = error.success && /^STOCK(?:_CUTOVER|TAKE)_[A-Z_]{1,60}$/.test(error.data.message)
        ? error.data.message : "STOCK_CUTOVER_UNAVAILABLE";
      const status = response.status === 401 || response.status === 403 ? 403
        : code === "STOCK_CUTOVER_UNAVAILABLE" ? 503 : 409;
      return Response.json({ ok: false, code }, { status });
    }
    const verified = z.object({ branchId: z.literal(input.branchId) }).passthrough().parse(result);
    if ((input.action === "publish" ? verified.baselineId : verified.stocktakeId) !== input.stocktakeId)
      throw new Error("Stocktake response scope changed");
    return Response.json({ ok: true, version: 1, projectOrigin, branchId: input.branchId, terminalId: terminal.id, result: verified });
  } catch {
    return Response.json({ ok: false, code: "STOCK_CUTOVER_UNAVAILABLE" }, { status: 503 });
  }
}
