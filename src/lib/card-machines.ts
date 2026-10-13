import type { PaymentAccount } from "@/core/types/pos-types";
import { sameBranchId } from "./branch-id";

export const availableCardMachines = (accounts: PaymentAccount[] | undefined, storeId: string) =>
  (accounts ?? []).filter(
    (account) =>
      account.active &&
      account.type === "card_machine" &&
      account.name.trim() &&
      (!account.storeIds?.length || account.storeIds.some((id) => sameBranchId(id, storeId))),
  );

export const cardMachineLabel = (account: PaymentAccount) =>
  [account.name.trim(), account.bankName?.trim()].filter(Boolean).join(" · ");
