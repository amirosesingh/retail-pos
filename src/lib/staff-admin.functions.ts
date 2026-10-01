import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RelayScope } from "@/core/api/relay-policy.server";
import type { CallerProof } from "./privileged-caller.server";

const proofFields = {
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
};

const managedStaffRow = z.object({
  id: z.string(),
  auth_user_id: z.string().nullable(),
  user_id: z.string(),
  full_name: z.string(),
  email: z.string(),
  role: z.string(),
  role_slug: z.string().nullable(),
  store_id: z.string().nullable(),
  is_active: z.boolean(),
  permissions: z.record(z.string(), z.boolean()).nullable(),
  pin_length: z.number().nullable(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
});

async function requireStaffManager(data: CallerProof) {
  const { requireCallerScope } = await import("./privileged-caller.server");
  return requireCallerScope(data, { permission: "can_manage_staff" });
}

/** Staff administration grid, including PIN metadata but never a PIN hash. */
export const listManagedStaffAccounts = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object(proofFields).parse(data))
  .handler(async ({ data }) => {
    try {
      await requireStaffManager(data);
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest(
        "app_users?select=id,auth_user_id,user_id,full_name,email,role,role_slug,store_id,is_active,permissions,pin_length,last_login_at,created_at&order=full_name.asc",
      );
      if (!response.ok) throw new Error("Staff accounts could not be loaded.");
      return { ok: true as const, rows: z.array(managedStaffRow).parse(await response.json()) };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message, rows: [] };
    }
  });

export const setManagedStaffPermissions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        ...proofFields,
        userId: z.string().min(2).max(160),
        permissions: z.record(z.string(), z.boolean()),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const actor = await requireStaffManager(data);
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest(
        `app_users?user_id=eq.${encodeURIComponent(data.userId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ permissions: data.permissions }),
        },
      );
      if (!response.ok) throw new Error((await response.text()).slice(0, 300));
      await audit({
        actor,
        actionType: "staff.permissions_updated",
        entityAffected: "app_users",
        entityId: data.userId,
        newValue: { permissions: data.permissions },
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  });

/**
 * Records a supervisor action in the permanent edit history. Written with the
 * internal service key so the entry cannot be altered or skipped by a till.
 */
async function audit(entry: {
  actor: RelayScope;
  actionType: string;
  entityAffected: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  const { writeSystemAudit } = await import("./system-audit.server");
  await writeSystemAudit({
    actorId: entry.actor.staffUserId ?? entry.actor.label,
    actorName: entry.actor.actorName ?? entry.actor.label,
    actorRole: entry.actor.roleSlug ?? entry.actor.role ?? entry.actor.kind,
    actionType: entry.actionType,
    entityAffected: entry.entityAffected,
    entityId: entry.entityId,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
  });
}

/** Create or update a staff member and the account behind them. */
export const saveStaffAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        ...proofFields,
        displayName: z.string().trim().min(1).max(120),
        username: z.string().min(2).max(160),
        pin: z.string().min(4).max(32).optional(),
        password: z.string().min(8).max(200).optional(),
        branchId: z.string().max(60).nullable().optional(),
        roleSlug: z.string().min(2).max(60),
        baseRole: z.enum(["admin", "manager", "staff"]),
        active: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const actor = await requireStaffManager(data);
      const mod = await import("./staff-admin.server");
      await mod.provisionStaffAccount({
        displayName: data.displayName,
        username: data.username,
        pin: data.pin ?? "",
        password: data.password ?? "",
        branchId: data.branchId ?? null,
        roleSlug: data.roleSlug,
        baseRole: data.baseRole,
        active: data.active,
      });
      await audit({
        actor,
        actionType: "staff.account_created",
        entityAffected: "app_users",
        entityId: data.username,
        newValue: {
          displayName: data.displayName,
          roleSlug: data.roleSlug,
          baseRole: data.baseRole,
          branchId: data.branchId ?? null,
          active: data.active,
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

/** Switch a staff account on or off. */
export const setStaffAccountActive = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        ...proofFields,
        username: z.string().min(2).max(160),
        active: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const actor = await requireStaffManager(data);
      const mod = await import("./staff-admin.server");
      await mod.setStaffActive(data.username, data.active);
      await audit({
        actor,
        actionType: data.active ? "staff.account_enabled" : "staff.account_disabled",
        entityAffected: "app_users",
        entityId: data.username,
        newValue: { active: data.active },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

/**
 * Public by necessity: a till has no session yet when someone taps their PIN.
 * The PIN itself is the credential and is checked against the stored hash
 * before anything is created or changed.
 */
export const preparePinSignIn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        username: z.string().min(2).max(120),
        pin: z.string().min(4).max(32),
      })
      .parse(data),
  )
  .handler(
    async ({ data }): Promise<{ ok: true; email: string } | { ok: false; error: string }> => {
      try {
        const mod = await import("./staff-admin.server");
        return await mod.ensurePinAccount(data.username, data.pin);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

/** The sign-in grid for a till: active staff who hold a PIN. */
export const listTerminalStaffAccounts = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        storeId: z.string().max(60).nullable().optional(),
        terminalToken: z.string().min(10).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
      const caller = await verifyRelayCaller({ terminalToken: data.terminalToken });
      if (caller.kind !== "terminal" || !caller.terminalId)
        return { ok: false as const, error: "An active terminal is required", staff: [] };
      if (data.storeId && caller.storeId && data.storeId !== caller.storeId)
        return { ok: false as const, error: "This terminal belongs to another branch", staff: [] };
      const mod = await import("./staff-admin.server");
      const staff = await mod.listTerminalStaff(caller.storeId ?? null);
      return { ok: true as const, staff };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, staff: [] };
    }
  });

/** One-off catch-up for tills that still have old cashier-only records. */
export const migrateCashiersToAccounts = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object(proofFields).parse(data))
  .handler(
    async ({ data }): Promise<{ ok: true; migrated: number } | { ok: false; error: string }> => {
      try {
        await requireStaffManager(data);
        const mod = await import("./staff-admin.server");
        const res = await mod.migrateLegacyCashiers();
        return { ok: true, ...res };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

/** Update profile fields and optionally replace the credential. */
export const updateStaffAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        ...proofFields,
        username: z.string().min(2).max(160),
        displayName: z.string().trim().min(1).max(120),
        branchId: z.string().max(60).nullable(),
        roleSlug: z.string().min(2).max(60),
        baseRole: z.enum(["admin", "manager", "staff"]),
        active: z.boolean(),
        credential: z.string().max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const actor = await requireStaffManager(data);
      const mod = await import("./staff-admin.server");
      const before = await mod.readStaffSnapshot(data.username);
      await mod.updateStaffProfile(data);
      await audit({
        actor,
        actionType: "staff.account_updated",
        entityAffected: "app_users",
        entityId: data.username,
        oldValue: before,
        newValue: {
          displayName: data.displayName,
          roleSlug: data.roleSlug,
          baseRole: data.baseRole,
          branchId: data.branchId,
          active: data.active,
          credentialChanged: Boolean(data.credential),
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

/** Permanently remove an inactive account after server-side safety checks. */
export const deleteStaffAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        ...proofFields,
        username: z.string().min(2).max(160),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const actor = await requireStaffManager(data);
      const mod = await import("./staff-admin.server");
      const removed = await mod.readStaffSnapshot(data.username);
      await mod.permanentlyDeleteStaff(data.username, {
        accessToken: data.accessToken,
        staffUserId: actor.staffUserId,
      });
      await audit({
        actor,
        actionType: "staff.account_deleted",
        entityAffected: "app_users",
        entityId: data.username,
        oldValue: removed,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
