const bcrypt = require("bcryptjs");

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
  if (!hash || !await bcrypt.compare(secret, hash)) return { ok: false, reason: "invalid" };
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
