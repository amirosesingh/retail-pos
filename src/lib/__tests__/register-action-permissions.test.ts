import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("register action permission boundaries", () => {
  const register = readFileSync("src/routes/index.tsx", "utf8");

  it("keeps keyboard and command actions behind the same grants as their buttons", () => {
    const handlers = register.slice(
      register.indexOf("const registerActionHandlers"),
      register.indexOf("return (", register.indexOf("const registerActionHandlers")),
    );

    expect(handlers).toContain('requirePermission("can_open_drawer")');
    expect(handlers).toContain('can("can_manage_bookings")');
    expect(handlers).toContain('can("can_add_member")');
    expect(handlers).toContain('lastSale && can("can_reprint_bill")');
  });
});
