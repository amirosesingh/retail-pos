import { describe, expect, it } from "vitest";
import { receivingLocation } from "../receiving-location";
import type { Store } from "@/core/types/pos-types";

const store = (id: string, isCentral = false): Store => ({
  id, name: id, code: id, address: "", phone: "", isCentral,
});
const branchId = "a611a328-2217-4d77-944a-5f6a637d123b";

describe("Electron receiving destination", () => {
  it("keeps receiving in the paired branch when the selected hub belongs elsewhere", () => {
    const hub = store("central", true);
    const branch = store(branchId);
    expect(receivingLocation([hub, branch], hub, true, branchId)).toEqual(branch);
  });
  it("canonicalizes uppercase SQL Server branch ids", () => {
    const branch = store(branchId.toUpperCase());
    expect(receivingLocation([branch], branch, true, branch.id).id).toBe(branchId);
  });
  it("uses the paired id while the location directory is still loading", () => {
    expect(receivingLocation([], store("old-selection"), true, branchId).id).toBe(branchId);
  });
  it("leaves online central-hub receiving unchanged", () => {
    const hub = store("central", true);
    expect(receivingLocation([hub], store(branchId), false, branchId)).toEqual(hub);
  });
  it("does not invent a branch for an unpaired terminal", () => {
    expect(receivingLocation([], store("old-selection"), true, null).id).toBe("");
  });
});
