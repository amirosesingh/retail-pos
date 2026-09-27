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
});

describe("cashier location bootstrap", () => {
  it("persists relay credentials before publishing the signed-in cashier", () => {
    const source = read("src/lib/pos-auth.tsx");
    const auth = source.slice(source.indexOf("const cashierLogin"));
    expect(auth.indexOf("await saveCashierToken(cashierToken)")).toBeLessThan(
      auth.indexOf("setTerminalUser(next)"),
    );
  });

  it("loads the location directory independently of heavy business data", () => {
    const store = read("src/lib/pos-store.tsx");
    expect(store).toContain("const locationTask = isOnlineOnly() ? loadLocationDirectory() : null");
    expect(store).toContain(
      "const cloudTask = loadPrimaryState(undefined, locationTask ?? undefined)",
    );
    expect(store.indexOf('markStartupStage("essential-pos-ready")')).toBeLessThan(
      store.indexOf("const loaded = await cloudTask"),
    );
  });

  it("does not accept an anonymous empty store response ahead of a proven relay", () => {
    const db = read("src/core/api/pos-db.ts");
    expect(db).toContain("const relayFirst = await relayed()");
    expect(db).toContain("const relayFallback = await relayed()");
    expect(db).toContain("if (!(direct.data ?? []).length)");
    expect(db).toContain("if (!directAuthenticated)");
    expect(db).toContain("Could not verify access to the location directory");
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
