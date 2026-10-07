import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Supabase sync replay locking", () => {
  it("serializes equal batch ids in migrations and the canonical schema", () => {
    const migration = read(
      "supabase/migrations/20261007013301_harden_sync_replay_and_location_selection.sql",
    );
    const schema = read("supabase/schema.sql");
    const lock =
      "pg_advisory_xact_lock(pg_catalog.hashtextextended('pos-sync-batch:' || p_batch_id::text, 0))";

    expect(migration).toContain("public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)");
    expect(migration).toContain("public.pos_sync_push_aggregate(uuid,text,text,jsonb)");
    expect(migration).toContain("public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)");
    expect(migration).toContain("replace(pg_get_functiondef(signature), E'\\r\\n', E'\\n')");
    expect(migration).toContain("pos-sync-batch:");
    const lockPattern = new RegExp(lock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    expect(schema.match(lockPattern)).toHaveLength(2);

    const lockOffsets = [...schema.matchAll(lockPattern)].map((match) => match.index);
    const receiptOffsets = [...schema.matchAll(/SELECT payload_hash INTO v_prior/g)].map(
      (match) => match.index,
    );
    expect(receiptOffsets).toHaveLength(2);
    expect(lockOffsets[0]).toBeLessThan(receiptOffsets[0]);
    expect(lockOffsets[1]).toBeLessThan(receiptOffsets[1]);
  });

  it("keeps fresh installs on the byte-safe incremental pull limit", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toContain("'LEAST(GREATEST(p_limit,10),2000)'");
  });
});
