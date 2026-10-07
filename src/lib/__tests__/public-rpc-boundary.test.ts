import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const publicRpcs = [
  "coupon_claim",
  "terminal_token_claim",
  "terminal_token_heartbeat",
  "terminal_token_status",
  "voucher_by_token",
] as const;

describe("public pre-authentication RPC boundary", () => {
  const migration = read(
    "supabase/migrations/20261007022338_harden_public_rpc_boundaries.sql",
  );
  const schema = read("supabase/schema.sql");

  it("keeps privileged implementations outside the exposed public schema", () => {
    for (const rpc of publicRpcs) {
      expect(migration).toContain(`private.${rpc}_impl`);
      expect(schema).toContain(`'${rpc}', '${rpc}_impl'`);
    }
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(5);
    expect(schema.match(/AS \$wrapper\$/g)).toHaveLength(5);
  });

  it("retains only narrow pre-authentication execution grants", () => {
    expect(migration).toContain("REVOKE ALL ON SCHEMA private FROM PUBLIC");
    expect(migration).toContain("GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role");
    expect(migration).not.toContain("GRANT ALL ON FUNCTION private.");
  });
});

describe("redundant prefix index cleanup", () => {
  const migration = read(
    "supabase/migrations/20261007022428_remove_redundant_prefix_indexes.sql",
  );

  it("removes only audited non-unique prefix indexes", () => {
    expect(migration.match(/DROP INDEX IF EXISTS/g)).toHaveLength(10);
    expect(migration).not.toContain("DROP INDEX IF EXISTS public.products_barcode_key");
    expect(migration).not.toContain("DROP INDEX IF EXISTS public.sales_bill_number_key");
  });
});
