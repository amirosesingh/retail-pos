import { describe, expect, it, vi } from "vitest";

async function fixture() {
  const { DatabaseService } = await import("../../../electron/db/service.cjs");
  let profile = { host: "db", database: "POS" };
  const manager = {
    pool: undefined as object | undefined,
    isConnected() { return Boolean(this.pool); },
    open: vi.fn(async function(this: { pool?: object }) { this.pool = {}; }),
    close: vi.fn(async function(this: { pool?: object }) { this.pool = undefined; }),
  };
  const validator = vi.fn().mockResolvedValue({ ok: true, ready: true });
  const publish = vi.fn();
  const service = new DatabaseService({ manager, validator, publish,
    secureConfig: { enabled: () => true, credentials: () => profile, profile: () => profile } });
  return { service, manager, validator, publish, changeProfile: () => { profile = { host: "other", database: "POS" }; } };
}

describe("database resume", () => {
  it("keeps a healthy restored connection ready without repeating setup", async () => {
    const { service, manager, validator, publish } = await fixture();
    await service.restore(); service.markReady(); publish.mockClear();
    expect(await service.restore({ reuseValidation: true })).toMatchObject({ tradingReady: true, state: "enabled_ready" });
    expect(validator).toHaveBeenCalledOnce(); expect(manager.open).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
  it("reconnects a lost pool without migrations but fails closed on connection errors", async () => {
    const { service, manager, validator } = await fixture();
    await service.restore(); manager.pool = undefined;
    expect(await service.restore({ reuseValidation: true })).toMatchObject({ tradingReady: true });
    expect(validator).toHaveBeenCalledOnce();
    manager.pool = undefined; manager.open.mockRejectedValueOnce(new Error("unreachable"));
    expect(await service.restore({ reuseValidation: true })).toMatchObject({ tradingReady: false, state: "enabled_error" });
  });
  it("validates cold starts, changed profiles, migration repairs and explicit retries", async () => {
    const { service, validator, changeProfile } = await fixture();
    await service.restore({ reuseValidation: true });
    changeProfile(); await service.restore({ reuseValidation: true });
    service.beginMigration(); await service.restore({ reuseValidation: true });
    await service.restore();
    expect(validator).toHaveBeenCalledTimes(4);
  });
});
