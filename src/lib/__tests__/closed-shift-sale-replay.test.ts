import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sameRecordId } from "../sale-identity";
describe("closed shift exchange replay", () => {
  it("allows only an existing bill with the same shift and branch before the insert guard", () => {
    const migration = readFileSync("supabase/migrations/20261012111755_allow_existing_sale_replay_after_shift_close.sql", "utf8").replaceAll("\r\n", "\n");
    expect(migration).toContain("s.id = NEW.id");
    expect(migration).toContain("s.shift_id IS NOT DISTINCT FROM NEW.shift_id");
    expect(migration).toContain("s.store_id IS NOT DISTINCT FROM NEW.store_id");
    expect(migration.indexOf("IF EXISTS")).toBeLessThan(migration.indexOf("s_state <> 'ACTIVE'"));
    expect(migration).toContain("RAISE EXCEPTION 'This shift is being closed");
    const schema = readFileSync("supabase/schema.sql", "utf8").replaceAll("\r\n", "\n");
    expect(schema).toContain(migration.slice(migration.indexOf("CREATE OR REPLACE")).trim());
  });
  it("shows local SQL Server bills when UUID branch casing differs", () => {
    const branch = "a611a328-2217-4d77-944a-5f6a637d123b";
    expect(sameRecordId(branch.toUpperCase(), branch)).toBe(true);
    const route = readFileSync("src/routes/shifts.tsx", "utf8").replaceAll("\r\n", "\n");
    expect(route).toContain("useShiftSales(currentStore.id,activeShift?.id");
    expect(route).toContain("sameRecordId(activeShift.storeId,currentStore.id)");
    expect(route).not.toContain("s.storeId === currentStore.id");
  });
});
