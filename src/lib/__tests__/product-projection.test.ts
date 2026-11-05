import { expect, it, vi } from "vitest";
import { createProductProjectionReader } from "../product-projection";
type Result = { data: { id: string }[] | null; error: { code: string; message: string } | null };
it.each([
  { code: "42703", message: "column products.catalogue_store_ids does not exist" },
  { code: "PGRST204", message: "Could not find the 'catalogue_store_ids' column of 'products' in the schema cache" },
])("retries an older product schema without only the additive projection and remembers it for the remaining pages", async error => {
  const read = vi.fn<(columns: string) => Promise<Result>>().mockResolvedValueOnce({ data: null, error }).mockResolvedValue({ data: [{ id: "old-product" }], error: null });
  const project = createProductProjectionReader("id,name,owner_store_id,catalogue_store_ids,stock_by_store");
  expect(await project(read)).toEqual({ data: [{ id: "old-product" }], error: null });
  expect(read.mock.calls.map(([columns]) => columns)).toEqual(["id,name,owner_store_id,catalogue_store_ids,stock_by_store", "id,name,owner_store_id,stock_by_store"]);
  await project(read);
  expect(read.mock.calls.at(-1)?.[0]).toBe("id,name,owner_store_id,stock_by_store");
});
it.each([
  { code: "42501", message: "permission denied for column catalogue_store_ids" },
  { code: "42703", message: "column products.owner_store_id does not exist" },
  { code: "PGRST204", message: "Could not find the 'owner_store_id' column of 'products' in the schema cache" },
  { code: "08P01", message: "Connection closed while reading catalogue_store_ids" },
])("preserves permission, connectivity and unrelated schema failures without downgrading", async error => {
  const read = vi.fn(async (): Promise<Result> => ({ data: null, error }));
  const result = await createProductProjectionReader("id,catalogue_store_ids")(read);
  expect(result.error).toBe(error); expect(read).toHaveBeenCalledOnce();
});
it("does not swallow an authorization refusal on the compatibility retry", async () => {
  const denied = { code: "42501", message: "permission denied for table products" };
  const read = vi.fn<() => Promise<Result>>().mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column products.catalogue_store_ids does not exist" } }).mockResolvedValueOnce({ data: null, error: denied });
  expect((await createProductProjectionReader("id,catalogue_store_ids")(read)).error).toBe(denied);
  expect(read).toHaveBeenCalledTimes(2);
});
