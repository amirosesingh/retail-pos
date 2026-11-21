import { createHash } from "node:crypto";
import { z } from "zod";
import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const sequence = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/);
const ticks = z.string().regex(/^-?(?:0|[1-9][0-9]{0,19})$/);
const utc = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
const label = z.string().min(1).max(128);
const kind = z.enum(["openings", "movements"]);
const index = z.number().int().min(0).max(255);
const scope = { version: z.literal(1), branchId: label, terminalId: uuid };
export const stockHistoryDownloadSchema = z.discriminatedUnion("action", [
  z.object({ ...scope, action: z.literal("manifest") }).strict(),
  z.object({ ...scope, action: z.literal("page"), snapshotId: uuid, revision: hashSchema, index }).strict(),
]);

const manifestSchema = z.object({
  snapshotId: uuid,
  headCursor: sequence,
  coverageGeneration: sequence,
  coverageState: z.literal("complete"),
  coverageFrom: ticks,
  coverageThrough: ticks,
  baseline: z.tuple([uuid, utc, utc, sequence, z.enum(["system_snapshot", "physical_count"]),
    z.number().int().min(0).max(20000), label, hashSchema, z.string().max(262144)]),
  pages: z.array(z.tuple([kind, z.number().int().min(1).max(100), hashSchema])).max(256),
}).strict();
const manifestResult = z.object({ manifest: manifestSchema.nullable(),
  withdrawal: z.object({ coverageGeneration: sequence }).strict().optional() }).strict();
const pageResult = z.object({ manifest: manifestSchema, snapshotId: uuid, index, kind,
  rowsJson: z.string().min(3).max(245760) }).strict();
const sha256 = (bytes: string) => createHash("sha256").update(bytes, "utf8").digest("hex");

function identify(manifest: z.infer<typeof manifestSchema>, project: string, branch: string, terminal: string) {
  return sha256(JSON.stringify([
    manifest.snapshotId, project, branch, terminal, manifest.headCursor, manifest.coverageGeneration,
    manifest.coverageState, manifest.coverageFrom, manifest.coverageThrough, manifest.baseline, manifest.pages,
  ]));
}

export async function stockHistoryDownload(input: z.infer<typeof stockHistoryDownloadSchema>,
  terminal: VerifiedTerminalDescriptor, signal: AbortSignal) {
  if (terminal.platform !== "pc" || terminal.mode !== "operations" ||
      terminal.id !== input.terminalId || terminal.branchId !== input.branchId)
    return Response.json({ ok: false, code: "STOCK_HISTORY_REPLICA_SCOPE_DENIED" }, { status: 403 });
  const projectOrigin = new URL(supabaseConfig().url).origin;
  const binding = { ok: true, version: 1, projectOrigin, branchId: input.branchId, terminalId: terminal.id };
  try {
    const params = { p_branch: input.branchId, p_terminal: terminal.id };
    const response = input.action === "manifest"
      ? await serviceRest("rpc/pos_stock_history_replica_manifest", { method: "POST", body: JSON.stringify(params), signal })
      : await serviceRest("rpc/pos_stock_history_replica_page", { method: "POST",
        body: JSON.stringify({ ...params, p_snapshot: input.snapshotId, p_index: input.index }), signal });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > 2_000_000) throw new Error("Stock history response exceeds its limit");
    const result: unknown = JSON.parse(raw);
    if (!response.ok) {
      const error = z.object({ message: z.string() }).safeParse(result);
      if (response.status === 401 || response.status === 403)
        return Response.json({ ok: false, code: "STOCK_HISTORY_REPLICA_SCOPE_DENIED" }, { status: 403 });
      if (error.success && ["STOCK_HISTORY_REPLICA_CHANGED", "STOCK_HISTORY_REPLICA_BUSY"].includes(error.data.message))
        return Response.json({ ok: false, code: error.data.message }, { status: 409 });
      throw new Error("Stock history source unavailable");
    }
    if (input.action === "manifest") {
      const { manifest, withdrawal } = manifestResult.parse(result);
      if (!manifest) return Response.json({ ...binding, manifest, ...(withdrawal ? { withdrawal } : {}) });
      if (withdrawal) throw new Error("Stock history publication is inconsistent");
      return Response.json({ ...binding, manifest: {
        ...manifest, revision: identify(manifest, projectOrigin, input.branchId, terminal.id),
      } });
    }
    const page = pageResult.parse(result);
    const revision = identify(page.manifest, projectOrigin, input.branchId, terminal.id);
    const descriptor = page.manifest.pages[page.index];
    if (revision !== input.revision || page.snapshotId !== input.snapshotId || page.manifest.snapshotId !== page.snapshotId ||
        page.index !== input.index || descriptor?.[0] !== page.kind || descriptor[2] !== sha256(page.rowsJson) ||
        Buffer.byteLength(page.rowsJson, "utf8") > 245760)
      return Response.json({ ok: false, code: "STOCK_HISTORY_REPLICA_CHANGED" }, { status: 409 });
    return Response.json({ ...binding, snapshotId: page.snapshotId, revision, index: page.index, kind: page.kind, rowsJson: page.rowsJson });
  } catch {
    return Response.json({ ok: false, code: "STOCK_HISTORY_REPLICA_UNAVAILABLE" }, { status: 503 });
  }
}
