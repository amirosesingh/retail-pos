import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import type {Sale} from "@/core/types/pos-types";
import {completedReportBills,receiptAdjustmentLabel,reportSponsorshipStores} from "../report-display";
import {salesReconciliation} from "../sales-reconciliation";
const bill=(id:string,total:number,method:Sale["method"],extra:Partial<Sale>={}):Sale=>({id,receiptNo:id,storeId:"A",shiftId:"S",lines:[],subtotal:total,discount:0,tax:0,total,paid:total,change:0,method,memberId:null,pointsEarned:0,cashier:"Cashier",createdAt:"2026-10-24T12:00:00Z",...extra});
describe("report-only cohort and wording",()=>{
 it("retains collected and net equations with separate refund and nonpayment sponsorship",()=>{
  const cash=bill("cash",100,"cash",{roundingAdjustment:-1.5,roundingLabel:"Extra Discount"});
  const rows=[cash,bill("card",200,"card"),bill("bank",30,"bank_transfer"),bill("refund",20,"cash",{refunded:true}),cash];
  const completed=completedReportBills(rows);
  expect(completed).toHaveLength(3);
  expect(salesReconciliation(completed)).toMatchObject({collected:330,net:331.5,rounding:-1.5});
  expect(salesReconciliation(completed).collected+25).toBe(355);
  expect(rows.filter(row=>row.refunded).reduce((sum,row)=>sum+row.total,0)).toBe(20);
  expect(receiptAdjustmentLabel(rows)).toBe("Extra Discount");
 });
 it("uses only authorized report branches for all sponsorship, including an empty scope",()=>{
  expect(reportSponsorshipStores("all",["A","B"],["A"])).toEqual(["A"]);
  expect(reportSponsorshipStores("all",["A","B"],[])).toEqual([]);
  expect(reportSponsorshipStores("B",["A","B"],["A"])).toEqual([]);
 });
 it("uses generic receipt wording when saved adjustment labels differ",()=>{
  expect(receiptAdjustmentLabel([bill("a",10,"cash",{roundingAdjustment:-1,roundingLabel:"Extra Discount"}),bill("b",10,"cash",{roundingAdjustment:1,roundingLabel:"Rounding"})])).toBe("Receipt adjustments");
 });
 it("keeps refund history/export and whole-bill tender filters while summaries exclude refunds",()=>{
  const source=readFileSync("src/platforms/web/components/pos/PaymentsReport.tsx","utf8");
  expect(source).toContain("completedReportBills(rows)");
  expect(source).not.toContain("<TableHead>Status</TableHead>");
  expect(source).toMatch(/<ReportReceiptLink sale=\{s\} \/>[\s\S]{0,80}<Badge/);
  expect(source).toContain("for (const s of completedRows)");
  expect(source).toContain("...rows.map((s)");
  expect(source).toContain('s.refunded ? "Refunded" : "Completed"');
  expect(source).toContain('tendersOf(s).some((p) => tenderKey(p) === tender)');
  const workspace=readFileSync("src/platforms/web/components/pos/SalesReportWorkspace.tsx","utf8");
  expect(workspace).toContain("reportStoreIds: storeIds");
  const reports=readFileSync("src/routes/reports.sales.tsx","utf8");
  expect(reports).toContain("shared?.reportStoreIds");
  // These reporting changes do not add profit/cost data to the payment summary.
  expect(source).not.toContain("profitOf(");
 });
});
