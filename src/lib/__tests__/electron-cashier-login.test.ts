import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("Electron cashier sign in", () => {
  it("performs the hosted PIN check in Electron main instead of Chromium", () => {
    const preload = read("electron/preload.cjs");
    const main = read("electron/main.cjs");
    const auth = read("src/lib/pos-auth.tsx");
    const privilege = read("electron/ipc-privilege.cjs");

    expect(preload).toContain('invoke("auth:cashier-login"');
    expect(main).toContain('ipcMain.handle("auth:cashier-login"');
    expect(main).toContain("/api/public/cashier-login`");
    expect(main).toContain("signal: abort.signal");
    expect(main).toContain(
      'adminSession.grant(level, cashier.username ?? username, cashier.permissions ?? {}, "pos", branchId)',
    );
    expect(main).toContain("syncCloud.setAuthorizationProof(proof)");
    expect(main).toContain('publishBusinessChange({kind:"branch",branchId:String(branchId)})');
    expect(auth).toContain("window.pos?.cashierLogin");
    expect(privilege).toContain('"auth:cashier-login": OPEN');
  });

  it("reloads the local snapshot when sign-in repairs a token-only branch mirror", () => {
    const store = read("src/lib/pos-store.tsx");
    expect(store).toContain('if (change.kind === "branch" || change.kind === "refund")');
    expect(store).toContain("setReloadTick((tick) => tick + 1)");
  });

  it("locks the keypad submit path synchronously against duplicate requests", () => {
    const login = read("src/platforms/web/components/auth/CashierPinLogin.tsx");
    expect(login).toContain("const submittingRef = useRef(false)");
    expect(login).toContain("if (submittingRef.current) return");
    expect(login).toContain("submittingRef.current = true");
    expect(login).toContain("submittingRef.current = false");
  });

  it("keeps one live external Auth client and isolates temporary clients", () => {
    const client = read("src/integrations/supabase/external-client.ts");
    const config = read("src/lib/secure-cloud-config.ts");

    expect(client).toContain("retireClient(previous)");
    expect(client).toContain('Symbol.for("retail-pos.supabase.external-clients.v1")');
    expect(client).toContain("pos-transient-auth-");
    expect(client).toContain('supabaseFetchFor(key, configScope === "pos")');
    expect(client).not.toContain("const SUPABASE_PUBLISHABLE_KEY = supabaseConfig().key");
    expect(config).toContain("if (setTerminalSupabaseOverride(res.url, res.key))");
  });
});
