import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Load both Electron modules through the same CommonJS cache: the privilege
// module deliberately owns the singleton session used by the desktop process.
const require = createRequire(import.meta.url);
const adminSession = require("../../../electron/admin-session.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const ipcGuard = require("../../../electron/ipc-guard.cjs");

const DATABASE_ADMIN_CHANNELS = [
  "database:set-enabled",
  "database:migrate",
  "database:save-connect",
  "database:disconnect",
  "database:remove-configuration",
  "database:backup",
  "database:restore",
] as const;

describe("local SQL Server discovery privilege", () => {
  beforeEach(() => adminSession.clear());

  it("explicitly classifies discovery as open", () => {
    expect(privilege.CHANNEL_LEVELS["database:list-servers"]).toBe(privilege.OPEN);
    expect(privilege.levelFor("database:list-servers")).toBe(privilege.OPEN);
  });

  it("allows discovery without an admin session, including a cashier/staff session", () => {
    expect(adminSession.status()).toMatchObject({ unlocked: false });
    expect(privilege.allowed("database:list-servers")).toBe(true);

    // Cashiers have no desktop privilege grant; discovery must remain available.
    expect(privilege.allowed("database:list-servers")).toBe(true);
    expect(adminSession.status()).toMatchObject({ unlocked: false });
  });

  it("allows an admin session to discover without changing or consuming the session", () => {
    adminSession.grant("admin", "admin-user");

    expect(privilege.allowed("database:list-servers")).toBe(true);
    expect(adminSession.status()).toMatchObject({
      unlocked: true,
      level: "admin",
      subject: "admin-user",
    });
  });

  it("runs the discovery handler without requiring or mutating configuration", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    };
    privilege.install(ipcMain);
    const configuration = { enabled: false, configured: false, host: "manual-host" };
    const discover = vi.fn(async () => ({
      ok: true,
      servers: [{ host: "localhost", label: "localhost", status: "running" }],
    }));
    ipcMain.handle("database:list-servers", discover);

    const result = await handlers.get("database:list-servers")?.({});

    expect(discover).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, servers: [{ host: "localhost" }] });
    expect(configuration).toEqual({ enabled: false, configured: false, host: "manual-host" });
    expect(adminSession.status()).toMatchObject({ unlocked: false });
  });

  it("requires the database permission for every configuration and write channel", () => {
    for (const channel of DATABASE_ADMIN_CHANNELS) {
      expect(privilege.CHANNEL_LEVELS[channel], channel).toBe(privilege.ADMIN);
      expect(privilege.allowed(channel), channel).toBe(false);
    }
  });

  it("uses only the verified POS account permission instead of a desktop role", () => {
    adminSession.grant("staff", "signed-in-staff", { can_manage_sync_backup: true }, "pos");
    expect(privilege.allowed("database:save-connect")).toBe(true);
    expect(privilege.allowed("sync:run-now")).toBe(true);
    expect(privilege.allowed("sqladmin:repair")).toBe(true);
    expect(privilege.allowed("settings:set", ["database_host"])).toBe(true);
    expect(privilege.allowed("terminal:write")).toBe(false);

    adminSession.grant("admin", "signed-in-admin", { can_manage_sync_backup: false }, "pos");
    expect(privilege.allowed("database:save-connect")).toBe(true);
    expect(privilege.allowed("sqladmin:repair")).toBe(true);
    expect(privilege.allowed("config:set", ["sync_enabled"])).toBe(true);

    adminSession.grant("admin", "desktop-unlock", { can_manage_sync_backup: true }, "manual");
    expect(privilege.allowed("database:save-connect")).toBe(false);

    adminSession.clear();
    expect(privilege.allowed("database:save-connect")).toBe(false);
    expect(privilege.refusal(privilege.ADMIN, "database:save-connect")).toMatchObject({
      ok: false,
      code: "EPRIVILEGE",
    });
  });

  it("keeps the verified POS branch with the desktop authority session", () => {
    adminSession.grant(
      "admin",
      "signed-in-admin",
      { can_manage_sync_backup: true },
      "pos",
      "branch-7",
    );
    expect(adminSession.branchId()).toBe("branch-7");
    adminSession.clear();
    expect(adminSession.branchId()).toBeNull();
  });

  it("keeps privileged retries wired to server-verified session adoption", () => {
    const gate = readFileSync("src/platforms/windows/components/PrivilegeGate.tsx", "utf8");
    const ipcGate = readFileSync("electron/ipc-privilege.cjs", "utf8");
    const wizard = readFileSync(
      "src/platforms/windows/components/LocalDatabaseWizard.tsx",
      "utf8",
    );
    const main = readFileSync("electron/main.cjs", "utf8");
    const adoptRoute = readFileSync("src/routes/api/v1/pos/ipc-adopt.ts", "utf8");

    expect(gate).toContain("readTerminalConfig(),");
    expect(gate).toContain('requiredLevel === "admin" && adopted.level !== "admin"');
    expect(main).toContain('ipcMain.handle("admin:adopt-session"');
    expect(main).toContain('configStore.get("backendUrl")');
    expect(main).toContain('`${authorizationUrl}/api/v1/pos/ipc-adopt`');
    expect(main).not.toContain('`${baseUrl}/api/v1/pos/ipc-adopt`');
    expect(main).toContain('`${authorizationUrl}/api/v1/pos/ipc-authorize`');
    expect(main).not.toContain('`${baseUrl}/api/v1/pos/ipc-authorize`');
    expect(adoptRoute).toContain("verifyRelayCaller(proof)");
    expect(adoptRoute).toContain("sessionToken:");
    expect(adoptRoute).toContain("cashierToken:");
    expect(adoptRoute).not.toMatch(/role\s*:\s*input/);
    expect(adoptRoute).not.toMatch(/authority\?\.permissions\.can_manage_sync_backup/);
    expect(adoptRoute).not.toMatch(/authority\.permissions\.can_manage_sync_backup/);
    expect(main).toContain('adminSession.grant(result.level,result.subject,result.permissions,"pos",result.branchId)');
    expect(main).toContain("const mirrored=terminalStore.write(terminal)");
    expect(main).toContain("terminal.locationId,terminal.storeId,terminal.branchId,adminSession.branchId()");
    expect(ipcGate).toContain("adminSession.hasPosAuthority()");
    expect(wizard).toMatch(
      /const authorization = await authorizeDatabaseChange\(\);[\s\S]{0,220}const migrated = await api\(\)!\.migrateDatabase\(profile\)/,
    );
    const startup = readFileSync("src/routes/database-startup.tsx", "utf8");
    const modal = readFileSync("src/platforms/windows/components/DbConnectionModal.tsx", "utf8");
    expect(startup).toContain("<LocalDatabaseWizard initiallyOpen");
    expect(modal).toContain('window.location.assign("/database-startup")');
  });

  it("accepts legitimate long POS access tokens without relaxing token limits", () => {
    const proof = ipcGuard.credentialProof({
      accessToken: "a".repeat(2000),
      sessionToken: "pst_signed_in",
    });
    expect(proof.accessToken).toHaveLength(2000);
    expect(() => ipcGuard.credentialProof({ accessToken: "a".repeat(4001) })).toThrow(
      /accessToken is too long/,
    );
    expect(() => ipcGuard.credentialProof({ role: "admin" })).toThrow(
      /unexpected setting/,
    );
  });

  it("runs database listing through the installed IPC gate without a staff grant", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle(channel: string, listener: (...args: unknown[]) => unknown) {
        handlers.set(channel, listener);
      },
    };
    privilege.install(ipcMain);
    const list = vi.fn(async () => ({ ok: true, databases: [{ name: "Shop", state_desc: "ONLINE" }] }));
    ipcMain.handle("database:list-databases", list);
    expect(privilege.allowed("database:list-databases")).toBe(true);
    expect(await handlers.get("database:list-databases")?.({})).toMatchObject({
      ok: true,
      databases: [{ name: "Shop" }],
    });
    expect(adminSession.status()).toMatchObject({ unlocked: false });
  });

  it("allows the read-only connection probe without unlocking the terminal", () => {
    expect(privilege.CHANNEL_LEVELS["database:test-server"]).toBe(privilege.OPEN);
    expect(privilege.allowed("database:test-server")).toBe(true);
    expect(privilege.CHANNEL_LEVELS["database:list-databases"]).toBe(privilege.OPEN);
    expect(privilege.CHANNEL_LEVELS["database:validate"]).toBe(privilege.OPEN);
    expect(privilege.CHANNEL_LEVELS["database:export-migrations"]).toBe(privilege.OPEN);
    expect(privilege.CHANNEL_LEVELS["database:migrate-saved"]).toBe(privilege.ADMIN);
    expect(privilege.allowed("database:list-databases")).toBe(true);
    expect(privilege.allowed("database:validate")).toBe(true);
    expect(adminSession.status()).toMatchObject({ unlocked: false });
  });

  it("keeps the central staff role through PIN sign-in so an existing admin is adopted", () => {
    const login = readFileSync("src/lib/cashier-login.server.ts", "utf8");
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");

    expect(login).toContain("role,role_slug,permissions,is_active");
    expect(login).toContain("role: profile.role");
    expect(login).toContain("role_slug: profile.role_slug ?? null");
    expect(auth).toContain("role: account.role");
    expect(auth).toContain("roleSlug: account.role_slug");
  });
});
