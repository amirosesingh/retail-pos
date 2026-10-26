import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { profileStoreAssignment } from "../auth-branch-assignment";
describe("web staff assignment versus branch being viewed", () => {
  it("keeps an explicit All stores assignment instead of a stale profile or terminal fallback", () => {
    expect(profileStoreAssignment({ store_id: null }, "previous-view")).toBeNull();
    expect(profileStoreAssignment({ store_id: "branch-a" }, "branch-b")).toBe("branch-a");
  });
  it("uses provisional identity only when no verified profile exists", () => {
    expect(profileStoreAssignment(null, "branch-a")).toBe("branch-a");
    expect(profileStoreAssignment({ store_id: null })).toBeNull();
  });
  it("keeps localhost preview on the browser sign-in path", () => {
    const source = readFileSync("src/platforms/web/components/pos/TerminalLogin.tsx", "utf8");
    expect(source).toContain("setTerminal(isTerminalApp())");
    expect(source).not.toContain("isLocalWebCashierTest");
  });
});
