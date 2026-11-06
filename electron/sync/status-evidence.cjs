// In-process presentation evidence only: never serialize this or use it to
// authorize a write, acknowledge an upload, or advance a sync checkpoint.
const evidence = new WeakMap();
function remember(value, branchId, outcome) {
  if (value && (typeof value === "object" || typeof value === "function"))
    evidence.set(value, { branchId: String(branchId ?? ""), outcome });
  return value;
}
const posFeedFailed = (error, branchId) => remember(error, branchId, "failed");
const posFeedCompleted = (result, branchId) => remember(result, branchId, "complete");
function posFeedEvidence(value, branchId) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const proof = evidence.get(value);
  return proof?.branchId === String(branchId ?? "") ? proof.outcome : null;
}
module.exports = { posFeedFailed, posFeedCompleted, posFeedEvidence };
