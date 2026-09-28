import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleStaffAdminRequest } from "../staff-admin-endpoint.server";

const source = (path: string) => readFileSync(path, "utf8");

describe("terminal staff administration", () => {
  it("routes every privileged terminal mutation through the hosted CORS relay", () => {
    const client = source("src/lib/staff-admin-client.ts");
    const staff = source("src/lib/staff-admin.ts");
    const route = source("src/routes/api/v1/pos/sync.ts");

    expect(client).toContain('posFetch("/api/v1/pos/sync?operation=staff_admin"');
    expect(client).toContain("if (!isTerminalApp())");
    for (const action of ['"save"', '"set_active"', '"migrate"', '"update"', '"delete"']) {
      expect(client).toContain(action);
    }
    expect(staff).toContain('from "@/lib/staff-admin-client"');
    expect(route).toContain('searchParams.get("operation") === "staff_admin"');
    expect(route).toContain("handleStaffAdminRequest(request)");
  });

  it("rejects unknown actions before loading privileged staff code", async () => {
    const response = await handleStaffAdminRequest(
      new Request("https://pos.example/api/v1/pos/sync?operation=staff_admin", {
        method: "POST",
        body: JSON.stringify({ action: "not_allowed", data: {} }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});
