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
      CONVERT(nvarchar(128),id) id,COALESCE(NULLIF(login_username,''),user_id) username,full_name,store_id,
      role,role_slug,permissions,is_active,email
      FROM dbo.app_users
      WHERE is_active=1 AND (store_id IS NULL OR store_id=@branch)
        AND (LOWER(email) LIKE '%@pos-internal.local' OR LOWER(email) LIKE '%@pos.local' OR COALESCE(offline_login_pin_hash,'')<>'')
      ORDER BY full_name,user_id;`);
  return {
    ok: true,
    rows: (result.recordset ?? []).map((row) => ({
      id: String(row.id ?? row.username),
      username: String(row.username ?? ""),
      fullName: String(row.full_name ?? row.username ?? ""),
      email: String(row.email ?? ""), pinLength: 0,
      storeId: row.store_id == null ? null : String(row.store_id),
      roleSlug: String(row.role_slug ?? row.role ?? "staff").toLowerCase(),
      permissions: permissions(row.permissions),
      isActive: true,
    })),
  };
}

/** Verify the same bcrypt PIN hash Supabase synchronized into local SQL Server. */
async function verifySyncedPin(pool, username, pin, branchId, purpose, options = {}) {
  if (!pool || !branchId) return { ok: false, reason: "unavailable" };
  let name = String(username ?? "").trim().toLowerCase();
  const secret = String(pin ?? "");
  let tokenOnly = false;
  if (!name && purpose === "approval" && /^\d{8}$/.test(secret) && typeof options.identifyTotp === "function") {
    // Reserve every code-only attempt atomically, including successes: changing
    // guessed identities or restarting the renderer cannot reset the budget.
    const gate = await pool.request().input("key", `approval-lookup:${String(branchId).toLowerCase()}`)
      .query(`WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        MERGE dbo.pin_attempts WITH (HOLDLOCK) AS target
        USING (SELECT @key AS [key]) AS source ON target.[key]=source.[key]
        WHEN MATCHED AND (target.attempts<5 OR target.window_started_at<DATEADD(minute,-1,SYSDATETIMEOFFSET())) THEN UPDATE SET
          attempts=CASE WHEN target.window_started_at<DATEADD(minute,-1,SYSDATETIMEOFFSET()) THEN 1 ELSE target.attempts+1 END,
          window_started_at=CASE WHEN target.window_started_at<DATEADD(minute,-1,SYSDATETIMEOFFSET()) THEN SYSDATETIMEOFFSET() ELSE target.window_started_at END,
          updated_at=SYSDATETIMEOFFSET()
        WHEN NOT MATCHED THEN INSERT([key],attempts,window_started_at,created_at,updated_at)
          VALUES(@key,1,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET())
        OUTPUT inserted.[key];`);
    if (!gate.recordset?.length) return { ok: false, reason: "locked", error: "Too many token attempts. Try again in one minute." };
    name = String(await options.identifyTotp(secret, branchId) ?? "").toLowerCase();
    tokenOnly = true;
  }
  if (!name || secret.length < 4 || secret.length > 32) return { ok: false, reason: "invalid" };
  // app_users owns the manager-approval PIN; cashiers owns the independent
  // terminal sign-in PIN. Never swap these or one credential can authorize
  // the other operation again.
  const hashColumn = purpose === "approval" ? "a.pin_hash" : "CASE WHEN a.email LIKE '%@%' AND LOWER(a.email) NOT LIKE '%@pos-internal.local' AND LOWER(a.email) NOT LIKE '%@pos.local' THEN a.offline_login_pin_hash ELSE c.pin_hash END";
  const result = await pool.request()
    .input("username", name)
    .input("branch", String(branchId))
    .query(`SELECT TOP (1)
      CONVERT(nvarchar(128),a.id) id,a.user_id username,a.full_name,a.store_id,
      a.role,a.role_slug,a.permissions,a.is_active,${hashColumn} pin_hash
      FROM dbo.app_users a
      OUTER APPLY (
        SELECT TOP (1) candidate.pin_hash
        FROM dbo.cashiers candidate
        WHERE LOWER(candidate.username)=LOWER(a.user_id) AND candidate.is_active=1
        ORDER BY candidate.updated_at DESC,candidate.id DESC
      ) c
      WHERE (LOWER(a.user_id)=@username OR LOWER(a.login_username)=@username OR LOWER(a.email)=@username OR LOWER(CONVERT(nvarchar(128),a.id))=@username)
        AND (a.store_id IS NULL OR a.store_id=@branch)
      ORDER BY CASE WHEN a.store_id=@branch THEN 0 ELSE 1 END,a.updated_at DESC,a.id DESC;`);
  const row = result.recordset?.[0];
  if (!row) return { ok: false, reason: "missing" };
  if (!row.is_active) return { ok: false, reason: "inactive", error: "Account deactivated" };
  // Username and UUID are aliases for the same account. Throttle them under
  // one canonical identity so switching identifier cannot bypass the lock.
  const throttleKey = `electron:${purpose}:${String(branchId).toLowerCase()}:${String(row.id).toLowerCase()}`;
  const throttle = await pool.request().input("key", throttleKey).query(
    "SELECT TOP (1) attempts,window_started_at,locked_until FROM dbo.pin_attempts WHERE [key]=@key;",
  );
  const lockUntil = throttle.recordset?.[0]?.locked_until;
  if (lockUntil && new Date(lockUntil).getTime() > Date.now()) {
    return { ok: false, reason: "locked", lockedUntil: new Date(lockUntil).toISOString() };
  }
  const hash = String(row.pin_hash ?? "");
  const switches = permissions(row.permissions);
  const pinEnabled = purpose !== "approval" || switches.approval_pin_enabled !== false;
  const validPin = !tokenOnly && pinEnabled && hash && await bcrypt.compare(secret, hash);
  const validToken = !validPin && purpose === "approval" && switches.approval_totp_enabled === true &&
    typeof options.verifyTotp === "function" && await options.verifyTotp(pool, String(row.username), secret, branchId);
  if (!validPin && !validToken) {
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
    credentialMethod: validToken ? "totp" : "pin",
    staff: {
      id: String(row.id ?? row.username),
      username: String(row.username),
      full_name: String(row.full_name ?? row.username),
      store_id: row.store_id ?? null,
      role: String(row.role ?? row.role_slug ?? "staff").toLowerCase(),
      role_slug: String(row.role_slug ?? row.role ?? "staff").toLowerCase(),
      permissions: permissions(row.permissions),
      is_active: true,
    },
  };
}

const verifySyncedStaffPin = (pool, username, pin, branchId) =>
  verifySyncedPin(pool, username, pin, branchId, "terminal");
const verifySyncedApprovalPin = (pool, username, pin, branchId, options) =>
  verifySyncedPin(pool, username, pin, branchId, "approval", options);

module.exports = { listSyncedStaff, verifySyncedStaffPin, verifySyncedApprovalPin };
