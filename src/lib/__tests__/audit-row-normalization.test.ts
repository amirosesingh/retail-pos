import {describe,expect,it} from "vitest";
import {auditDetails,normalizeCachedAuditRows} from "../audit-row-normalization";
import {describeLog} from "../audit-format";
describe("audit history input resilience",()=>{
 it("handles JSON null, arrays and malformed details without failing a history batch",()=>{
  for(const value of [null,"null","[]","broken",12]) expect(auditDetails(value)).toEqual({});
  expect(auditDetails('{"role":"admin"}')).toEqual({role:"admin"});
 });
 it("keeps readable cached rows when legacy fields are missing or malformed",()=>{
  const rows=normalizeCachedAuditRows([null,"bad",{id:"event",action:null,role:{role:"admin"},module:12,details:"null"}]);
  expect(rows).toHaveLength(1);
  expect(()=>describeLog(rows[0])).not.toThrow();
  expect(rows[0].action.toLowerCase()).toBe("recorded activity");
  expect(rows[0].role).toBe("unknown");
 });
 it("does not treat a corrupt non-array cache as iterable audit records",()=>{
  expect(normalizeCachedAuditRows({id:"event"})).toEqual([]);
 });
});
