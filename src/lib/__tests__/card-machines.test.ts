import { describe, expect, it } from "vitest";
import type { PaymentAccount } from "@/core/types/pos-types";
import { availableCardMachines, cardMachineLabel } from "../card-machines";
const account = (patch: Partial<PaymentAccount>): PaymentAccount => ({ id: "machine", name: "Front counter", type: "card_machine", active: true, ...patch });
describe("card machine choices", () => {
  it("only offers active named machines for this branch", () => {
    const accounts = [account({}), account({ id: "other", storeIds: ["branch-2"] }),
      account({ id: "disabled", active: false }), account({ id: "blank", name: " " }),
      account({ id: "bank", type: "bank_account" }), account({ id: "local", storeIds: ["branch-1"] })];
    expect(availableCardMachines(accounts, "branch-1").map(machine => machine.id)).toEqual(["machine", "local"]);
    expect(availableCardMachines(undefined, "branch-1")).toEqual([]);
  });
  it("preserves the machine name alongside its bank for reconciliation", () => {
    expect(cardMachineLabel(account({ bankName: "Bank A" }))).toBe("Front counter · Bank A");
    expect(cardMachineLabel(account({}))).toBe("Front counter");
  });
});
