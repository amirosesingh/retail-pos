import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {mayCloseShift}=require("../../../electron/db/shift-close-policy.cjs");
const session=require("../../../electron/admin-session.cjs");
const privilege=require("../../../electron/ipc-privilege.cjs");
afterEach(()=>session.clear());
it("allows handover only with the saved setting and close permission",()=>{
 const input={differentOperator:true,differentTerminal:false,isAdmin:false,canManageOthers:false,canClose:true,allowHandover:false};
 expect(mayCloseShift(input)).toBe(false);
 expect(mayCloseShift({...input,allowHandover:true})).toBe(true);
 expect(mayCloseShift({...input,allowHandover:true,canClose:false})).toBe(false);
 expect(mayCloseShift({...input,isAdmin:true})).toBe(true);
 expect(mayCloseShift({...input,canManageOthers:true})).toBe(true);
});
it("shows admin expected totals without granting cashier visibility",()=>{
 session.grant("admin","admin",{},"pos","branch");
 expect(privilege.allowed("business:shift-expected",["shift"])).toBe(true);
 expect(privilege.allowed("business:shift-reconciliation-view",["shift"])).toBe(true);
 session.grant("staff","cashier",{can_close_shift:true},"pos","branch");
 expect(privilege.allowed("business:shift-expected",["shift"])).toBe(false);
});
