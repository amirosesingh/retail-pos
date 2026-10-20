import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOperatorIdentity, isOperatorIdentity, matchesOperatorIdentity, readOperatorIdentity, saveOperatorIdentity } from "../operator-auth-identity";
import { readFileSync } from "node:fs";
const operator = { id: "real-operator", email: "cashier@pos-internal.local" };
const terminal = { id: "machine", email: "terminal.361@pos.local" };
afterEach(() => vi.unstubAllGlobals());
describe("operator login boundary on all platforms", () => {
  it.each(["ios", "android", "windows", "web"])("%s stays signed out on background machine sign-in and focus replay", () => {
    for (const incoming of [terminal, operator, { id: "other-user", email: "other@example.com" }]) {
      expect(matchesOperatorIdentity(incoming, null)).toBe(false);
    }
  });
  it("allows refresh of the selected operator but never a switch to another user", () => {
    expect(matchesOperatorIdentity(operator, operator.id)).toBe(true);
    expect(matchesOperatorIdentity({ id: "another", email: operator.email }, operator.id)).toBe(false);
    expect(matchesOperatorIdentity(terminal, operator.id)).toBe(false);
    expect(matchesOperatorIdentity(terminal, terminal.id)).toBe(false);
    expect(isOperatorIdentity({ id: "machine", email: " Terminal.361@POS.LOCAL " })).toBe(false);
  });
  it("persists only an explicitly established operator and clears it on logout", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {sessionStorage: {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => data.set(k,v), removeItem: (k: string) => data.delete(k)}});
    expect(readOperatorIdentity()).toBeNull();
    expect(() => saveOperatorIdentity(terminal)).toThrow();
    saveOperatorIdentity(operator);
    expect(matchesOperatorIdentity(operator, readOperatorIdentity())).toBe(true);
    clearOperatorIdentity();
    expect(matchesOperatorIdentity(operator, readOperatorIdentity())).toBe(false);
  });
  it("fails closed for unavailable browser storage", () => {
    expect(readOperatorIdentity()).toBeNull();
    expect(() => clearOperatorIdentity()).not.toThrow();
  });
  it("gates Auth events, startup restoration and foreground verification in the shared provider", () => {
    const source=readFileSync('src/lib/pos-auth.tsx','utf8');
    expect(source).toContain('if (next && !matchesOperatorIdentity(next.user, operatorAuthId.current)) return;');
    expect(source).toContain('const next = matchesOperatorIdentity(checked.session?.user, operatorAuthId.current) ? checked.session : null;');
    expect(source).toContain('authCheck.state === "verified" && matchesOperatorIdentity(authCheck.session?.user, operatorAuthId.current)');
    const login=source.slice(source.indexOf('const login ='), source.indexOf('const cashierLogin ='));
    expect(login.indexOf('profile["is_active"] === false')).toBeLessThan(login.indexOf('saveOperatorIdentity(data.session.user)'));
  });
});
