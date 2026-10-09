// Keep the earliest wake-up. A stream of writes must not debounce sync forever.
function createSyncScheduler(run, { now = Date.now, set = setTimeout, clear = clearTimeout } = {}) {
  let timer = null;
  let due = Infinity;
  return {
    schedule(delay) {
      const wait = Math.max(250, Number(delay) || 250);
      const next = now() + wait;
      if (timer !== null && due <= next) return;
      if (timer !== null) clear(timer);
      due = next;
      timer = set(() => { timer = null; due = Infinity; void run(); }, wait);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clear(timer);
      timer = null;
      due = Infinity;
    },
  };
}
module.exports = { createSyncScheduler };
