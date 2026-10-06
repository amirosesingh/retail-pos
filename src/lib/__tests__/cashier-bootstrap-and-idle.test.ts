import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { OPERATOR_ACTIVITY_EVENTS, remainingAutoLockMs } from "@/lib/auto-lock";

const read = (path: string) => readFileSync(path, "utf8");
const MINUTE = 60_000;

describe("continuous operator inactivity", () => {
  it("expires a 15-minute window after zero activity", () => {
    expect(remainingAutoLockMs(15 * 60, 0, 15 * MINUTE)).toBe(15 * MINUTE);
    expect(remainingAutoLockMs(15 * 60, 1, 15 * MINUTE + 1)).toBe(0);
  });

  it("moves the deadline from minute 15 to minute 25 after activity at minute 10", () => {
    const activityAt = 10 * MINUTE;
    expect(remainingAutoLockMs(15 * 60, activityAt, 15 * MINUTE)).toBe(10 * MINUTE);
    expect(remainingAutoLockMs(15 * 60, activityAt, 25 * MINUTE)).toBe(0);
  });

  it("keeps moving the deadline after repeated valid activity", () => {
    let lastActivityAt = 0;
    for (const minute of [1, 10, 20, 34]) {
      lastActivityAt = minute * MINUTE;
      expect(remainingAutoLockMs(15 * 60, lastActivityAt, lastActivityAt + 14 * MINUTE)).toBe(
        MINUTE,
      );
    }
    expect(remainingAutoLockMs(15 * 60, lastActivityAt, 49 * MINUTE)).toBe(0);
  });

  it("covers mouse, touch, keyboard, scanner/form and wheel interaction", () => {
    expect(OPERATOR_ACTIVITY_EVENTS).toEqual(
      expect.arrayContaining([
        "pointerdown",
        "pointermove",
        "touchstart",
        "keydown",
        "input",
        "change",
        "submit",
        "wheel",
      ]),
    );
  });

  it("does not classify background mechanisms as operator activity", () => {
    const events = OPERATOR_ACTIVITY_EVENTS as readonly string[];
    for (const background of [
      "poll",
      "realtime",
      "sync",
      "heartbeat",
      "tokenrefresh",
      "response",
      "timer",
    ]) {
      expect(events).not.toContain(background);
    }
    const guard = read("src/lib/session-guard.server.ts");
    expect(guard).toContain("if (options.operatorActivity)");
  });

  it("uses timestamps on focus/resume and shares activity across tabs", () => {
    const source = read("src/lib/auto-lock.ts");
    expect(source).toContain('window.addEventListener("storage", onStoredActivity)');
    expect(source).toContain('window.addEventListener("focus", onResume)');
    expect(source).toContain('document.addEventListener("visibilitychange", onResume)');
    expect(source).toContain("remainingAutoLockMs(");
  });

  it("protects sale commit without allowing an unbounded lock bypass", () => {
    const lock = read("src/lib/auto-lock.ts");
    const store = read("src/lib/pos-store.tsx");
    expect(lock).toContain("MAX_OPERATION_GRACE_MS = 2 * 60_000");
    expect(store).toContain("const endCommitProtection = beginAutoLockOperation()");
    expect(store).toContain("endCommitProtection();");
  });

  it("clears the previous activity generation on logout", () => {
    const auth = read("src/lib/pos-auth.tsx");
    expect(auth).toContain("clearAutoLockActivity();");
    expect(auth).toContain("markAutoLockActivity();");
  });

  it("uses one server-issued idle limit for screen lock and session expiry", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const shell = read("src/platforms/web/components/pos/AppShell.tsx");
    const guard = read("src/lib/session-guard.server.ts");
    expect(auth).toContain("setSessionIdleMinutes(started.idleMinutes)");
    expect(shell).toContain("sessionIdleSeconds()");
    expect(guard).toContain("Math.min(own, branchDefault ?? DEFAULT_IDLE_MINUTES)");
  });
});

describe("cashier location bootstrap", () => {
  it("persists relay credentials before publishing the signed-in cashier", () => {
    const source = read("src/lib/pos-auth.tsx");
    const auth = source.slice(source.indexOf("const cashierLogin"));
    expect(auth.indexOf("await saveCashierToken(cashierToken)")).toBeLessThan(
      auth.indexOf("setTerminalUser(next)"),
    );
  });

  it("establishes the verified account session before POS bootstrap on every shell", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const login = auth.slice(auth.indexOf("const cashierLogin"), auth.indexOf("const endSession"));
    expect(login).toContain("verified?.authTokenHash");
    expect(login).not.toContain("preparePinAccount");
    expect(login.indexOf("supabase.auth.verifyOtp")).toBeLessThan(
      login.indexOf("setTerminalUser(next)"),
    );

    const server = read("src/lib/cashier-login.server.ts");
    expect(server).toContain("authTokenHash");
    expect(server).toContain("email,store_id");
    expect(server).toContain("createVerifiedPinSignInToken");
    expect(login).not.toContain("password: pin");
  });

  it("does not count a post-PIN Auth handoff failure as a wrong PIN", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const keypad = read("src/platforms/web/components/auth/CashierPinLogin.tsx");
    expect(auth).toContain('code: "session-open-failed"');
    expect(keypad).toContain('if (res.code === "session-open-failed")');
    expect(keypad).toContain("clearPinFailures();");
  });

  it("never replaces a real email password with a terminal approval PIN", () => {
    const staff = read("src/lib/staff-admin.server.ts");
    expect(staff).toContain("if (terminalAccount)");
    expect(staff).toContain("email.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)");
    expect(staff).toContain("createVerifiedPinSignInToken");
    expect(staff.indexOf("if (terminalAccount)")).toBeLessThan(
      staff.indexOf("body: JSON.stringify({ password: pin, email_confirm: true })"),
    );
  });

  it("resolves cashier inactivity from the canonical staff profile without a missing column probe", () => {
    const guard = read("src/lib/session-guard.server.ts");
    expect(guard).toContain("app_users?user_id=eq.");
    expect(guard).not.toContain("cashiers?id=eq.");
    expect(guard).not.toContain("cashiers?idle_timeout_minutes");
  });

  it("loads the location directory independently of heavy business data", () => {
    const store = read("src/lib/pos-store.tsx");
    expect(store).toContain("const canLoadCloudDirectory =");
    expect(store).toContain(
      "const locationTask = canLoadCloudDirectory ? loadLocationDirectory() : null",
    );
    expect(store).toContain(
      "const cloudTask = loadPrimaryState(undefined, locationTask ?? undefined)",
    );
    expect(store.indexOf('markStartupStage("essential-pos-ready")')).toBeLessThan(
      store.indexOf("const loaded = await cloudTask"),
    );
    expect(store).toContain('effectiveDatabaseMode() === "online"');
  });

  it("honours the Electron startup online override throughout read and sale routing", () => {
    const db = read("src/core/api/pos-db.ts");
    const query = read("src/core/api/db-query.ts");
    expect(db).toContain('effectiveDatabaseMode() === "local" && bridge?.snapshot');
    expect(db).toContain('const onlineOnly = effectiveDatabaseMode() === "online"');
    expect(query).toContain('effectiveDatabaseMode() === "local" && bridge?.query');
  });

  it("lets an authenticated admin recover an unbound Electron terminal from the cloud directory", () => {
    const db = read("src/core/api/pos-db.ts");
    expect(db).toContain("const terminal = readTerminalConfig() ?? (await hydrateTerminalConfig())");
    expect(db).toContain("if (!terminal?.locationId && hasStaffSession())");
    expect(db).toContain("return loadCloudState(storeId, locationTask)");
  });

  it("does not accept an anonymous empty store response ahead of a proven relay", () => {
    const db = read("src/core/api/pos-db.ts");
    expect(db).toContain("const relayFirst = await relayed()");
    expect(db).toContain("const relayFallback = await relayed()");
    expect(db).toContain("if (!(direct.data ?? []).length)");
    expect(db).toContain("if (!directAuthenticated)");
    expect(db).toContain("Could not verify access to the location directory");
  });

  it("returns warehouse identity fields through the registered-terminal relay", () => {
    const relay = read("src/core/api/pos-relay.server.ts");
    const directory = relay.slice(relay.indexOf('if (read.kind === "stores")'));
    expect(directory).toContain("location_type,parent_id,is_central,is_primary_sub");
    expect(directory).toContain("building_name,floor_label,is_active,archived_at");
    expect(directory).toContain("deleted_at=is.null");
  });

  it("repairs the authenticated profile privileges required after password sign-in", () => {
    const migration = read(
      "supabase/migrations/20261006073000_restore_staff_login_privileges.sql",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated, service_role",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.user_roles TO authenticated, service_role",
    );
    expect(migration).not.toMatch(/GRANT\s+(ALL|INSERT|UPDATE|DELETE).*user_roles/i);
  });

  it("keeps loading failures separate from a confirmed empty directory", () => {
    const guard = read("src/platforms/web/components/pos/LocationBootGuard.tsx");
    expect(guard.indexOf("Could not load locations")).toBeLessThan(
      guard.indexOf("No active location"),
    );
    expect(guard).toContain("!storesLoaded");
  });

  it("preserves NULL as company-wide access and removes the conflicting UUID helper", () => {
    const schema = read("supabase/schema.sql");
    const migration = read("supabase/migrations/20260927233640_fix_cashier_store_access_rls.sql");
    expect(schema).toContain("OR nullif(btrim(coalesce(u.store_id, '')), '') IS NULL");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.user_has_store_access(uuid)");
    expect(migration).not.toMatch(/UPDATE\s+public\.app_users\s+SET\s+store_id/i);
  });
});
