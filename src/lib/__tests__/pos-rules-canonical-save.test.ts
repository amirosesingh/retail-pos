import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: "https://pos-rules-fixture.test", key: "fixture" }),
}));
import { saveRules } from "../pos-rules.server";

const read = (file: string) => readFileSync(file, "utf8");
afterEach(() => vi.unstubAllGlobals());

describe("canonical POS rules contract", () => {
  it("never bypasses the versioned save RPC with a table upsert", () => {
    const server = read("src/lib/pos-rules.server.ts");
    expect(server).toContain("/rest/v1/rpc/pos_rules_save");
    expect(server).toContain("_expected_version: expectedVersion");
    expect(server).not.toContain('serviceRest("pos_store_settings?on_conflict=store_id"');
  });

  it("returns the branch row version with effective inherited rules", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toContain("FUNCTION public.pos_rules_snapshot");
    expect(schema).toContain("'rules', public.pos_rules_get(r.store_id)");
    expect(schema).toContain("'row_version', COALESCE(m.row_version, 1)");
  });

  it("confirms only the selected branch and next revision from the save response", async () => {
    const patch = { block_shift_close_on_hold: false };
    const saved = { store_id: "branch-a", row_version: 8, rules: patch };
    const fetch = vi.fn(async () => Response.json(saved));
    vi.stubGlobal("fetch", fetch);
    await expect(saveRules("branch-a", patch, "staff-token", 7)).resolves.toMatchObject({
      storeId: "branch-a", rowVersion: 8, rules: patch,
    });
    for (const reply of [{ ...saved, store_id: "branch-b" }, { ...saved, row_version: 7 }, { ...saved, rules: null }]) {
      fetch.mockResolvedValueOnce(Response.json(reply));
      await expect(saveRules("branch-a", patch, "staff-token", 7)).rejects.toThrow("selected store");
    }
  });
});
