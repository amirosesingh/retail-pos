/**
 * A browser sitting on the sign-in screen must not talk to the central
 * database. Every table is protected per user, so background work started
 * before anyone signs in can only produce rejected requests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const tokens = vi.hoisted(() => ({ session: null as string | null, cashier: null as string | null }));
vi.mock("@/lib/pos-credentials", () => ({
  sessionTokenSync: () => tokens.session,
  cashierTokenSync: () => tokens.cashier,
}));

import { hasSignedInIdentity, __setAuthSessionForTests, setSessionStartupPending } from "../session-presence";

describe("hasSignedInIdentity", () => {
  beforeEach(() => {
    // The guard only speaks for a real device; give it a minimal browser.
    (globalThis as { window?: unknown }).window = globalThis;
    tokens.session = null;
    tokens.cashier = null;
    __setAuthSessionForTests(false);
  });

  it("is false for a visitor on the sign-in screen", () => {
    expect(hasSignedInIdentity()).toBe(false);
  });

  it("is true once a cashier session token exists", () => {
    tokens.session = "sess-1";
    expect(hasSignedInIdentity()).toBe(true);
  });

  it("is true for a till that still holds its cashier token", () => {
    tokens.cashier = "cash-1";
    expect(hasSignedInIdentity()).toBe(true);
  });

  it("is true for a back-office account with a central session", () => {
    __setAuthSessionForTests(true);
    expect(hasSignedInIdentity()).toBe(true);
  });

  it("keeps cached staff and cashier credentials quiet until startup is settled", () => {
    tokens.session = "persisted-session";
    tokens.cashier = "persisted-cashier";
    __setAuthSessionForTests(true);
    setSessionStartupPending(true);
    expect(hasSignedInIdentity()).toBe(false);
    setSessionStartupPending(false);
    expect(hasSignedInIdentity()).toBe(true);
  });

  it("stays signed out when validation removes an expired token before releasing startup", () => {
    tokens.session = "expired";
    setSessionStartupPending(true);
    expect(hasSignedInIdentity()).toBe(false);
    tokens.session = null;
    setSessionStartupPending(false);
    expect(hasSignedInIdentity()).toBe(false);
  });

  it("preserves local credentials across an unavailable startup check", () => {
    tokens.cashier = "offline-till";
    setSessionStartupPending(true);
    setSessionStartupPending(false);
    expect(tokens.cashier).toBe("offline-till");
    expect(hasSignedInIdentity()).toBe(true);
  });

  it("does not trust an initial stored token or poll account state for a local terminal user", () => {
    const authProvider = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(authProvider).toContain('if (event === "INITIAL_SESSION")');
    expect(authProvider).toContain(
      'if (!centralUserId || !centralAuthVerified || typeof window === "undefined")',
    );
    expect(authProvider).not.toContain("if (!user || typeof window");
  });
});
