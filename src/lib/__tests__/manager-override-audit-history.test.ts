import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("manager override audit history", () => {
  it("keeps one RPC signature and records every approval in all history stores", () => {
    const schema = read("supabase/schema.sql");
    const migration = read("supabase/migrations/20260928213000_complete_authorization_history.sql");

    for (const sql of [schema, migration]) {
      expect(sql).toContain(
        "DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text)",
      );
      expect(sql).toContain("INSERT INTO public.authorization_log");
      expect(sql).toContain("INSERT INTO public.audit_logs");
      expect(sql).toContain("INSERT INTO public.system_audit_logs");
      expect(sql).toContain("'authorization.override.' || clean_outcome");
      expect(sql).toContain("request_id, requested_by");
      expect(sql).toContain("approved_by_name");
      expect(sql).toContain("approval_purpose");
    }
  });

  it("records own-PIN approvals without bypassing the immutable audit", () => {
    const schema = read("supabase/schema.sql");
    const gate = read("src/lib/manager-gate.tsx");
    const functions = read("src/lib/authorization.functions.ts");
    const report = read("src/routes/reports.history.tsx");
    expect(schema).toContain("'approved_by_name', u.full_name");
    expect(gate).not.toContain("authorizeAsAdmin");
    expect(gate).toContain("selfAuthorizer");
    expect(functions).toContain("selfAuthorization: z.boolean().default(false)");
    expect(functions).toContain("self_authorization: data.selfAuthorization");
    expect(report).toContain("Where / reference");
    expect(report).toContain("display.method");
  });

  it("requires an authorization PIN when every new staff account is created", () => {
    const admin = read("src/lib/staff-admin.functions.ts");
    const server = read("src/lib/staff-admin.server.ts");
    const screen = read("src/platforms/web/components/admin/StaffManager.tsx");
    expect(admin).toContain("authorizationPin: z.string().regex");
    expect(server).toContain("p_pin: authorizationPin");
    expect(screen).toContain("Generate 6-digit PIN");
  });
});
