const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const KEY = "offlineStaffCredentials";
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
// SQL Server owns the synchronized roster.  This DPAPI-sealed store is only a
// last-resort verifier cache, so keep a small number of recently used people.
const MAX_CACHED_USERS = 12;

function createLocalStaffStore(configStore) {
  const failures = new Map();
  const read = () => {
    const rows = configStore.get(KEY);
    return rows && typeof rows === "object" && !Array.isArray(rows) ? rows : {};
  };
  const compact = (rows) => Object.fromEntries(
    Object.entries(rows)
      .sort(([, a], [, b]) => {
        const credential = Number(Boolean(b?.verifier)) - Number(Boolean(a?.verifier));
        if (credential) return credential;
        return String(b?.cached_at ?? "").localeCompare(String(a?.cached_at ?? ""));
      })
      .slice(0, MAX_CACHED_USERS),
  );
  const write = (rows) => configStore.set(KEY, compact(rows));
  const key = (value) => String(value ?? "").trim().toLowerCase();
  const profile = (raw) => ({
    id: String(raw.id ?? raw.user_id ?? raw.username ?? "").slice(0, 128),
    username: String(raw.username ?? raw.user_id ?? "").trim().slice(0, 160),
    full_name: String(raw.full_name ?? raw.fullName ?? raw.username ?? "").slice(0, 200),
    store_id: raw.store_id ?? raw.storeId ?? null,
    role_slug: String(raw.role_slug ?? raw.roleSlug ?? raw.role ?? "staff").toLowerCase().slice(0, 64),
    permissions: Object.fromEntries(Object.entries(raw.permissions && typeof raw.permissions === "object" ? raw.permissions : {}).filter(([key,value])=>/^can_[a-z0-9_]{1,80}$/.test(key)&&typeof value==="boolean").slice(0,200)),
    is_active: raw.is_active !== false && raw.isActive !== false,
  });
  function cache(values) {
    const rows = read();
    let written = 0;
    for (const value of (Array.isArray(values) ? values : []).slice(0, MAX_CACHED_USERS)) {
      const next = profile(value ?? {});
      const name = key(next.username);
      if (!name) continue;
      const current = rows[name] ?? {};
      // Renderer roster data is useful for the picker but cannot change the
      // authority attached to a credential that was enrolled after a live
      // server PIN check.
      rows[name] = current.verifier
        ? { ...current, ...next, verifier: current.verifier, cached_at: current.cached_at }
        : { ...current, ...next, cached_at: new Date().toISOString() };
      written += 1;
    }
    const saved = write(rows);
    return saved?.ok === false ? saved : { ok: true, written };
  }
  function remember(username, pin) {
    const rows = read();
    const name = key(username);
    const current = rows[name];
    if (!current?.is_active) return { ok: false, error: "This staff account is not cached on this terminal." };
    if (String(pin ?? "").length < 4 || String(pin ?? "").length > 32) return { ok: false, error: "Enter a valid PIN or passcode." };
    const salt = randomBytes(16);
    const hash = scryptSync(String(pin), salt, 32);
    rows[name] = {
      ...current,
      verifier: `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`,
      cached_at: new Date().toISOString(),
    };
    return write(rows);
  }
  function enroll(raw, pin) {
    const rows = read();
    const next = profile(raw ?? {});
    const name = key(next.username);
    if (!name || !next.is_active) return { ok: false, error: "The verified staff profile is invalid." };
    if (String(pin ?? "").length < 4 || String(pin ?? "").length > 32) return { ok: false, error: "Enter a valid PIN or passcode." };
    const salt = randomBytes(16);
    const hash = scryptSync(String(pin), salt, 32);
    rows[name] = {
      ...next,
      verifier: `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`,
      cached_at: new Date().toISOString(),
    };
    failures.delete(name);
    return write(rows);
  }
  function verify(username, pin) {
    const name = key(username);
    const state = failures.get(name);
    if (state?.lockedUntil > Date.now()) return { ok: false, reason: "locked", error: "Too many wrong PINs. Try again in five minutes." };
    const staff = read()[name];
    const parts = String(staff?.verifier ?? "").split(":");
    let valid = false;
    try {
      if (staff?.is_active && parts.length === 3 && parts[0] === "scrypt") {
        const expected = Buffer.from(parts[2], "base64");
        const actual = scryptSync(String(pin ?? ""), Buffer.from(parts[1], "base64"), expected.length);
        valid = timingSafeEqual(actual, expected);
      }
    } catch { valid = false; }
    if (!valid) {
      const count = Number(state?.count ?? 0) + 1;
      failures.set(name, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
      return { ok: false, reason: "invalid", error: "Invalid username or PIN." };
    }
    failures.delete(name);
    const { verifier: _verifier, ...safe } = staff;
    return { ok: true, staff: safe };
  }
  function roster(storeId) {
    const branch = String(storeId ?? "");
    const rows = Object.values(read()).filter((row) => row.is_active && (!branch || !row.store_id || String(row.store_id) === branch));
    return { ok: true, rows: rows.map(({ verifier: _verifier, ...row }) => row) };
  }
  return { cache, remember, enroll, verify, roster };
}

module.exports = { createLocalStaffStore };
