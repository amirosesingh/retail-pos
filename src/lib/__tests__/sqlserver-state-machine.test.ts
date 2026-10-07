import { describe, expect, it, vi } from "vitest";

describe("SQL Server persistent state machine", () => {
  it("applies a pending packaged migration automatically on saved-profile restore", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const profile = { host: "db", port: 1433, database: "POS_Local" };
    const manager = {
      pool: undefined as object | undefined,
      isConnected() { return Boolean(this.pool); },
      open: vi.fn(async function (this: { pool?: object }) { this.pool = {}; }),
      close: vi.fn(),
    };
    const validator = vi.fn()
      .mockResolvedValueOnce({ ok: true, ready: false, status: "migration_required", migrationHistoryPresent: true, missingMigrationVersions: [7] })
      .mockResolvedValueOnce({ ok: true, ready: true, status: "ready", migrationHistoryPresent: true, missingMigrationVersions: [] });
    const migrate = vi.fn().mockResolvedValue({ ok: true, applied: ["007_repair_scoped_json_values.sql"] });
    const service = new DatabaseService({
      secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile },
      manager, validator, migrate,
    });
    await expect(service.restore()).resolves.toMatchObject({ state: "enabled_bootstrapping", tradingReady: true });
    expect(migrate).toHaveBeenCalledExactlyOnceWith(profile);
    expect(validator).toHaveBeenCalledTimes(2);
  });

  it("never auto-migrates a database without Retail POS migration history", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const profile = { host: "db", database: "Other" };
    const migrate = vi.fn();
    const service = new DatabaseService({
      secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile },
      manager: { pool: {}, isConnected: () => true, open: vi.fn(), close: vi.fn() },
      validator: vi.fn().mockResolvedValue({ ok: true, ready: false, status: "migration_required", migrationHistoryPresent: false }),
      migrate,
    });
    await expect(service.restore()).resolves.toMatchObject({ state: "enabled_error", tradingReady: false });
    expect(migrate).not.toHaveBeenCalled();
  });
  it("starts nothing while disabled and restores one pool when enabled", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    let enabled = false;
    const secureConfig = {
      enabled: () => enabled,
      setEnabled: (value: boolean) => { enabled = value; },
      profile: () => ({ host: "db", port: 1433, database: "POS", authMode: "windows" }),
      credentials: () => ({ host: "db", port: 1433, database: "POS", authMode: "windows" }),
      remove: vi.fn(), save: vi.fn(),
    };
    const manager: { pool?: object; open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
      pool: undefined,
      open: vi.fn(async function (this: { pool?: object }) { this.pool = {}; }),
      close: vi.fn(),
    };
    const validator = vi.fn().mockResolvedValue({ ok: true, ready: true });
    const service = new DatabaseService({ secureConfig, manager, validator });
    await service.restore();
    expect(service.snapshot().state).toBe("disabled");
    expect(manager.open).not.toHaveBeenCalled();
    await service.setEnabled(true);
    expect(manager.open).toHaveBeenCalledOnce();
    expect(validator).toHaveBeenCalledOnce();
    expect(service.snapshot().state).toBe("enabled_bootstrapping");
    expect(service.snapshot().connected).toBe(true);
    expect(service.snapshot().tradingReady).toBe(true);
    service.markReady();
    expect(service.snapshot().state).toBe("enabled_ready");
  });

  it("survives restart as enabled but requires setup without a saved profile", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const service = new DatabaseService({
      secureConfig: { enabled: () => true, profile: () => null, credentials: () => null },
      manager: { open: vi.fn(), close: vi.fn() },
    });
    expect((await service.restore()).state).toBe("enabled_unconfigured");
  });

  it("does not mark an incomplete restored schema as trading ready", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const manager: { pool?: object; open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
      pool: undefined,
      open: vi.fn(async function (this: { pool?: object }) { this.pool = {}; }),
      close: vi.fn(async () => undefined),
    };
    const validation = {
      ok: true,
      ready: false,
      status: "migration_required",
      incompatibleColumns: ["sales.change_given:missing"],
    };
    const service = new DatabaseService({
      secureConfig: {
        enabled: () => true,
        profile: () => ({ host: "db", database: "POS" }),
        credentials: () => ({ host: "db", database: "POS" }),
      },
      manager,
      validator: vi.fn().mockResolvedValue(validation),
    });

    await expect(service.restore()).resolves.toMatchObject({
      state: "enabled_error",
      connected: true,
      tradingReady: false,
      detail: validation,
    });
    expect(manager.open).toHaveBeenCalledOnce();
    expect(manager.close).not.toHaveBeenCalled();
  });

  it("connects an exactly validated profile without validating or disconnecting again", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const profile = {
      host: "127.0.0.1",
      instanceName: "",
      port: 1433,
      database: "POS_Local",
      authMode: "windows",
      username: "",
      password: "",
      encrypt: true,
      trustServerCertificate: true,
    };
    const manager: {
      pool?: object;
      isConnected: () => boolean;
      open: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    } = {
      pool: undefined,
      isConnected() { return Boolean(this.pool); },
      open: vi.fn(async function (this: { pool?: object }) { this.pool = {}; }),
      close: vi.fn(),
    };
    const validator = vi.fn().mockResolvedValue({ ok: true, ready: true });
    const save = vi.fn(() => ({ ...profile, password: undefined }));
    const service = new DatabaseService({
      secureConfig: { enabled: () => false, profile: () => null, save },
      manager,
      validator,
    });

    await expect(service.validate(profile)).resolves.toMatchObject({ ok: true, ready: true });
    await expect(service.saveAndConnect(profile)).resolves.toMatchObject({ ok: true });

    expect(validator).toHaveBeenCalledOnce();
    expect(manager.open).toHaveBeenCalledOnce();
    expect(manager.close).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(profile);
  });

  it("requires validation again when the final TCP port differs", async () => {
    const { DatabaseService } = await import("../../../electron/db/service.cjs");
    const profile = {
      host: "127.0.0.1", port: 1433, database: "POS_Local", authMode: "windows",
      username: "", password: "", encrypt: true, trustServerCertificate: true,
    };
    const manager = { open: vi.fn(), close: vi.fn(), isConnected: () => false };
    const service = new DatabaseService({
      secureConfig: { enabled: () => false, profile: () => null, save: vi.fn() },
      manager,
      validator: vi.fn().mockResolvedValue({ ok: true, ready: true }),
    });

    await service.validate(profile);
    await expect(service.saveAndConnect({ ...profile, port: 1434 })).resolves.toMatchObject({
      ok: false,
      code: "EVALIDATION_REQUIRED",
    });
    expect(manager.open).not.toHaveBeenCalled();
  });
});
