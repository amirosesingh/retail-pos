import { createServerFn } from "@tanstack/react-start";
import { missedBillInput } from "./missed-bill-input";

/** Historical entry is always online-authoritative; never ordinary checkout/outbox. */
export const addMissedBill = createServerFn({ method: "POST" })
  .validator((value: unknown) => missedBillInput.parse(value))
  .handler(async ({ data }) => {
    try {
      const [{ verifyRelayCaller, serviceRest }, { resolveRelayScope }] = await Promise.all([
        import("@/core/api/pos-relay.server"), import("@/core/api/relay-policy.server"),
      ]);
      const scope = await resolveRelayScope(await verifyRelayCaller(data));
      if (scope.role !== "admin" && scope.roleSlug !== "admin")
        return { ok: false as const, error: "Only an administrator can add a missed bill.", canEdit: true };
      if (scope.storeId && scope.storeId.toLowerCase() !== data.storeId.toLowerCase())
        return { ok: false as const, error: "The missed bill must belong to this terminal/account branch.", canEdit: true };
      if (!scope.staffUserId) return { ok: false as const, error: "A verified administrator account is required.", canEdit: true };
      const { sessionToken: _session, accessToken: _access, terminalToken: _terminal, cashierToken: _cashier, ...entry } = data;
      const response = await serviceRest("rpc/pos_admin_add_missed_bill", {
        method: "POST", body: JSON.stringify({ p_entry: entry, p_actor_id: scope.staffUserId, p_terminal: scope.terminalId ?? null }),
      });
      if (!response.ok) {
        const text = await response.text();
        const error = /PGRST202|could not find.*function|does not exist/i.test(text)
          ? "The missed-bill database upgrade is not installed. Ask the administrator to apply the reviewed migration."
          : text.slice(0, 500);
        let code = "";
        try { code = String(JSON.parse(text).code ?? ""); } catch { /* Unknown responses may represent an ambiguous commit. */ }
        return { ok: false as const, error, canEdit: code === "PGRST202" || code === "P0001" || code === "42501" || /^(22|23)[0-9A-Z]{3}$/.test(code) };
      }
      const result = await response.json() as { saleId: string; receiptNo: string; sale: unknown; items: unknown[] };
      return { ok: true as const, saleId: result.saleId, receiptNo: result.receiptNo,
        receiptJson: JSON.stringify({ sale: result.sale, items: result.items }) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 400) : "Could not save the missed bill. Connect and retry with the same entry." };
    }
  });
