import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("administrator corrections and shared table controls", () => {
  it("rejects posted-record correction writes unless the verified role is admin", () => {
    const server = read("src/lib/record-edits.functions.ts");
    const flow = read("src/lib/record-edit-flow.ts");
    expect(server).toContain('who.role.trim().toLowerCase() !== "admin"');
    expect(server.match(/requireAdmin\(who\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(server).toContain('error: "A branch scope is required"');
    expect(flow).toContain('identity.role.trim().toLowerCase() !== "admin"');
    expect(flow).not.toContain("Sent for approval");
  });

  it("keeps shift correction behind server-verified admin and branch checks", () => {
    const source = read("src/lib/shift-corrections.functions.ts");
    expect(source).toContain("verifyRelayCaller");
    expect(source).toContain("resolveRelayScope");
    expect(source).toContain('scope.roleSlug === "admin" || scope.role === "admin"');
    expect(source).toContain("scope.storeId && scope.storeId !== data.storeId");
    expect(source).toContain('serviceRest("rpc/pos_admin_correct_closed_shift"');
  });

  it("provides sort, per-column filter and resize controls on shared table headers", () => {
    const source = read("src/components/ui/table.tsx");
    expect(source).toContain("Sort ${direction === \"asc\" ? \"descending\" : \"ascending\"}");
    expect(source).toContain("Filter ${label} values");
    expect(source).toContain("Resize ${label} column");
    expect(source).toContain('event.key !== "ArrowLeft" && event.key !== "ArrowRight"');
    expect(source).toContain('window.addEventListener("pointermove", move)');
    expect(source).toContain('window.addEventListener("pointercancel", stop)');
    expect(source).toContain("resizeCleanupRef.current?.()");
    expect(source).not.toContain("function decorateTableHeaders(");
    expect(source).toContain("sortTableBodies(child, sort)");
    expect(source).toContain("filterTableBodies(child, filters)");
  });
});
