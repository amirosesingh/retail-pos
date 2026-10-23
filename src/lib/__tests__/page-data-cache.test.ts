import { describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ epoch: 1, mode: "online", url: "https://a.example" }));
vi.mock("../session-epoch", () => ({ sessionEpoch: () => context.epoch }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => context.mode }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: context.url }) }));
import { PAGE_DATA_CACHE, pageDataScope } from "../page-data-cache";
describe("page data cache isolation", () => {
  it("changes scope for account, permissions, session and database changes", () => {
    const user = { staffId: "a", role: "staff", permissions: { read: true } };
    const first = pageDataScope(user);
    expect(pageDataScope({ ...user })).toEqual(first);
    expect(pageDataScope({ ...user, staffId: "b" })).not.toEqual(first);
    expect(pageDataScope({ ...user, permissions: { read: false } })).not.toEqual(first);
    context.epoch++;
    expect(pageDataScope(user)).not.toEqual(first);
    const signedIn = pageDataScope(user);
    context.mode = "local";
    expect(pageDataScope(user)).not.toEqual(signedIn);
    expect(pageDataScope(null)).not.toEqual(pageDataScope(user));
    const oldDatabase = pageDataScope(user);
    context.url = "https://b.example";
    expect(pageDataScope(user)).not.toEqual(oldDatabase);
  });
  it("keeps a bounded memory cache and rechecks invalidated reports on mount", () => {
    expect(PAGE_DATA_CACHE).toEqual({ staleTime: 300_000, gcTime: 300_000, refetchOnMount: true });
  });
});
