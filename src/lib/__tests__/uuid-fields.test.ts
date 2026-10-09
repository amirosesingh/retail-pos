import { describe, expect, it } from "vitest";
import { normalizeUuidFields } from "../uuid-fields";
describe("UUID field normalization", () => {
 it("preserves identities and branch separation while normalizing casing", () => {
  const first = "A1234567-1234-4234-8234-123456789ABC";
  const second = "B1234567-1234-4234-8234-123456789ABC";
  expect(normalizeUuidFields({ id:first, store_id:second, code:first, token:first, lines:[{productId:first}] })).toEqual({id:first.toLowerCase(),store_id:second.toLowerCase(),code:first,token:first,lines:[{productId:first.toLowerCase()}]});
  expect(normalizeUuidFields({id:"LC1", store_id:"LC2"})).toEqual({id:"LC1",store_id:"LC2"});
 });
});
