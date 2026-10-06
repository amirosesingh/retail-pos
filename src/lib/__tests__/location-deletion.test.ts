import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

describe("protected location deletion", () => {
  const migrationPath =
    "supabase/migrations/20261006050000_complete_empty_store_guards.sql";

  it("requires exact-name confirmation and refuses connected records", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("p_confirmation_name text");
    expect(migration).toContain("btrim(coalesce(p_confirmation_name, '')) <> target.name");
    for (const blocker of [
      "child locations",
      "staff accounts",
      "sales",
      "sale items",
      "payments",
      "bookings",
      "held orders",
      "shifts and cash counts",
      "drawer events",
      "purchase orders",
      "stock transfers",
      "inventory records",
      "owned products",
      "units on hand",
      "audit and activity history",
      "authorization and edit history",
      "terminal commands",
      "user sessions",
      "active terminals",
    ]) {
      expect(migration).toContain(`'${blocker}'`);
    }
    expect(migration).toContain("item.value::bigint > 0");
    expect(migration).toContain("target.is_active IS DISTINCT FROM false");
    expect(migration).toContain("At least one active location must remain.");
    expect(migration.indexOf("DELETE FROM public.terminal_recovery_secrets")).toBeLessThan(
      migration.indexOf("DELETE FROM public.terminal_tokens"),
    );
  });

  it("keeps the routine off public clients and behind caller permission", () => {
    const migration = read(migrationPath);
    const canonical = read("supabase/schema.sql");
    const server = read("src/lib/location-admin.functions.ts");
    const client = read("src/lib/location-admin.ts");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.delete_empty_store(text, text) FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.delete_empty_store(text, text) TO service_role;",
    );
    expect(server).toContain('permission: "can_manage_locations"');
    expect(server).toContain('serviceRpc("delete_empty_store"');
    expect(client).toContain("getPosCallerAuth");
    expect(canonical).toMatch(/CREATE OR REPLACE\s+FUNCTION public\.delete_empty_store\(/);
    expect(canonical).toContain(
      "REVOKE ALL ON FUNCTION public.delete_empty_store(text, text) FROM PUBLIC, anon, authenticated;",
    );
  });

  it("requires the same exact name in the management UI", () => {
    const route = read("src/routes/stores.tsx");
    expect(route).toContain("deleteName !== deleteTarget.name");
    expect(route).toContain("permanentlyDeleteEmptyLocation(deleteTarget.id, deleteName)");
    expect(route).toContain("Connected records must be removed or retained:");
  });
});
