import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("adds only iOS to the existing mobile claim contract without dropping authorization guards", () => {
  const original = readFileSync("supabase/migrations/20261007022338_harden_public_rpc_boundaries.sql", "utf8");
  const migration = readFileSync("supabase/migrations/20261020033000_allow_ios_mobile_terminal_claim.sql", "utf8");
  const start = "CREATE OR REPLACE FUNCTION private.terminal_token_claim_impl(";
  const body = original.slice(original.indexOf(start), original.indexOf("CREATE OR REPLACE FUNCTION private.terminal_token_heartbeat_impl")).trim();
  const updated = migration.slice(migration.indexOf(start), migration.indexOf("COMMIT;")).trim();
  expect(updated).toBe(body.replace("p_platform = 'android'", "p_platform IN ('android', 'ios')"));
});
