import { describe, expect, it } from "vitest";
import { passwordUsername, passwordUsernameLookup } from "../password-username";

describe("password account username", () => {
  it("requires an explicit @ so cashier names retain PIN sign-in", () => {
    expect(passwordUsername(" @Manager.One ")).toBe("manager.one");
    expect(passwordUsername("manager.one")).toBeNull();
    expect(passwordUsername("manager@example.com")).toBeNull();
    expect(passwordUsername("@a")).toBeNull();
  });
  it("rejects filter metacharacters and limits the lookup", () => {
    expect(passwordUsername("@name),is_active.eq.true")).toBeNull();
    expect(() => passwordUsernameLookup("name),is_active.eq.true")).toThrow();
    expect(passwordUsernameLookup("manager.one")).toContain("&limit=2");
  });
});
