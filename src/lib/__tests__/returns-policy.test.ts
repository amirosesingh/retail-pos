import { describe, expect, it } from "vitest";
import { exchangePolicyError, CUSTOMER_REFUNDS_ALLOWED } from "../returns-policy";
import type { CartLine } from "@/core/types/pos-types";
const replacement = { productId:"new",name:"Replacement",qty:1,price:100,taxRate:0,discount:0 } as CartLine;
describe("company exchange policy", () => {
 it("allows equal and higher-value replacements only", () => {
  expect(CUSTOMER_REFUNDS_ALLOWED).toBe(false);
  expect(exchangePolicyError([replacement],0,"original")).toBeNull();
  expect(exchangePolicyError([replacement],25,"original")).toBeNull();
  expect(exchangePolicyError([replacement],-0.01,"original")).toContain("equal or higher");
 });
 it("blocks return-only exchanges even when their total is zero", () => {
  expect(exchangePolicyError([{...replacement,qty:-1,credit:true}],0,"original")).toContain("replacement");
 });
});
