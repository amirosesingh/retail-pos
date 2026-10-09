import { describe, expect, it } from "vitest";
import { redeemedPoints } from "../points-redemption";
describe("loyalty redemption", () => {
 it("uses 100 points per currency unit", () => {
  expect(redeemedPoints({method:"points",paid:12.34})).toBe(1234);
 });
 it("counts points tenders even when cash is the headline and never double counts", () => {
  expect(redeemedPoints({method:"cash",paid:20,payments:[{method:"cash",amount:15},{method:"points",amount:5}]})).toBe(500);
  expect(redeemedPoints({method:"points",paid:10,payments:[{method:"points",amount:10}]})).toBe(1000);
 });
 it("does not treat ordinary payments or negative refund tenders as redemption", () => {
  expect(redeemedPoints({method:"cash",paid:20})).toBe(0);
  expect(redeemedPoints({method:"points",paid:-10})).toBe(0);
 });
});
