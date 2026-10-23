import { describe, expect, it } from "vitest";
import { approvalIdentity } from "../approval-identity";

describe("approval credential identity", () => {
  it("lets the verifier identify a phone token even when the receiver can self-approve", () => {
    expect(approvalIdentity(true, "receiver", "receiver")).toEqual({
      authorizerId: "", selfAuthorization: false,
    });
  });
  it("does not submit a stale ID after switching from PIN to soft token", () => {
    expect(approvalIdentity(true, "previous-approver")).toEqual({
      authorizerId: "", selfAuthorization: false,
    });
  });
  it("preserves signed-in PIN confirmation and explicit PIN identity", () => {
    expect(approvalIdentity(false, "other", "receiver")).toEqual({
      authorizerId: "receiver", selfAuthorization: true,
    });
    expect(approvalIdentity(false, " manager ")).toEqual({
      authorizerId: "manager", selfAuthorization: false,
    });
  });
});
