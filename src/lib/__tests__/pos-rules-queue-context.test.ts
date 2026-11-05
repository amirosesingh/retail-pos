import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";
import { isTransientRulesSaveFailure } from "../pos-rules-failure";

const mock = vi.hoisted(() => ({ upsert: vi.fn(), cache: vi.fn() }));
vi.mock("@/core/api/db-router", () => ({ dbRouter: { upsert: mock.upsert } }));
vi.mock("../pos-rules-cache", () => ({ writeCachedRules: mock.cache }));
vi.mock("../pos-rules-log", () => ({ logRules: vi.fn() }));
import { queueRulesSave } from "../pos-rules-offline";

const input = () => ({ terminalId: "terminal", branchId: "branch", rules: DEFAULT_POS_RULES,
  patch: { allow_branch_shift_sharing: true }, expectedVersion: 7 });
const changed = () => { throw Object.assign(new Error("The active rules context changed"), { code: "RULES_CONTEXT_CHANGED" }); };
beforeEach(() => { mock.upsert.mockReset().mockResolvedValue("local"); mock.cache.mockReset().mockResolvedValue(undefined); });
it("requires a live authority check for new context-bound offline writes", async () => {
  await expect(queueRulesSave({ ...input(), cacheScope: "verified-context", shiftSharingAvailable: true })).rejects.toThrow("current rules editor context");
  expect(mock.upsert).not.toHaveBeenCalled(); expect(mock.cache).not.toHaveBeenCalled();
});
it("refuses changed permission/profile/branch before writing anything", async () => {
  await expect(queueRulesSave({ ...input(), cacheScope: "verified-context", assertContext: changed })).rejects.toMatchObject({ code: "RULES_CONTEXT_CHANGED" });
  expect(mock.upsert).not.toHaveBeenCalled(); expect(mock.cache).not.toHaveBeenCalled();
});
it("does not write a new cache or report acceptance when scope changes during native storage", async () => {
  let current = true;
  mock.upsert.mockImplementation(async () => { current = false; return "local"; });
  await expect(queueRulesSave({ ...input(), cacheScope: "verified-context", assertContext: () => { if (!current) changed(); } })).rejects.toMatchObject({ code: "RULES_CONTEXT_CHANGED" });
  expect(mock.upsert).toHaveBeenCalledOnce(); expect(mock.cache).not.toHaveBeenCalled();
  expect(mock.upsert.mock.calls[0][1]).toMatchObject({ store_id: "branch", base_version: 7 });
});
it("persists same-context pending capability and preserves existing caller compatibility", async () => {
  const check = vi.fn();
  await queueRulesSave({ ...input(), cacheScope: "verified-context", shiftSharingAvailable: true, assertContext: check });
  expect(check).toHaveBeenCalledTimes(3);
  expect(mock.cache).toHaveBeenCalledWith(expect.objectContaining({ cacheScope: "verified-context", shiftSharingAvailable: true, pending: true }));
  await expect(queueRulesSave(input())).resolves.toMatchObject({ target: "local" });
});
it.each([
  new Error("permission denied"), new Error("Not signed in"), new Error("missing data"),
  { status: 403, message: "fetch failed" }, { code: "RULES_CONTEXT_CHANGED", message: "network changed" },
  { code: "42501", message: "network fetch refused" },
  { statusCode: 401, message: "fetch failed" }, { code: "EPRIVILEGE", message: "network policy refused" },
])("does not queue a refusal or unknown error: %j", error => {
  expect(isTransientRulesSaveFailure(error)).toBe(false);
});
it.each(["fetch failed", "ECONNRESET", "network timeout"])("recognizes a genuine transient failure: %s", message => {
  expect(isTransientRulesSaveFailure(new Error(message))).toBe(true);
});
