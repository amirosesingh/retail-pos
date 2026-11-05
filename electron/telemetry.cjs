function releaseResponseBody(response, signal) {
  const cleanup = response.body?.cancel();
  if (!cleanup) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    // Some stream cancellation promises outlive the fetch abort. Observe their
    // eventual rejection, but release this beat once its transport is aborted.
    Promise.resolve(cleanup).then(finish, finish);
    if (signal.aborted) finish();
  });
}

function createTelemetry({ databaseService, syncCoordinator, jobRepository, configStore, terminalStore, app }) {
  let timer = null;
  let presence = { sessionStatus: "idle", staffName: null, staffRole: null };
  let presenceRevision = 0;
  let generation = 0;
  let stopped = false;
  let active = null;
  let restartPending = false;

  function setPresence(next = {}) {
    const updated = {
      sessionStatus: next.sessionStatus === "signed_in" ? "signed_in" : "idle",
      staffName: next.staffName || null,
      staffRole: next.staffRole || null,
    };
    if (Object.keys(updated).some(key => updated[key] !== presence[key])) presenceRevision++;
    presence = updated;
    void beat();
    return { ok: true };
  }

  function current(run) {
    return !stopped && run.generation === generation && !run.controller.signal.aborted;
  }

  function beat() {
    if (stopped) return Promise.resolve();
    if (active) {
      if (active.generation !== generation) restartPending = true;
      return active.promise;
    }
    const run = { generation, controller: new AbortController(), sentPresenceRevision: null, promise: null };
    active = run;
    run.promise = Promise.resolve().then(() => send(run)).catch(() => {
      /* telemetry never interrupts trading */
    }).finally(() => {
      if (active !== run) return;
      active = null;
      // Timer ticks are absorbed by the active run. Only a real presence change
      // after dispatch (or a restart) needs another immediate observation.
      const followUp = !stopped && (restartPending ||
        (run.generation === generation && run.sentPresenceRevision !== null &&
          run.sentPresenceRevision !== presenceRevision));
      restartPending = false;
      if (followUp) void beat();
    });
    return run.promise;
  }

  async function send(run) {
    let deadline;
    try {
      if (!current(run)) return;
      const base = String(configStore.get("backendUrl") ?? "").replace(/\/+$/, "");
      const terminal = terminalStore.read() ?? {};
      const token = terminal.tokenId;
      const store = terminal.locationId ?? terminal.storeId ?? terminal.branchId;
      if (!base || !token || !store) return;

      const db = databaseService.snapshot();
      const sync = syncCoordinator.snapshot();
      const pool = databaseService.manager.pool;
      const job = pool ? await jobRepository.active() : null;
      if (!current(run)) return;
      let schemaVersion = null;
      let pending = 0;
      let conflicts = 0;
      let failed = Number(sync.failed ?? 0);
      if (pool) {
        const result = await pool.request().query(
          "SELECT COALESCE(MAX(version),0) schema_version FROM dbo.schema_migrations; " +
          "SELECT COUNT_BIG(*) pending FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL; " +
          "SELECT COUNT_BIG(*) conflicts FROM dbo.sync_conflicts WHERE status='unresolved'; " +
          "SELECT COUNT_BIG(*) failed FROM dbo.pos_jobs WHERE status='failed';",
        );
        if (!current(run)) return;
        schemaVersion = Number(result.recordsets?.[0]?.[0]?.schema_version ?? 0);
        pending = Number(result.recordsets?.[1]?.[0]?.pending ?? 0);
        conflicts = Number(result.recordsets?.[2]?.[0]?.conflicts ?? 0);
        failed = Number(result.recordsets?.[3]?.[0]?.failed ?? failed);
      }
      const lastSynced = [sync.lastPushAt, sync.lastPullAt].filter(Boolean).sort().at(-1) ?? null;
      run.sentPresenceRevision = presenceRevision;
      deadline = setTimeout(() => run.controller.abort(), 30_000);
      deadline.unref?.();
      const response = await fetch(`${base}/api/v1/pos/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: run.controller.signal,
        body: JSON.stringify({
          terminalToken: token,
          sqlServerTelemetry: {
            // The registration token id is the canonical terminal identity used
            // by terminal_tokens and the current-terminal merge in the UI.
            terminal_id: String(token),
            store_id: String(store),
            terminal_name: terminal.terminalName ?? terminal.deviceName ?? null,
            branch_code: terminal.storeCode ?? terminal.locationCode ?? null,
            session_status: presence.sessionStatus,
            staff_name: presence.staffName,
            staff_role: presence.staffRole,
            db_mode: db.enabled ? "local" : "online",
            connection_status: db.connected ? "local" : "offline",
            storage_engine: "sqlserver",
            pending_count: pending,
            conflict_count: conflicts,
            failed_count: failed,
            last_synced_at: lastSynced,
            last_push_at: sync.lastPushAt ?? null,
            last_pull_at: sync.lastPullAt ?? null,
            app_version: app.getVersion(),
            platform: "win32",
            sql_server_state: db.state,
            database_name: db.profile?.database ?? null,
            schema_version: schemaVersion,
            sync_phase: sync.phase ?? null,
            current_table: job?.current_table ?? null,
            last_seen_at: new Date().toISOString(),
          },
        }),
      });
      // This best-effort observation has no response fields to adopt. Release
      // the body/socket even for HTTP errors instead of waiting for GC.
      await releaseResponseBody(response, run.controller.signal);
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    start() { if (timer === null) { stopped = false; void beat(); timer = setInterval(beat, 60_000); timer.unref?.(); } },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      stopped = true;
      generation++;
      restartPending = false;
      active?.controller.abort();
    },
    beat,
    setPresence,
  };
}
module.exports={createTelemetry};
