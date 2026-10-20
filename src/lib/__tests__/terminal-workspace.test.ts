import { describe, expect, it } from "vitest";
import { orderWorkspaceGroups, shouldOpenRegister, workspacePurpose } from "@/lib/terminal-workspace";

describe("terminal workspace landing", () => {
  it("opens retail cashiers in the workspace until Sell now is explicit", () => {
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: false,
        isSupervisor: false,
        isCashier: true,
      }),
    ).toBe(false);
  });

  it.each(["warehouse", "inventory", "receiving", "management"] as const)(
    "opens the %s purpose home without granting access",
    (purpose) => {
      expect(
        shouldOpenRegister({ purpose, isAdmin: false, isSupervisor: false, isCashier: true }),
      ).toBe(false);
    },
  );

  it("keeps admin and manager accounts management-first on a retail terminal", () => {
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: true,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: false,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
  });

  it("always resumes protected selling flows and explicit register navigation", () => {
    const base = {
      purpose: "warehouse" as const,
      isAdmin: true,
      isSupervisor: true,
      isCashier: false,
    };
    expect(shouldOpenRegister({ ...base, forcedSelling: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, resumeSale: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, bookingFlow: true })).toBe(true);
  });
});

describe("terminal navigation priority", () => {
  const groups = ["register", "bookings", "inventory", "people", "company", "reports"].map(
    (id) => ({ id }),
  );

  it("puts stock work first on warehouse terminals", () => {
    expect(orderWorkspaceGroups(groups, "warehouse", false).map((group) => group.id)[0]).toBe(
      "inventory",
    );
  });

  it("puts management work first for administrators and supervisors", () => {
    expect(
      orderWorkspaceGroups(groups, "retail", true)
        .map((group) => group.id)
        .slice(0, 2),
    ).toEqual(["company", "inventory"]);
  });
});

describe("platform workspace purpose", () => {
  it("keeps the registered Windows purpose for administrators", () => {
    expect(workspacePurpose("warehouse", true, { isAdmin: true, isSupervisor: true })).toBe("warehouse");
  });
  it("uses the signed-in manager rather than another user's saved workspace on phones and web", () => {
    expect(workspacePurpose("retail", false, { isAdmin: false, isSupervisor: true })).toBe("management");
    expect(workspacePurpose("management", false, { isAdmin: false, isSupervisor: false })).toBe("retail");
    expect(workspacePurpose("management", false, { isAdmin: false, isSupervisor: false, isWarehouse: true })).toBe("warehouse");
  });
});
