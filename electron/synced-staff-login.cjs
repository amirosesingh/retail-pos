const bcrypt = require("bcryptjs");
const MAX_PIN_ATTEMPTS = 5;
const PIN_WINDOW_MINUTES = 5;
const PIN_LOCK_MINUTES = 15;

function permissions(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function listSyncedStaff(pool, branchId) {
  if (!pool || !branchId) return { ok: false, reason: "unavailable", rows: [] };
  const result = await pool.request()
    .input("branch", String(branchId))
    .query(`SELECT TOP (500)
      CONVERT(nvarchar(128),id) id,user_id username,full_name,store_id,
      role,role_slug,permissions,is_active
      FROM dbo.app_users
      WHERE is_active=1 AND (store_id IS NULL OR store_id=@branch)
      ORDER BY full_name,user_id;`);
  return {
    ok: true,
    rows: (result.recordset ?? []).map((row) => ({
      id: String(row.id ?? row.username),
      username: String(row.username ?? ""),
      full_name: String(row.full_name ?? row.username ?? ""),
      store_id: row.store_id == null ? null : String(row.store_id),
      role_slug: String(row.role_slug ?? row.role ?? "staff").toLowerCase(),
      permissions: permissions(row.permissions),
      is_active: true,
    })),
  };
}

/** Verify the same bcrypt PIN hash Supabase synchronized into local SQL Server. */
async function verifySyncedStaffPin(pool, username, pin, branchId) {
  if (!pool || !branchId) return { ok: false, reason: "unavailable" };
  const name = String(username ?? "").trim().toLowerCase();
  const secret = String(pin ?? "");
  if (!name || secret.length < 4 || secret.length > 32) return { ok: false, reason: "invalid" };
  const throttleKey = `electron:${String(branchId).toLowerCase()}:${name}`;
  const throttle = await pool.request().input("key", throttleKey).query(
    "SELECT TOP (1) attempts,window_started_at,locked_until FROM dbo.pin_attempts WHERE [key]=@key;",
  );
  const lockUntil = throttle.recordset?.[0]?.locked_until;
  if (lockUntil && new Date(lockUntil).getTime() > Date.now()) {
    return { ok: false, reason: "locked", lockedUntil: new Date(lockUntil).toISOString() };
  }
  const result = await pool.request()
    .input("username", name)
    .input("branch", String(branchId))
    .query(`SELECT TOP (1)
      CONVERT(nvarchar(128),id) id,user_id username,full_name,store_id,
      role,role_slug,permissions,is_active,pin_hash
      FROM dbo.app_users
      WHERE LOWER(user_id)=@username AND (store_id IS NULL OR store_id=@branch);`);
  const row = result.recordset?.[0];
  if (!row) return { ok: false, reason: "missing" };
  if (!row.is_active) return { ok: false, reason: "inactive", error: "Account deactivated" };
  const hash = String(row.pin_hash ?? "");
  if (!hash || !await bcrypt.compare(secret, hash)) {
    const failed = await pool.request().input("key", throttleKey)
      .input("maxAttempts", MAX_PIN_ATTEMPTS)
      .input("windowMinutes", PIN_WINDOW_MINUTES)
      .input("lockMinutes", PIN_LOCK_MINUTES)
      .query(`WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        MERGE dbo.pin_attempts WITH (HOLDLOCK) AS target
        USING (SELECT @key AS [key]) AS source ON target.[key]=source.[key]
        WHEN MATCHED THEN UPDATE SET
          attempts=CASE WHEN target.window_started_at<DATEADD(minute,-@windowMinutes,SYSDATETIMEOFFSET()) THEN 1 ELSE target.attempts+1 END,
          window_started_at=CASE WHEN target.window_started_at<DATEADD(minute,-@windowMinutes,SYSDATETIMEOFFSET()) THEN SYSDATETIMEOFFSET() ELSE target.window_started_at END,
          locked_until=CASE WHEN (CASE WHEN target.window_started_at<DATEADD(minute,-@windowMinutes,SYSDATETIMEOFFSET()) THEN 1 ELSE target.attempts+1 END)>=@maxAttempts THEN DATEADD(minute,@lockMinutes,SYSDATETIMEOFFSET()) ELSE NULL END,
          updated_at=SYSDATETIMEOFFSET()
        WHEN NOT MATCHED THEN INSERT([key],attempts,window_started_at,locked_until,created_at,updated_at)
          VALUES(@key,1,SYSDATETIMEOFFSET(),NULL,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET())
        OUTPUT inserted.attempts,inserted.locked_until;`);
    const failedRow = failed.recordset?.[0];
    return failedRow?.locked_until
      ? { ok: false, reason: "locked", lockedUntil: new Date(failedRow.locked_until).toISOString() }
      : { ok: false, reason: "invalid", attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS - Number(failedRow?.attempts ?? 1)) };
  }
  await pool.request().input("key", throttleKey).query(
    "WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.pin_attempts WHERE [key]=@key;",
  );
  return {
    ok: true,
    staff: {
      id: String(row.id ?? row.username),
      username: String(row.username),
      full_name: String(row.full_name ?? row.username),
      store_id: row.store_id ?? null,
      role_slug: String(row.role_slug ?? row.role ?? "staff").toLowerCase(),
      permissions: permissions(row.permissions),
      is_active: true,
    },
  };
}

module.exports = { listSyncedStaff, verifySyncedStaffPin };
