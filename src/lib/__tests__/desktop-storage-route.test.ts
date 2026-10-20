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
  it("does not silently redirect a configured broken or unvalidated database", () => {
    for (const state of [null, {}, {enabled:true,configured:true,connected:false}, {enabled:true,configured:true,connected:true,tradingReady:false}]) expect(desktopStorageRoute(state)).toBe("pending");
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
