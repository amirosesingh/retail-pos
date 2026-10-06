import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Supervisor/Admin online login configuration", () => {
  it("restores activation before applying the current device connection profile", () => {
    const boot = read("src/platforms/mobile/components/NativeBoot.tsx");
    const activation = boot.indexOf(".then(() => hydrateTerminalConfig())");
    const profile = boot.indexOf(".then(() => hydrateConnectionProfile())");

    expect(activation).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(activation);
  });

  it("waits for the device connection profile before password authentication", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const login = auth.indexOf("const login = useCallback");
    const hydration = auth.indexOf("await awaitProfileHydrated()", login);
    const passwordAuth = auth.indexOf("supabase.auth.signInWithPassword", login);

    expect(hydration).toBeGreaterThan(login);
    expect(passwordAuth).toBeGreaterThan(hydration);
  });

  it("does not issue protected profile reads before the central session is verified", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const roles = auth.indexOf('// Backend roles for the signed-in account.');
    const profile = auth.indexOf('// Identity + permission toggles from public.app_users');
    const status = auth.indexOf('// An account switched off by a manager');

    expect(auth.slice(roles, profile)).toContain("!userId || !centralAuthVerified || terminalUser");
    expect(auth.slice(profile, auth.indexOf("const persist", profile))).toContain(
      "!userId || !centralAuthVerified || terminalUser",
    );
    expect(auth.slice(status, auth.indexOf("// Boot / resume check", status))).toContain(
      "!centralUserId || !centralAuthVerified",
    );
    expect(auth).toContain(
      "const account = !terminalUser && centralAuthVerified ? session?.user : null",
    );
    expect(auth).toContain(
      "const ready = authReady && (!!terminalUser || !userId || (rolesReady && profileReady))",
    );
    const credentials = read("src/lib/pos-credentials.ts");
    expect(credentials).toContain("centralAuthAccessToken()");
    expect(credentials).not.toContain("supabaseExternal.auth.getSession()");
  });

  it("keeps the staff auth session out of quota-limited localStorage", () => {
    const client = read("src/integrations/supabase/external-client.ts");
    const storage = read("src/integrations/supabase/auth-storage.ts");
    expect(client).toContain("storage: persistSession");
    expect(client).toContain("externalAuthStorage");
    expect(storage).toContain('indexedDB.open(DB_NAME, 1)');
    expect(storage).toContain("sessionStorage.setItem(key, value)");
    expect(storage).toContain("Memory already holds the session");
    expect(storage).not.toContain("localStorage.setItem");
  });

  it("keeps cashier login and Emergency Access source untouched by this fix", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const boot = read("src/platforms/mobile/components/NativeBoot.tsx");

    expect(auth).toMatch(/cashierLogin:/);
    expect(auth).toMatch(/issueCashierSession/);
    expect(boot).toMatch(/const \[recovery\] = useState\(\(\) => onRecoveryScreen\(\)\)/);
    expect(boot).toMatch(/const \[ready, setReady\] = useState\(recovery\)/);
  });

  it("keeps a PIN operator identity stable while its optional Auth session opens", () => {
    const shell = read("src/platforms/web/components/pos/AppShell.tsx");
    const identity = shell.indexOf("const identity =");
    const terminal = shell.indexOf("terminalUser?.userCode", identity);
    const central = shell.indexOf("authUserId", identity);

    expect(terminal).toBeGreaterThan(identity);
    expect(central).toBeGreaterThan(terminal);
  });
});
