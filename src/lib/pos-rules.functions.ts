import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const callerInput = z.object({
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  cashierToken: z.string().min(10).optional(),
  sessionToken: z.string().min(10).optional(),
  storeId: z.string().max(64).optional(),
});

const ruleValue = z.union([z.boolean(), z.number()]);

const saveInput = z.object({
  accessToken: z.string().min(10),
  storeId: z.string().max(64).optional(),
  patch: z.record(z.string(), ruleValue),
  expectedVersion: z.number().int().nonnegative(),
});

const pinInput = z.object({
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  managerId: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4,6}$/),
  action: z.string().min(1).max(64),
  ruleKey: z.string().max(64).optional(),
  requestedBy: z.string().max(120).optional(),
  storeId: z.string().max(64).optional(),
  terminalId: z.string().max(64).optional(),
  detail: z.string().max(400).optional(),
});

const closeInput = z.object({
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  storeId: z.string().max(64).optional(),
  countedCash: z.number().nullable().optional(),
  variance: z.number().nullable().optional(),
  grantToken: z.string().optional(),
});

/** Any signed-in till user: a Supabase staff account or a cashier session. */
async function assertCaller(data: { accessToken?: string; terminalToken?: string }) {
  if (data.accessToken) {
    const { verifyPosStaff } = await import("./secure-settings.server");
    const caller = await verifyPosStaff(data.accessToken);
    return {
      id: caller.userId,
      role: caller.role,
      isSupervisor: caller.isAdmin,
      canManageRules:
        caller.role === "admin" ||
        caller.role === "manager" ||
        caller.permissions["can_access_pos_settings"] === true,
    };
  }
  if (data.terminalToken) {
    const { verifyCashierSession } = await import("./pos-session.server");
    const session = verifyCashierSession(data.terminalToken);
    if (session)
      return {
        id: session.id,
        role: "cashier",
        isSupervisor: false,
        canManageRules: false,
      };
  }
  throw new Error("Not signed in");
}

/**
 * Effective, database-backed rule set for the caller's own branch.
 *
 * The branch comes from the caller's proof, not from what the caller asks
 * for, so a till registered to one branch cannot read another branch's rules.
 */
export const getPosRules = createServerFn({ method: "POST" })
  .validator((data: unknown) => callerInput.parse(data))
  .handler(async ({ data }) => {
    const { loadRulesResult } = await import("./pos-rules.server");
    const anySignIn =
      data.accessToken || data.terminalToken || data.cashierToken || data.sessionToken;
    // Before sign-in there is no branch identity, so the answer is explicitly
    // the global chain — the caller marks it as unverified, never as this
    // branch's saved configuration.
    if (!anySignIn) {
      const base = await loadRulesResult("");
      return {
        ok: true as const,
        anonymous: true as const,
        identified: false as const,
        branchId: "",
        backend: base.source,
        backendError: base.error ?? "",
        failure: base.failure,
        revision: base.revision,
        fetchedAt: base.fetchedAt,
        rowVersion: base.rowVersion,
        updatedAt: base.updatedAt,
        updatedBy: base.updatedBy,
        scope: "",
        rules: base.rules,
      };
    }
    const { resolveRulesAccess } = await import("./pos-rules-access.server");
    const access = await resolveRulesAccess(data);
    if (!access.ok) {
      const base = await loadRulesResult("");
      return {
        ok: false as const,
        anonymous: true as const,
        identified: false as const,
        branchId: "",
        error: access.error,
        code: access.code,
        backend: base.source,
        backendError: base.error ?? "",
        failure: access.code === "FORBIDDEN" ? ("permission" as const) : base.failure,
        revision: base.revision,
        fetchedAt: base.fetchedAt,
        rowVersion: base.rowVersion,
        updatedAt: base.updatedAt,
        updatedBy: base.updatedBy,
        scope: "",
        rules: base.rules,
      };
    }
    const loaded = await loadRulesResult(access.branchId);
    return {
      ok: true as const,
      anonymous: false as const,
      identified: true as const,
      branchId: access.branchId,
      backend: loaded.source,
      backendError: loaded.error ?? "",
      failure: loaded.failure,
      revision: loaded.revision,
      fetchedAt: loaded.fetchedAt,
      rowVersion: loaded.rowVersion,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
      scope: access.branchId,
      rules: loaded.rules,
    };
  });

/** Explicit POS-settings permission; the database re-checks permission and branch visibility. */
export const savePosRules = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveInput.parse(data))
  .handler(async ({ data }) => {
    const { saveRules } = await import("./pos-rules.server");
    try {
      const caller = await assertCaller(data);
      if (!caller.canManageRules)
        return { ok: false as const, error: "POS settings permission is required" };
      const { resolveRulesAccess } = await import("./pos-rules-access.server");
      const access = await resolveRulesAccess(data);
      if (!access.ok) return { ok: false as const, error: access.error, code: access.code };
      const rules = await saveRules(
        access.branchId,
        data.patch as never,
        data.accessToken,
        data.expectedVersion,
      );
      return { ok: true as const, snapshot: rules, rules: rules.rules };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/**
 * Manager PIN check. The PIN is compared inside the database — never in the
 * browser — and a short-lived signed grant is returned for the action.
 */
export const verifyManagerPin = createServerFn({ method: "POST" })
  .validator((data: unknown) => pinInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyManagerPinInDb, signOverrideGrant } = await import("./pos-rules.server");
    const { throttleStatus, throttleFail, throttleReset, minutesLeft } =
      await import("./pin-throttle.server");
    // Guessing is stopped in the server, not the keypad: the count follows the
    // manager ID, so trying from another till does not reset it.
    const throttleKey = `manager:${data.managerId.toLowerCase()}`;
    const state = await throttleStatus(throttleKey);
    if (state.locked) {
      return {
        ok: false as const,
        error: `Too many wrong PINs — try again in ${minutesLeft(state)} minute(s)`,
      };
    }
    try {
      // The audit entry is written by the database inside the same routine that
      // checks the PIN, so an override record can never be forged separately.
      const manager = await verifyManagerPinInDb(data.managerId, data.pin, {
        action: data.action,
        ruleKey: data.ruleKey ?? null,
        requestedBy: data.requestedBy ?? null,
        storeId: data.storeId ?? null,
        terminalId: data.terminalId ?? null,
        detail: data.detail ?? null,
      });
      if (!manager) {
        const after = await throttleFail(throttleKey);
        return {
          ok: false as const,
          error: after.locked
            ? `Too many wrong PINs — try again in ${minutesLeft(after)} minute(s)`
            : "Invalid manager ID or PIN",
        };
      }
      await throttleReset(throttleKey);
      return {
        ok: true as const,
        manager: { id: manager.userId, name: manager.name, role: manager.role },
        grantToken: signOverrideGrant({
          action: data.action,
          approvedBy: manager.userId,
          role: manager.role,
          storeId: data.storeId ?? "",
          binding: "legacy",
        }),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/**
 * Server-side gate for closing a shift: held tickets and the closing count
 * are checked against the database rules, not the browser's copy.
 */

export const assertShiftClosable = createServerFn({ method: "POST" })
  .validator((data: unknown) => closeInput.parse(data))
  .handler(async ({ data }) => {
    const { loadRulesResult, heldOrderCountResult, verifyOverrideGrant } =
      await import("./pos-rules.server");
    try {
      await assertCaller(data);
      // The branch is taken from the caller's own proof where it carries one,
      // so a till can never be closed against another branch's rules.
      const { resolveRulesAccess } = await import("./pos-rules-access.server");
      const access = await resolveRulesAccess({ ...data, storeId: data.storeId ?? "" });
      if (!access.ok) {
        return {
          ok: false as const,
          code: "ERROR" as const,
          held: 0,
          error: access.error,
        };
      }
      const loaded = await loadRulesResult(access.branchId);
      const rules = loaded.rules;

      const override = verifyOverrideGrant(data.grantToken, "shift_close", {
        storeId: access.branchId,
      });
      if (rules.block_shift_close_on_hold && !override) {
        const heldRes = await heldOrderCountResult(access.branchId);
        // If the count itself could not be read, the shift stays open rather
        // than closing over bills nobody could see.
        if (!heldRes.ok) {
          return {
            ok: false as const,
            code: "ERROR" as const,
            held: 0,
            error:
              "Held bills could not be checked right now, so the shift was not closed. Try again, or ask a manager to approve the closure.",
          };
        }
        const held = heldRes.count;
        if (held > 0) {
          return {
            ok: false as const,
            code: "HELD_BILLS" as const,
            held,
            error: `Shift cannot be closed. You have ${held} held bill(s) pending. Please settle or cancel them first.`,
          };
        }
      }
      if (
        (rules.require_daily_sales_for_shift_close || rules.require_counted_cash_on_close) &&
        (data.countedCash === null ||
          data.countedCash === undefined ||
          !Number.isFinite(data.countedCash) ||
          data.countedCash < 0)
      ) {
        return {
          ok: false as const,
          code: "NO_COUNT" as const,
          held: 0,
          error: "Enter the counted cash in the drawer before closing the shift.",
        };
      }
      // Large shortage or overage: a manager must have approved the close.
      if (rules.require_manager_pin_on_variance && !override) {
        const limit = Math.abs(Number(rules.variance_pin_threshold) || 0);
        const variance = Number(data.variance ?? 0);
        if (Number.isFinite(variance) && Math.abs(variance) > limit) {
          return {
            ok: false as const,
            code: "VARIANCE" as const,
            held: 0,
            error: `The drawer is out by more than ${limit.toFixed(2)}. A manager must approve this closure.`,
          };
        }
      }
      return { ok: true as const, code: "OK" as const, held: 0, error: "" };
    } catch (e) {
      return { ok: false as const, code: "ERROR" as const, held: 0, error: (e as Error).message };
    }
  });
