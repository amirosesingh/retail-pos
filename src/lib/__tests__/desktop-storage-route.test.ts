import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopStorageRoute } from "../desktop-storage-route";
import { localDb, loadLocalDbConfigState, reconnectLocalDatabase } from "@/core/local-db/local-db";
vi.mock("@/lib/live-mode", () => ({ isOnlineOnly: () => false }));
afterEach(() => vi.unstubAllGlobals());
describe("desktop storage selection", () => {
  it("uses cloud when SQL is unconfigured or explicitly disabled", () => {
    expect(desktopStorageRoute({enabled:true,configured:false})).toBe("online");
    expect(desktopStorageRoute({enabled:false,configured:true})).toBe("online");
  });
  it("uses a validated local database regardless of internet connectivity", () => {
    expect(desktopStorageRoute({enabled:true,configured:true,connected:true,tradingReady:true})).toBe("local");
  });
  it("waits for unknown state or connected SQL that has not finished validation", () => {
    for (const state of [null, {}, {enabled:true,configured:true,connected:true,tradingReady:false}]) expect(desktopStorageRoute(state)).toBe("pending");
  });
  it("automatically uses online mode during a confirmed SQL disconnection", () => {
    expect(desktopStorageRoute({state:"enabled_error",enabled:true,configured:true,connected:false,tradingReady:false})).toBe("online");
    expect(desktopStorageRoute({enabled:true,configured:true,connected:true,tradingReady:true})).toBe("local");
  });
  it.each(["enabled_connecting", "enabled_validating", "enabled_bootstrapping"])("waits for the saved SQL attempt during %s", state => {
    expect(desktopStorageRoute({state,enabled:true,configured:true,connected:false,tradingReady:false})).toBe("pending");
  });
  it("keeps configuration and reconnect accessible while business queries use cloud", async () => {
    const config = {server:"local-sql",database:"pos"};
    const reconnect = vi.fn().mockResolvedValue({ok:true});
    const pos = {getDatabaseConfig: vi.fn().mockResolvedValue(config), reconnect};
    vi.stubGlobal("window", {pos,sessionStorage:{getItem:()=>"1"}});
    expect(localDb()).toBeNull();
    expect(await loadLocalDbConfigState()).toMatchObject({configured:true,config});
    expect(await reconnectLocalDatabase()).toMatchObject({ok:true});
    expect(reconnect).toHaveBeenCalledOnce();
  });
});
