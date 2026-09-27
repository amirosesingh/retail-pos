function createTelemetry({ databaseService, syncCoordinator, jobRepository, configStore, terminalStore, app }) {
  let timer = null;
  let presence = { sessionStatus: "idle", staffName: null, staffRole: null };

  function setPresence(next = {}) {
    presence = {
      sessionStatus: next.sessionStatus === "signed_in" ? "signed_in" : "idle",
      staffName: next.staffName || null,
      staffRole: next.staffRole || null,
    };
    void beat();
    return { ok: true };
  }

  async function beat() {
    try {
      const base = String(configStore.get("backendUrl") ?? "").replace(/\/+$/, "");
      const terminal = terminalStore.read() ?? {};
      const token = terminal.tokenId;
      const store = terminal.locationId ?? terminal.storeId ?? terminal.branchId;
      if (!base || !token || !store) return;

      const db = databaseService.snapshot();
      const sync = syncCoordinator.snapshot();
      const pool = databaseService.manager.pool;
      const job = pool ? await jobRepository.active() : null;
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
        schemaVersion = Number(result.recordsets?.[0]?.[0]?.schema_version ?? 0);
        pending = Number(result.recordsets?.[1]?.[0]?.pending ?? 0);
        conflicts = Number(result.recordsets?.[2]?.[0]?.conflicts ?? 0);
        failed = Number(result.recordsets?.[3]?.[0]?.failed ?? failed);
      }
      const lastSynced = [sync.lastPushAt, sync.lastPullAt].filter(Boolean).sort().at(-1) ?? null;
      await fetch(`${base}/api/v1/pos/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    } catch {
      /* telemetry never interrupts trading */
    }
  }

  return {
    start() { if (!timer) { void beat(); timer = setInterval(beat, 60_000); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
    beat,
    setPresence,
  };
}
module.exports={createTelemetry};
