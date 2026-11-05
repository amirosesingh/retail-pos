import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readDispatchProof } from "../transfer-dispatch-result";

// Execute the current reviewed migration and its real trigger fixture, rather
// than freezing a hand-written copy of the expected JSON response in this test.
const fixtureUrl = new URL("../../../scripts/fixtures/transfer-dispatch-fixture.mjs", import.meta.url).href;
const fixture = await import(fixtureUrl) as {
  fixtureSql: string; migration: string; ids: { child: string; parent: string; product: string };
  seedSql: (options?: { childQuantity?: number }) => string; nativeIdentity: string;
  dispatchSql: (quantity: number, child: string, native: boolean) => string;
};
const db = new PGlite();
beforeAll(async () => {
  // Git stores LF; Windows may check out this older migration as CRLF while
  // the current canonical schema is LF. Compile both fixture inputs with the
  // same newlines so the reviewed migration's exact definition anchor matches.
  await db.exec(fixture.fixtureSql.replaceAll("\r\n", "\n"));
  const lifecycle = async () => (await db.query<{ definition: string }>(
    "SELECT pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure) definition",
  )).rows[0].definition;
  const before = await lifecycle();
  await db.exec(fixture.migration.replaceAll("\r\n", "\n"));
  const after = await lifecycle();
  const extension = "\n  IF private.transfer_dispatch_completes_request(OLD,NEW) THEN RETURN NEW; END IF;\n";
  expect(after).toContain(extension);
  expect(after.replace(extension, "")).toBe(before);
});
afterAll(async () => { await db.close(); });

describe("real PostgreSQL dispatch proof consumed by the client", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])("matches the client protocol (native=%s, uppercase product UUID=%s)", async (native, uppercase) => {
    await db.exec(fixture.seedSql()); if (native) await db.exec(fixture.nativeIdentity);
    const wantedProduct = uppercase ? fixture.ids.product.toUpperCase() : fixture.ids.product;
    const sql = fixture.dispatchSql(2, fixture.ids.child, native).replaceAll(fixture.ids.product, wantedProduct);
    const response = (await db.query<{ proof: unknown }>(sql)).rows[0].proof;
    const expected = { id: fixture.ids.child, fromStoreId: "A", toStoreId: "B", sourceRequestId: fixture.ids.parent };
    const accepted = readDispatchProof(response, expected, [{ productId: wantedProduct, qty: 2 }]);
    expect(accepted).toMatchObject({ version: 1, dispatched_by: "Authorized Dispatcher", request_closed: true,
      request_fulfilment: "partial", lines: [{ product_id: fixture.ids.product, qty: 2, source_stock: 8 }] });
    expect(accepted?.dispatched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(accepted?.request_closed_at).toBe(accepted?.dispatched_at);
    const replay = (await db.query<{ proof: unknown }>(sql)).rows[0].proof;
    expect(readDispatchProof(replay, expected, [{ productId: wantedProduct, qty: 2 }])).toMatchObject({ replayed: true });
  });
  it("rejects a stale explicit approval ceiling before a dispatch or proof can be committed", async () => {
    await db.exec(fixture.seedSql({ childQuantity: 1 }));
    await expect(db.query(fixture.dispatchSql(2, fixture.ids.child, false))).rejects.toMatchObject({ code: "23514", message: "TRANSFER_DISPATCH_CONFLICT" });
    expect((await db.query<{ quantity: number }>(`SELECT (stock_by_store->>'A')::int quantity FROM products WHERE id='${fixture.ids.product}'`)).rows[0].quantity).toBe(10);
    expect((await db.query<{ status: string }>(`SELECT status FROM stock_transfers WHERE id='${fixture.ids.child}'`)).rows[0].status).toBe("approved");
  });
});
