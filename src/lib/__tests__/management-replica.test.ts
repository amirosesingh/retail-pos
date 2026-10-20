import { beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
import { managementReplicaScope } from "../management-replica.server";
import { redactSyncDownload } from "../sync-download-redaction";
const proof = "a".repeat(64);
const token = { id: "terminal", platform: "pc", location_id: null, management_sync_enabled: true, management_sync_proof_hash: createHash("sha256").update(proof).digest("hex"), is_claimed: true, status: "used", revoked_at: null, claimed_proof_hash: proof };
beforeEach(() => { mocks.rest.mockReset(); mocks.rest.mockResolvedValue(Response.json([token])); });
it("permits read-only management replication without a signed-in staff account", async () => {
  expect(await managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: proof, deviceBindingProof: proof, managementSyncBranches: true })).toMatchObject({ managementReplica: true, isSupervisor: false, permissions: {} });
});
it.each([
 { platform: "mobile" }, { location_id: "shop" }, { management_sync_enabled: false },
 { is_claimed: false }, { revoked_at: "2026-10-20" }, { status: "revoked" }, { claimed_proof_hash: "b".repeat(64) },
])("rejects an ineligible registration: %j", async patch => {
 mocks.rest.mockResolvedValue(Response.json([{ ...token, ...patch }]));
 await expect(managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: proof, deviceBindingProof: proof, sqlServerPull: {} })).rejects.toThrow();
});
it("cannot combine the device read capability with a write", async () => {
 await expect(managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: proof, deviceBindingProof: proof, sqlServerPull: {}, sqlServerBatch: {} })).rejects.toThrow("downloads only");
 expect(mocks.rest).not.toHaveBeenCalled();
});
it("does not grant a replica scope to a token id alone", async () => {
 expect(await managementReplicaScope({ terminalToken: "terminal", managementSyncBranches: true })).toBeNull();
});
it("rejects the public hash from a pairing QR as a download secret", async () => {
 await expect(managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: token.management_sync_proof_hash, deviceBindingProof: proof, managementSyncBranches: true })).rejects.toThrow("invalid");
});
it("rejects a secret without the originally claimed device binding", async () => {
 await expect(managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: proof, deviceBindingProof: "b".repeat(64), managementSyncBranches: true })).rejects.toThrow("invalid");
});
it("does not distribute another terminal's activation proofs with replicated rows", () => {
 const rows = [{ table_name: "terminal_tokens", row_data: { id: "other", claim_proof: proof, claimed_proof_hash: proof, claim_secret_hash: proof, status: "used" } }];
 expect(redactSyncDownload(rows)).toEqual([{ table_name: "terminal_tokens", row_data: { id: "other", status: "used" } }]);
 expect(redactSyncDownload({ rows: [rows[0].row_data], cursor: "next" }, "terminal_tokens")).toEqual({ rows: [{ id: "other", status: "used" }], cursor: "next" });
});
it("classifies failed registration verification as a service outage, not revoked access", async () => {
 mocks.rest.mockResolvedValue(new Response("", { status: 503 }));
 await expect(managementReplicaScope({ terminalToken: "terminal", deviceClaimProof: proof, deviceBindingProof: proof, sqlServerPull: {} })).rejects.toMatchObject({ status: 503 });
});
const require = createRequire(import.meta.url);
const { ManagementReplica } = require("../../../electron/sync/management-replica.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
function fixture() {
 const push = vi.fn(); const pull = vi.fn().mockResolvedValue({});
 const coordinator = new SyncCoordinator({ pushWorker: { run: push }, pullWorker: { run: pull } });
 const cloud = { managementBranches: vi.fn().mockResolvedValue({ ok: true, branches: [{ id: "a" }, { id: "b" }] }) };
 const databaseService = { snapshot: () => ({ enabled: true, configured: true }), restore: vi.fn() };
 const jobs = { active: vi.fn().mockResolvedValue(null), completed: vi.fn().mockResolvedValue(null) };
 const lifecycle = { bootstrapType: () => "bootstrap_7300", bootstrap: vi.fn() };
 return { push, pull, cloud, jobs, lifecycle, replica: new ManagementReplica({ cloud, databaseService, jobs, lifecycle, coordinator, connectionManager: { isConnected: () => true } }) };
}
it("downloads every server-approved branch sequentially without uploading local rows", async () => {
 const f=fixture(); await f.replica.run();
 expect(f.lifecycle.bootstrap.mock.calls.map(c => c[0])).toEqual(["a", "b"]);
 expect(f.pull.mock.calls.map(c => c[0].branchId)).toEqual(["a", "b"]);
 expect(f.push).not.toHaveBeenCalled();
});
it("shares concurrent triggers and never advances to another branch after a failed download", async () => {
 const f=fixture(); f.pull.mockRejectedValue(new Error("connection lost"));
 const first=f.replica.run(); expect(f.replica.run()).toBe(first);
 await expect(first).rejects.toThrow("connection lost");
 expect(f.lifecycle.bootstrap).toHaveBeenCalledTimes(1);
 expect(f.push).not.toHaveBeenCalled();
});
it("does not re-bootstrap a completed branch", async () => {
 const f=fixture(); f.jobs.completed.mockResolvedValue({ status: "completed" }); await f.replica.run();
 expect(f.lifecycle.bootstrap).not.toHaveBeenCalled(); expect(f.pull).toHaveBeenCalledTimes(2);
});
it("honors pause and avoids SQL/cloud calls when local storage is disabled", async () => {
 const f=fixture(); f.replica.coordinator.pause();
 expect(await f.replica.run()).toMatchObject({ paused: true });
 expect(f.cloud.managementBranches).not.toHaveBeenCalled();
 f.replica.coordinator.resume();
 f.replica.databaseService.snapshot = () => ({ enabled: false, configured: false });
 expect(await f.replica.run()).toMatchObject({ skipped: true });
 expect(f.cloud.managementBranches).not.toHaveBeenCalled();
});
it("stops rejected identity requests until registration or explicit repair changes", async () => {
 const f=fixture(); f.cloud.managementBranches.mockRejectedValue(Object.assign(new Error("revoked"), { status: 403 }));
 await expect(f.replica.run()).rejects.toThrow("revoked");
 expect(await f.replica.run()).toMatchObject({ deferred: true });
 expect(f.cloud.managementBranches).toHaveBeenCalledOnce();
 f.replica.resetRetry(); f.cloud.managementBranches.mockResolvedValue({ ok: true, branches: [] });
 expect(await f.replica.run()).toMatchObject({ ok: true });
});
