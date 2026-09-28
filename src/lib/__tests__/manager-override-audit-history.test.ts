import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("manager override audit history", () => {
  it("keeps one RPC signature and records every approval in all history stores", () => {
    const schema = read("supabase/schema.sql");
    const migration = read(
      "supabase/migrations/20260928194500_fix_manager_override_audit_history.sql",
    );

    for (const sql of [schema, migration]) {
      expect(sql).toContain(
        "DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text)",
      );
      expect(sql).toContain("INSERT INTO public.authorization_log");
      expect(sql).toContain("INSERT INTO public.audit_logs");
      expect(sql).toContain("INSERT INTO public.system_audit_logs");
      expect(sql).toContain("'authorization.override.' || clean_outcome");
    }
  });

  it("labels PIN and automatic administrator approvals separately", () => {
    const schema = read("supabase/schema.sql");
    const server = read("src/lib/pos-rules.server.ts");
    expect(schema).toContain("p_detail, 'approved', 'pin'");
    expect(server).toContain('_mode_used: "admin_auto"');
    expect(server).toContain('_outcome: "approved"');
  });
});
