import { expect, it, vi } from "vitest";
vi.mock("@/lib/external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://test.invalid", anonKey: "test" }), runtimeEnvValue: () => "test-service-key" }));
vi.mock("@/core/api/relay-policy.server", () => ({ safeAuthorizeRelayOp: async (op: unknown) => ({ ok: true, op }), canCrossBranches: (scope: { isSupervisor?: boolean; branchRestricted?: boolean }) => scope.isSupervisor && !scope.branchRestricted }));
import { runRelayOp } from "@/core/api/pos-relay.server";
import type { RelayScope } from "@/core/api/relay-policy.server";

it.each(["sales", "sale_items", "payment_transactions"])("never overwrites an existing %s row on insert/upsert retry", async table => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST"
    ? new Response(null, { status: 204 }) : Response.json([{ id: "same-stable-id", store_id: "branch-a" }]));
  vi.stubGlobal("fetch", fetch);
  try {
    for (const kind of ["insert", "upsert"] as const) {
      expect(await runRelayOp({ kind, table, rows: [{ id: "same-stable-id" }] }, { storeId: "branch-a" } as RelayScope)).toEqual({ ok: true });
      const request = [...fetch.mock.calls].reverse().find(call => call[1]?.method === "POST") as unknown as [unknown, RequestInit];
      expect(new Headers(request[1].headers).get("Prefer")).toBe("return=minimal,resolution=ignore-duplicates");
    }
  } finally { vi.unstubAllGlobals(); }
});

it.each(["branch-b", null])("does not credit an ignored parent with stored branch %s", async store => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST"
    ? new Response(null, { status: 204 }) : Response.json(store ? [{ id: "foreign-sale", store_id: store }] : []));
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await runRelayOp({ kind: "insert", table: "sales", rows: [{ id: "foreign-sale", store_id: "branch-a" }] }, { storeId: "branch-a" } as RelayScope)).toMatchObject({ ok: false, code: "STORE_FORBIDDEN" });
  } finally { vi.unstubAllGlobals(); }
});

it("preserves SQL Server UUID casing aliases on an unchanged sale retry", async () => {
  const id = "a611a328-2217-4d77-944a-5f6a637d123b";
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST"
    ? new Response(null, { status: 204 }) : Response.json([{ id, store_id: id }]));
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await runRelayOp({ kind: "upsert", table: "sales", rows: [{ id: id.toUpperCase() }] }, { storeId: id.toUpperCase() } as RelayScope)).toEqual({ ok: true });
  } finally { vi.unstubAllGlobals(); }
});

it("keeps ordinary editable catalogue upserts working", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await runRelayOp({ kind: "upsert", table: "products", rows: [{ id: "product" }] }, {} as RelayScope)).toEqual({ ok: true });
    const request = fetch.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(new Headers(request[1].headers).get("Prefer")).toBe("return=minimal,resolution=merge-duplicates");
  } finally { vi.unstubAllGlobals(); }
});
