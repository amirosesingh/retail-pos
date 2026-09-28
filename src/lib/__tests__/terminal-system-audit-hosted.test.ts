import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleSystemAuditRequest } from "../system-audit-endpoint.server";

const read = (path: string) => readFileSync(path, "utf8");

describe("terminal system audit", () => {
  it("routes audit writes and report reads through the hosted backend", () => {
    const client = read("src/lib/system-audit-client.ts");
    const route = read("src/routes/api/v1/pos/sync.ts");
    const recorder = read("src/lib/system-audit.ts");
    const report = read("src/routes/reports.history.tsx");
    expect(client).toContain("operation=system_audit");
    expect(client).toContain('"record"');
    expect(client).toContain('"list"');
    expect(route).toContain('searchParams.get("operation") === "system_audit"');
    expect(recorder).toContain('from "./system-audit-client"');
    expect(report).toContain('from "@/lib/system-audit-client"');
  });

  it("rejects unknown audit actions before loading privileged code", async () => {
    const response = await handleSystemAuditRequest(
      new Request("https://pos.example/api/v1/pos/sync?operation=system_audit", {
        method: "POST",
        body: JSON.stringify({ action: "erase", data: {} }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});
