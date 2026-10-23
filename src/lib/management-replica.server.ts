import { createHash, timingSafeEqual } from "node:crypto";
import { serviceRest } from "@/core/api/pos-relay.server";
import type { RelayScope } from "@/core/api/relay-policy.server";

/** A device proof can download a replica, never impersonate a staff member. */
export async function managementReplicaScope(body: {
  terminalToken?: string; deviceClaimProof?: string; managementSyncBranches?: boolean;
  deviceBindingProof?: string;
  sqlServerPull?: unknown; sqlServerBootstrap?: unknown; sqlServerCounts?: unknown;
  ops?: unknown[]; sqlServerBatch?: unknown; sqlServerAggregate?: unknown;
  read?: unknown; oldReceipt?: unknown; sqlServerTelemetry?: unknown;
}): Promise<RelayScope | null> {
  const reads = body.managementSyncBranches || body.sqlServerPull || body.sqlServerBootstrap || body.sqlServerCounts;
  if (!body.deviceClaimProof || !reads) return null;
  if (body.ops?.length || body.sqlServerBatch || body.sqlServerAggregate || body.read || body.oldReceipt || body.sqlServerTelemetry)
    throw new Error("Management replication accepts downloads only");
  if (!body.terminalToken || !/^[a-f0-9]{64}$/.test(body.deviceClaimProof) || !/^[a-f0-9]{64}$/.test(body.deviceBindingProof ?? "")) throw new Error("Device proof required");
  const response = await serviceRest(`terminal_tokens?id=eq.${encodeURIComponent(body.terminalToken)}&select=id,platform,location_id,status,revoked_at,is_claimed,claimed_proof_hash,claim_proof,management_sync_enabled,management_sync_proof_hash`)
    .catch(() => { throw Object.assign(new Error("Could not verify management registration"), { status: 503 }); });
  if (!response.ok) throw Object.assign(new Error("Could not verify management registration"), { status: 503 });
  const [row] = await response.json();
  const proof = String(row?.claimed_proof_hash || row?.claim_proof || "").toLowerCase();
  const secretHash = createHash("sha256").update(body.deviceClaimProof).digest("hex");
  const storedHash = String(row?.management_sync_proof_hash ?? "");
  if (!row || row.platform !== "pc" || row.location_id !== null || !row.management_sync_enabled || !row.is_claimed || row.revoked_at || !["active", "used"].includes(row.status) || !/^[a-f0-9]{64}$/.test(proof) || !/^[a-f0-9]{64}$/.test(storedHash) || !timingSafeEqual(Buffer.from(proof), Buffer.from(body.deviceBindingProof!)) || !timingSafeEqual(Buffer.from(storedHash), Buffer.from(secretHash)))
    throw new Error("Management registration is inactive or its device proof is invalid");
  return { kind: "terminal", label: row.id, terminalId: row.id, storeId: null,
    role: null, roleSlug: null, permissions: {}, isSupervisor: false, branchRestricted: true, managementReplica: true };
}
