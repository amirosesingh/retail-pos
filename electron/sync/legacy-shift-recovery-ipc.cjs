"use strict";
const guard = require("../ipc-guard.cjs");
const CHANNELS = Object.freeze({ list: "sync:legacy-recovery-list", preview: "sync:legacy-recovery-preview", approve: "sync:legacy-recovery-approve" });

function installLegacyShiftRecoveryIpc({ ipcMain, service, session, isPosSender }) {
  const register = (channel, work) => ipcMain.handle(channel, async (event, value) => {
    if (!isPosSender(event) || session.identity()?.source !== "pos" || session.identity()?.level !== "admin")
      return { ok: false, code: "PERMISSION_DENIED", error: "Sign in as Administrator in the POS window to review saved closings." };
    session.touch();
    try { return await guard.guarded(async () => ({ ok: true, ...await work(value) })); }
    catch (error) {
      const code = typeof error?.code === "string" && /^(?:ELEGACY_RECOVERY_|ESYNC_SHIFT_AUTHOR_|SYNC_BRANCH_FORBIDDEN)/.test(error.code) ? error.code : "ELEGACY_RECOVERY_PENDING";
      return { ok: false, code, error: "Saved closing recovery could not complete. Existing records remain intact; review the connection or required upgrade." };
    }
  });
  const object = (value, keys) => {
    const input = guard.options(value, { name: "saved closing review", max: keys.length });
    if (Object.keys(input).some(key => !keys.includes(key))) throw new guard.BadArg("Unexpected saved closing review field.");
    return input;
  };
  register(CHANNELS.list, value => {
    const input = object(value, ["afterId", "limit"]);
    return service.list({ afterId: input.afterId == null ? null : guard.uuid(input.afterId, { name: "shift cursor" }), limit: input.limit ?? 25 });
  });
  register(CHANNELS.preview, value => service.preview(guard.uuid(value, { name: "shift id" })));
  register(CHANNELS.approve, value => {
    const input = object(value, ["captureKey", "recoveryId", "reason"]);
    return service.approve({ captureKey: guard.text(input.captureKey, { name: "review reference", max: 64, pattern: /^[a-f0-9]{64}$/ }),
      recoveryId: guard.uuid(input.recoveryId, { name: "recovery reference" }), reason: guard.text(input.reason, { name: "review reason", max: 400 }) });
  });
}
module.exports = { CHANNELS, installLegacyShiftRecoveryIpc };
