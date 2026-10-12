import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  isAdmin: true,
  user: { role: "admin", metaRole: "cashier", permissions: {} },
}));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/pos-store", () => ({
  usePos: () => ({
    state: { settings: { visibility: { hidden: { "register.closeShift": ["cashier"] } } } },
    updateSettings: vi.fn(),
  }),
}));
import { useVisibility } from "../ui-visibility";
import {
  canOpenDrawer,
  drawerPulseBytes,
  protectedDrawerOpen,
  setSharedPrinterPrefs,
} from "../receipt-printer";
function Probe() {
  const visibility = useVisibility();
  return createElement(
    "span",
    null,
    `${visibility.role}:${visibility.visible("register.closeShift")}:${visibility.visibleRoute("/settings/database")}`,
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  setSharedPrinterPrefs(undefined);
  auth.isAdmin = true;
});
describe("shared permission visibility", () => {
  it("uses verified admin authority despite old cashier metadata", () => {
    expect(renderToStaticMarkup(createElement(Probe))).toContain("admin:true:true");
  });
  it("keeps cashier controls hidden", () => {
    auth.isAdmin = false;
    expect(renderToStaticMarkup(createElement(Probe))).toContain("cashier:false:false");
  });
});
describe("printer-connected drawer", () => {
  it("does not claim browser or Android print dialogs can open a drawer", () => {
    vi.stubGlobal("window", {});
    expect(canOpenDrawer()).toBe(false);
    vi.stubGlobal("window", { pos: { print: vi.fn() } });
    expect(canOpenDrawer()).toBe(false);
  });
  it.each([2, 5] as const)(
    "sends the configured printer and connector pin %s to protected IPC",
    async (pin) => {
      const openDrawer = vi.fn(async () => ({ ok: true, eventId: "audit-event" }));
      vi.stubGlobal("window", { pos: { print: vi.fn(), openDrawer } });
      setSharedPrinterPrefs({ deviceName: "Receipt printer", share: "Receipt", drawerPin: pin });
      expect(canOpenDrawer()).toBe(true);
      expect(drawerPulseBytes()).toEqual([27, 112, pin === 5 ? 1 : 0, 25, 250]);
      expect(await protectedDrawerOpen("End of shift", "shift-id")).toEqual({
        handled: true,
        ok: true,
        eventId: "audit-event",
      });
      expect(openDrawer).toHaveBeenCalledWith({
        reason: "End of shift",
        shiftId: "shift-id",
        pin,
        printer: { deviceName: "Receipt printer", share: "Receipt" },
      });
    },
  );
});
