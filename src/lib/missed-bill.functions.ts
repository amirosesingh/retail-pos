import { createServerFn } from "@tanstack/react-start";
import { missedBillCashiersInput, missedBillInput, type MissedBillCashier } from "./missed-bill-input";
import { isOperatorIdentity } from "./operator-auth-identity";

/** Original attribution uses current authoritative accounts, never legacy local duty rows. */
export const listMissedBillCashiers = createServerFn({ method: "POST" })
  .validator((value: unknown) => missedBillCashiersInput.parse(value))
  .handler(async ({ data }) => {
    try {
      const [{ requireCallerScope }, { serviceRest }] = await Promise.all([
        import("./privileged-caller.server"), import("@/core/api/pos-relay.server"),
      ]);
      const scope = await requireCallerScope(data);
      if ((scope.role !== "admin" && scope.roleSlug !== "admin") || !scope.staffUserId)
        throw new Error("Only an administrator can load original cashiers for a missed bill.");
      if (scope.storeId && scope.storeId.toLowerCase() !== data.storeId.toLowerCase())
        throw new Error("The missed bill must belong to this terminal/account branch.");
      const branchQuery = new URLSearchParams({ select: "id", id: `eq.${data.storeId}`, is_active: "eq.true", deleted_at: "is.null", limit: "1" });
      const branch = await serviceRest(`stores?${branchQuery}`);
      if (!branch.ok) throw new Error("The original branch could not be checked. Please retry.");
      const branches: unknown = await branch.json();
      if (!Array.isArray(branches) || branches.length !== 1) throw new Error("Select an active branch.");
      const rows: MissedBillCashier[] = [];
      const seen = new Set<string>();
      // PostgREST quoted literals keep a branch name from becoming filter syntax.
      const quotedBranch = JSON.stringify(data.storeId);
      for (let offset = 0; ; offset += 200) {
        const query = new URLSearchParams({
          select: "user_id,full_name,store_id,email", is_active: "eq.true",
          or: `(store_id.is.null,store_id.eq."",store_id.eq.${quotedBranch})`,
          order: "user_id.asc", limit: "200", offset: String(offset),
        });
        const response = await serviceRest(`app_users?${query}`);
        if (!response.ok) throw new Error("Original cashiers could not be loaded. Please retry.");
        const page: unknown = await response.json();
        if (!Array.isArray(page)) throw new Error("The staff service returned an invalid response. Please retry.");
        const before = seen.size;
        for (const value of page) {
          const row = value as { user_id?: unknown; full_name?: unknown; store_id?: unknown; email?: unknown };
          if (!row || typeof row.user_id !== "string" || typeof row.full_name !== "string" || typeof row.email !== "string" || (row.store_id !== null && typeof row.store_id !== "string"))
            throw new Error("The staff service returned an invalid account. Please retry.");
          // Progress follows every source row, including excluded machine accounts.
          // A page of terminals must not hide human staff on a subsequent page.
          if (seen.has(row.user_id)) continue;
          seen.add(row.user_id);
          const branchId = typeof row.store_id === "string" ? row.store_id : "";
          if (branchId && branchId.toLowerCase() !== data.storeId.toLowerCase()) continue;
          if (!isOperatorIdentity({ id: row.user_id, email: row.email })) continue;
          rows.push({ userId: row.user_id, name: row.full_name || row.user_id });
        }
        if (page.length < 200) break;
        if (seen.size === before) throw new Error("The staff service did not advance its account list. Please retry.");
      }
      rows.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
      return { ok: true as const, rows };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 400) : "Original cashiers could not be loaded. Please retry.", rows: [] as MissedBillCashier[] };
    }
  });

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
      const { sessionToken: _session, accessToken: _access, terminalToken: _terminal, cashierToken: _cashier, deviceBindingProof: _binding, ...entry } = data;
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
