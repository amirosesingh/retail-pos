/** Coalesce clicks and finish durable synchronization before launching either installer. */
function createUpdateInstall({ updater, prepare, allowQuit, recover, isBusy = () => false }) {
  let running = null;
  return function install(downloadFirst) {
    if (running) return running;
    running = (async () => {
      try {
        if (downloadFirst) {
          const downloaded = await updater.downloadUpdate();
          if (downloaded.status !== "ready")
            return { ok: false, error: downloaded.error || "The update did not finish downloading. Retry the download." };
        }
        if (updater.status().status !== "ready") return { ok: false, error: "No update is ready. Check for updates first." };
        if (isBusy()) return { ok: false, code: "EPOS_BUSY", error: "Please finish the current transaction before updating." };
        const synced = await prepare(true);
        if (!synced.ok) { recover(); return synced; }
        allowQuit();
        const result = await updater.install();
        if (!result.ok) recover();
        return result;
      } catch (error) {
        recover();
        return { ok: false, error: String(error?.message ?? error) };
      }
    })().finally(() => { running = null; });
    return running;
  };
}
module.exports = { createUpdateInstall };
