import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/desktop-pos-session", () => ({ ensureDesktopPosSession: mocks.verify }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => ({ query: mocks.query }) }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => "local" }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {}, authenticatedExternalClientSnapshot: vi.fn() }));
vi.mock("@/lib/session-presence", () => ({ hasCentralAuthSession: () => false }));
vi.mock("@/lib/row-versions", () => ({ noteVersions: vi.fn() }));
import { routedQuery } from "@/core/api/db-query";
import { bumpSessionEpoch } from "../session-epoch";

beforeEach(() => {
  bumpSessionEpoch();
  mocks.verify.mockReset();
  mocks.query.mockReset().mockResolvedValue({ ok: true, rows: [{ id: "transfer-1" }] });
  vi.stubGlobal("window", { sqlAdmin: { adoptSession: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

it("holds the first transfer read until native session verification finishes", async () => {
  let finish!: (value: { ok: boolean }) => void;
  mocks.verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const result = routedQuery("stock_transfers", { limit: 50 });
  await vi.waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
  expect(mocks.query).not.toHaveBeenCalled();
  finish({ ok: true });
  expect(await result).toEqual([{ id: "transfer-1" }]);
  expect(mocks.query).toHaveBeenCalledWith("stock_transfers", { limit: 50 });
});

it("does not send a report query when native session verification is rejected", async () => {
  mocks.verify.mockResolvedValue({ ok: false, error: "Session revoked" });
  await expect(routedQuery("sales", { limit: 50 })).rejects.toMatchObject({ code: "EPRIVILEGE", message: "Session revoked" });
  expect(mocks.query).not.toHaveBeenCalled();
});
