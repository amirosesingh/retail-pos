import { describe, expect, it, vi } from "vitest";

describe("SQL Server persistent state machine", () => {
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
});
