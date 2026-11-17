const { recordId } = require("./sync/uuid-fields.cjs");
const PERMISSIONS = { approve: "can_approve_transfer", dispatch: "can_create_transfer", receive: "can_receive_transfer", verify: "can_receive_transfer" };
const refuse = (message, code = "TRANSFER_UPLOAD_PENDING") => { throw Object.assign(new Error(message), { code }); };
/** Existing final-upload receipt barrier, not a second transfer writer/queue. */
function createTransferCentralHandoff({ captureScope, readTransfer, uploadPending }) {
  return async value => {
    if (!value || typeof value !== "object" || Object.keys(value).some(key => !["transferId", "stage"].includes(key)) || !Object.hasOwn(PERMISSIONS, value.stage) || typeof value.transferId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.transferId)) refuse("The transfer handoff is invalid.", "TRANSFER_REQUEST_INVALID");
    const id = recordId(value.transferId), scope = captureScope(PERMISSIONS[value.stage]); scope.assertCurrent();
    const before = await readTransfer(id); scope.assertCurrent();
    const owns = row => row && recordId(row.id) === id && Number.isSafeInteger(Number(row.row_version)) && Number(row.row_version) > 0 && recordId(value.stage === "receive" || value.stage === "verify" ? row.to_store_id : row.from_store_id) === scope.branchId;
    if (!owns(before)) refuse("Refresh this branch's transfer before continuing.", "STORE_FORBIDDEN");
    const result = await uploadPending(scope.branchId); scope.assertCurrent();
    if (result?.ok !== true || result.pending !== 0 || result.failed !== 0 || result.paused || result.busy || result.skipped) refuse("The transfer and its dependencies are still awaiting central acknowledgement. Keep the saved draft and synchronize before continuing.");
    const after = await readTransfer(id); scope.assertCurrent();
    if (!owns(after) || Number(after.row_version) !== Number(before.row_version)) refuse("The saved transfer changed during synchronization. Refresh it before continuing.");
    return { ok: true, transferId: id, stage: value.stage };
  };
}
module.exports = { createTransferCentralHandoff, PERMISSIONS };
