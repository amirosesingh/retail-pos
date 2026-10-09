/** Retry only durable, idempotent sync work; never manufacture cloud ACKs. */
async function finishShutdownSync({ run, progress = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    progress({ active: true, attempt, message: `Synchronizing pending data before closing (${attempt}/3)…` });
    let result;
    try { result = await run(); }
    catch (error) { result = { ok: false, code: error?.code, error: String(error?.message ?? error) }; }
    if (result?.ok) return result;
    if (result?.timedOut || ['ELOCALDB','ECHANGEGAP','ESYNC_AUTH_PENDING','EPRIVILEGE','HTTP_401','HTTP_403'].includes(result?.code) || result?.credentialsInvalid || attempt === 3)
      return result ?? { ok: false, error: 'Synchronization did not return an acknowledgement.' };
    progress({ active: true, attempt, message: 'Synchronization was interrupted. Retrying automatically…' });
    await sleep(attempt * 1000);
  }
}
module.exports = { finishShutdownSync };
