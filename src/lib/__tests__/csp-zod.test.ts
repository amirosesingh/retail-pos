import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
afterEach(() => vi.unstubAllGlobals());
it("validates objects without dynamic code generation under strict CSP", () => {
  const forbidden = vi.fn(() => { throw new EvalError("CSP blocks dynamic code"); });
  vi.stubGlobal("Function", forbidden);
  const schema = z.object({ name: z.string().min(1), count: z.number().int().nonnegative() });
  expect(schema.safeParse({ name: "Item", count: 3 }).success).toBe(true);
  expect(schema.safeParse({ name: "", count: -1 }).success).toBe(false);
  expect(forbidden).not.toHaveBeenCalled();
});
