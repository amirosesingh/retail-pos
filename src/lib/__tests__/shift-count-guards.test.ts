/**
 * Drawer-count guards, checked against the canonical central schema.
 *
 * These two routines run with elevated rights, so the branch check and the
 * amount checks have to live in the database function itself — a screen-level
 * check protects nothing here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/schema.sql"), "utf8");

const bodyOf = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(0);
  const end = sql.indexOf("END $$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
};

const BRANCH_GUARD =
  "IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION 'That shift belongs to another branch.'; END IF;";

describe("recount cannot reach another branch", () => {
  it("refuses a shift the user's branch cannot see", () => {
    expect(bodyOf("shift_recount_submit")).toContain(BRANCH_GUARD);
  });

  it("uses the very same wording as the first cash count", () => {
    expect(bodyOf("shift_cash_count_submit")).toContain(BRANCH_GUARD);
  });

  it("checks the branch before any row is written or reconciled", () => {
    const body = bodyOf("shift_recount_submit");
    const guard = body.indexOf(BRANCH_GUARD);
    expect(guard).toBeGreaterThan(0);
    // A recount permission alone must not carry a staff member past this line.
    expect(body.indexOf("has_perm('can_shift_cash_recount')")).toBeLessThan(guard);
    expect(body.indexOf("INSERT INTO public.shift_cash_counts")).toBeGreaterThan(guard);
    expect(body.indexOf("public.shift_log_event")).toBeGreaterThan(guard);
    expect(body.indexOf("public.shift_reconcile_now")).toBeGreaterThan(guard);
  });
});

describe("card and digital totals cannot be negative", () => {
  for (const fn of ["shift_cash_count_submit", "shift_recount_submit"]) {
    it(`${fn} rejects a negative card total`, () => {
      expect(bodyOf(fn)).toContain(
        "IF p_card IS NOT NULL AND p_card < 0 THEN RAISE EXCEPTION 'The card total counted cannot be negative.'; END IF;",
      );
    });

    it(`${fn} rejects a negative digital total`, () => {
      expect(bodyOf(fn)).toContain(
        "IF p_digital IS NOT NULL AND p_digital < 0 THEN RAISE EXCEPTION 'The digital total counted cannot be negative.'; END IF;",
      );
    });

    it(`${fn} still accepts a tender that was not counted at all`, () => {
      const body = bodyOf(fn);
      // The IS NOT NULL wording is what keeps null (= not counted), zero and
      // any positive figure acceptable.
      expect(body).toContain("p_card IS NOT NULL AND p_card < 0");
      expect(body).toContain("p_digital IS NOT NULL AND p_digital < 0");
      expect(body).not.toContain("p_card IS NULL OR p_card < 0");
      expect(body).not.toContain("p_digital IS NULL OR p_digital < 0");
      expect(body).not.toContain("p_card <= 0");
      expect(body).not.toContain("p_digital <= 0");
    });

    it(`${fn} keeps the cash check intact and checks amounts before writing`, () => {
      const body = bodyOf(fn);
      expect(body).toContain("p_cash IS NULL OR p_cash < 0");
      const lastGuard = Math.max(
        body.indexOf("p_card IS NOT NULL"),
        body.indexOf("p_digital IS NOT NULL"),
      );
      expect(body.indexOf("INSERT INTO public.shift_cash_counts")).toBeGreaterThan(lastGuard);
      expect(body.indexOf("public.shift_reconcile_now")).toBeGreaterThan(lastGuard);
    });
  }
});

describe("variance alert idempotency", () => {
  it("keeps a full unique reconciliation index for the existing ON CONFLICT target", () => {
    expect(sql).toContain(
      "ON public.shift_variance_alerts (reconciliation_id);",
    );
    expect(sql).not.toContain(
      "ON public.shift_variance_alerts (reconciliation_id) WHERE reconciliation_id IS NOT NULL;",
    );
  });
});
