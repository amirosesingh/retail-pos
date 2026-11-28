import { afterEach, expect, it, vi } from "vitest";
import { localDb } from "@/core/local-db/local-db";
import { managementInventoryReader } from "../management-inventory-client";
import { setManagementDevice } from "../management-device";

afterEach(() => { setManagementDevice(null); vi.unstubAllGlobals(); });

it("uses the fixed native inventory IPC while Management's general local bridge stays blocked", () => {
  const managementInventory = vi.fn();
  vi.stubGlobal("window", { pos: { managementInventory } });
  setManagementDevice({ tokenId: "management-device", deviceUse: "management" });
  expect(localDb()).toBeNull();
  expect(managementInventoryReader()).toBe(managementInventory);
  setManagementDevice({ tokenId: "operations-device", deviceUse: "operations", locationId: "a" });
  expect(managementInventoryReader()).toBeUndefined();
});
