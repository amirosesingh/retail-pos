import { describe, expect, it } from "vitest";
import { signInDestination } from "../sign-in-destination";

describe("sign-in destination", () => {
  it("opens Home for an authorized administrator", () => {
    expect(signInDestination(true, true, true)).toBe("/dashboard");
  });
  it("opens Selling for other users even when they can visit Home", () => {
    expect(signInDestination(false, true, true)).toBe("/");
    expect(signInDestination(false, false, false)).toBe("/");
  });
  it("does not bypass dashboard permission or visibility", () => {
    expect(signInDestination(true, false, true)).toBe("/");
    expect(signInDestination(true, true, false)).toBe("/");
  });
});
