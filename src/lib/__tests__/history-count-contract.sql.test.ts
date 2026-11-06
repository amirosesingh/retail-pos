import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20261106020500_complete_change_history_sync_count.sql";

describe("complete existing change-history sync count", () => {
  it("changes only the pinned four-argument count wrapper and preserves its current history scope", () => {
    const sql = readFileSync(path, "utf8");
    const sources = JSON.parse(sql.match(/\$sources\$([\s\S]*?)\$sources\$/)![1]) as { signature: string; body_md5: string }[];
    expect(sources.map(source => source.signature).sort()).toEqual([
      "public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)",
      "public.pos_sync_counts(text,text,text,integer)",
      "public.pos_sync_counts_scoped(text,text,text,integer)",
    ]);
    expect(sources.every(source => /^[a-f0-9]{32}$/.test(source.body_md5))).toBe(true);
    expect(sql).toContain("SELECT 'change_history'::text,count(*)::bigint FROM public.change_history;");
    expect(sql).toContain('FROM public."change_history" x WHERE (true)');
    expect(sql).toContain("EXECUTE replace(definition,old_select,new_select)");
    expect(sql).toContain("HISTORY_COUNT_METADATA_CHANGED");
    expect(sql).toContain("HISTORY_COUNT_SELECTOR_CHANGED");
    expect(sql).toContain("||pg_catalog.chr(10)");
    const literals = [...sql.matchAll(/\$(old|new|history|sources)\$([\s\S]*?)\$\1\$/g)];
    expect(literals.length).toBeGreaterThanOrEqual(6);
    expect(literals.every(match => !/[\r\n]/.test(match[2]))).toBe(true);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|TRUNCATE|GRANT|REVOKE)\s+(?:INTO\s+|FROM\s+|ON\s+)?public\./i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER|ALTER\s+TABLE|DISABLE\s+TRIGGER/i);
  });

  it.each(["lf", "crlf"])("passes captured-routine coverage, replay, denied-access and rollback with %s artifact bytes", (format) => {
    const output = execFileSync(process.execPath, ["scripts/test-history-count-contract.mjs", "--line-endings=" + format], {
      encoding: "utf8", windowsHide: true, timeout: 90_000,
    });
    expect(output).toContain("Artifact line endings: " + format);
    expect(output).toContain("PASS 21 isolated history count contract scenarios");
  }, 95_000);
});
