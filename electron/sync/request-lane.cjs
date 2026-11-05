"use strict";

// Scheduling only: this is not an outbox, retry loop or acknowledgement owner.
// Existing writers keep their durable payloads until the normal server ACK.
class SyncRequestLane {
  constructor({ maxPending = 64, maxQueuedBytes = 32 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 ||
        !Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < 1) throw new Error("Invalid sync lane bounds.");
    this.maxPending = maxPending; this.maxQueuedBytes = maxQueuedBytes;
    this.queues = { upload: [], download: [] }; this.queuedBytes = 0;
    this.active = false; this.lastDirection = "download";
  }
  snapshot() { return { active: this.active, queuedUploads: this.queues.upload.length, queuedDownloads: this.queues.download.length }; }
  run(direction, bytes, work) {
    if (!["upload", "download"].includes(direction) || !Number.isSafeInteger(bytes) || bytes < 0 || typeof work !== "function")
      return Promise.reject(new Error("Invalid sync lane request."));
    if (this.queues.upload.length + this.queues.download.length >= this.maxPending ||
        (this.active || this.queues.upload.length || this.queues.download.length) && this.queuedBytes + bytes > this.maxQueuedBytes)
      return Promise.reject(Object.assign(new Error("The synchronization request lane is busy. Saved work remains pending for its next retry."), { code: "ESYNC_LANE_BUSY" }));
    return new Promise((resolve, reject) => {
      this.queues[direction].push({ bytes, work, resolve, reject }); this.queuedBytes += bytes;
      this.drain();
    });
  }
  drain() {
    if (this.active) return;
    const other = this.lastDirection === "upload" ? "download" : "upload";
    const direction = this.queues[other].length ? other : this.lastDirection;
    const next = this.queues[direction].shift();
    if (!next) return;
    this.queuedBytes -= next.bytes; this.active = true; this.lastDirection = direction;
    // Start work immediately, preserving the first caller's normal request
    // timing. Waiting requests do not spend their HTTP timeout while queued.
    let result;
    try { result = next.work(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(next.resolve, next.reject).finally(() => {
      this.active = false; this.drain();
    });
  }
}
module.exports = { SyncRequestLane };
