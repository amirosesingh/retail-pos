/**
 * Deep central-database inventory. Calls the read-only
 * `schema_inventory_deep()` helper in the central project through the service
 * relay. When that helper is not installed the caller degrades to the shallow
 * PostgREST description document and says so on screen.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type CentralInventoryResult =
  | {
      ok: true;
      /** JSON payload — deserialised by the caller. */
      inventoryJson: string;
      mode: "deep" | "legacy";
      warning?: string;
    }
  | { ok: false; error: string; reason: CentralInventoryFailure };

export type CentralInventoryFailure = "not_installed" | "not_permitted" | "unavailable";

export function classifyCentralInventoryError(error: string): CentralInventoryFailure {
  const value = error.toLowerCase();
  if (value.includes("pgrst202") || value.includes("schema_inventory_deep")) {
    return "not_installed";
  }
  if (/http (401|403)|permission denied|42501/.test(value)) return "not_permitted";
  return "unavailable";
}

const callerProof = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});

export const fetchCentralInventory = createServerFn({ method: "POST" })
  .validator((input: unknown) => callerProof.parse(input))
  .handler(async ({ data }): Promise<CentralInventoryResult> => {
    const { requireCallerScope } = await import("./privileged-caller.server");
    try {
      await requireCallerScope(data, { permission: "can_manage_sync_backup" });
    } catch (error) {
      return { ok: false, error: (error as Error).message, reason: "not_permitted" };
    }
    const { hasServiceKey, runRelayRead } = await import("@/core/api/pos-relay.server");
    if (!hasServiceKey()) {
      return {
        ok: false,
        error:
          "The hosted POS backend is missing its privileged central-database credential. Configure the server deployment before retrying.",
        reason: "unavailable",
      };
    }
    const res = await runRelayRead({ kind: "cloudInventory" });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.error ??
          "The deep inventory helper is not installed in the central database (schema_inventory_deep).",
        reason: classifyCentralInventoryError(
          res.error ?? "schema_inventory_deep is not installed",
        ),
      };
    }
    return {
      ok: true,
      inventoryJson: JSON.stringify(res.row ?? {}),
      mode: res.inventoryMode ?? "deep",
      ...(res.inventoryWarning ? { warning: res.inventoryWarning } : {}),
    };
  });
