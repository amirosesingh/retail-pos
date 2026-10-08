import { beforeEach, describe, expect, it, vi } from "vitest";
const device = vi.hoisted(() => ({ platform: "web", tokenId: "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => ({ tokenId: device.tokenId }) }));
vi.mock("@/platform-config/features", () => ({
  isWindowsShell: () => device.platform === "electron",
  isMobileShell: () => device.platform === "android",
}));
vi.mock("@/core/local-db/local-db", () => ({
  readLocalSetting: vi.fn(async () => null), writeLocalSetting: vi.fn(async () => true),
}));
import { documentOrigin } from "../document-origin";
import { nextStockRef } from "../stock-ref";
import { reserveBillNumber } from "../bill-number";
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
beforeEach(() => {
  values.clear(); device.platform = "web";
  vi.stubGlobal("localStorage", storage); vi.stubGlobal("window", { localStorage: storage });
});
describe("branch and platform document identity", () => {
  it("separates platforms, branches and devices even with the same terminal display number", () => {
    const origins = new Set<string>();
    for (const platform of ["web", "electron", "android"]) {
      device.platform = platform;
      for (const branch of ["B1", "B2"]) {
        for (const token of ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]) {
          device.tokenId = token; origins.add(documentOrigin(branch));
        }
      }
    }
    expect(origins.size).toBe(12);
  });
  it("keeps new stock documents distinct during concurrent reservations", async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => nextStockRef({}, "B1")));
    expect(new Set(numbers).size).toBe(20);
    expect(numbers.every(number => number.includes("B1-WEB-"))).toBe(true);
  });
  it("reserves distinct Electron bills while browser business storage is disabled", async () => {
    device.platform = "electron"; vi.stubGlobal("window", { pos: {}, localStorage: storage });
    const bills = await Promise.all(Array.from({ length: 5 }, () => reserveBillNumber("B1", [], { terminalNo: "01" })));
    expect(new Set(bills).size).toBe(5);
    expect(bills.every(number => number.startsWith("B1-WIN01-"))).toBe(true);
  });
});
