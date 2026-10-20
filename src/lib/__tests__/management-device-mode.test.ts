import { afterEach, expect, it } from "vitest";
import { isManagementDevice, setManagementDevice } from "../management-device";
afterEach(() => setManagementDevice(null));
it("does not reinterpret an incomplete legacy activation as management", () => {
  setManagementDevice({ tokenId: "legacy", locationId: "" });
  expect(isManagementDevice()).toBe(false);
});
it("only enables management mode for an explicit unbound registration", () => {
  setManagementDevice({ tokenId: "pc", locationId: "", deviceUse: "management" });
  expect(isManagementDevice()).toBe(true);
  setManagementDevice({ tokenId: "pc", locationId: "branch-a", deviceUse: "management" });
  expect(isManagementDevice()).toBe(false);
});
