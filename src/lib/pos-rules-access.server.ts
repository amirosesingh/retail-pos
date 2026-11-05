/**
 * Who is asking for the register rules, and for which branch.
 *
 * There is no new sign-in mechanism here: the caller is proved with the same
 * relay verification every other till call uses (session record, cashier
 * session, activation token or staff bearer), and the branch that proof
 * carries is the authority. A till registered to one branch can therefore
 * never read another branch's rules by naming it in the request.
 */
import type { RelayCaller } from "@/core/api/pos-relay.server";

export type RulesAccess =
  | { ok: true; branchId: string; caller: RelayCaller }
  | { ok: false; status: number; error: string; code: "IDENTITY" | "FORBIDDEN" };

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function resolveRulesAccess(input: {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  deviceBindingProof?: string;
  accessToken?: string;
  storeId?: string;
}): Promise<RulesAccess> {
  const requested = trim(input.storeId);
  let caller: RelayCaller;
  try {
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    caller = await verifyRelayCaller(input);
  } catch (e) {
    return { ok: false, status: 401, error: (e as Error).message, code: "IDENTITY" };
  }

  const bound = trim(caller.storeId);
  // A proof bound to a branch answers only for that branch. An unbound proof
  // (head office / group administrator) may ask for the branch it names.
  if (bound) {
    if (requested && requested !== bound)
      return {
        ok: false,
        status: 403,
        error: "This terminal is not registered to that branch.",
        code: "FORBIDDEN",
      };
    return { ok: true, branchId: bound, caller };
  }
  return { ok: true, branchId: requested, caller };
}
