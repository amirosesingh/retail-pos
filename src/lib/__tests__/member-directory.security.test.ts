import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("member directory write boundaries", () => {
  it("lets enrolment omit protected balances while privileged edits can include them", () => {
    const db = read("src/core/api/pos-db.ts");
    const store = read("src/lib/pos-store.tsx");

    expect(db).toContain("includeBalances = true");
    expect(db).toContain("tier_id: tierId(m.tier)");
    expect(db).toContain("includeBalances");
    expect(store).toContain('db.commitMember(member, can("can_edit_member_points"))');
  });

  it("archives members so historic receipts and bookings retain their references", () => {
    const db = read("src/core/api/pos-db.ts");
    const memberDelete = db.slice(db.indexOf("deleteMember:"), db.indexOf("upsertPromotion:"));

    expect(memberDelete).toContain('kind: "update"');
    expect(memberDelete).toContain("deleted_at:");
    expect(memberDelete).not.toContain('kind: "delete"');
  });

  it("uses physical member column names for the bounded cloud search", () => {
    const db = read("src/core/api/pos-db.ts");
    const search = db.slice(
      db.indexOf("export async function searchCloudMembers"),
      db.indexOf("export async function loadCloudPromotion"),
    );

    expect(search).toContain("full_name.ilike");
    expect(search).toContain("member_code.ilike");
    expect(search).not.toContain("`name.ilike");
    expect(search).not.toContain("`code.ilike");
  });

  it("does not expose history or writable points without their permissions", () => {
    const route = read("src/routes/members.tsx");
    const relay = read("src/core/api/relay-policy.server.ts");

    expect(route).toContain('can("can_view_member_history")');
    expect(route).toContain('readOnly={!can("can_edit_member_points")}');
    expect(route).toContain('aria-readonly={!can("can_edit_member_points")}');
    expect(route).toContain('disabled={!can("can_edit_member_points")}');
    expect(relay).toContain('tier_id: "can_edit_member_points"');
  });
});
