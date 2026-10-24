import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const caller = {
  accessToken: z.string().min(10).optional(),
  /** Signed session minted at cashier PIN sign-in. */
  cashierToken: z.string().min(10).optional(),
};

const startInput = z.object({
  ...caller,
  memberId: z.string().uuid().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  storeId: z.string().max(64).optional().nullable(),
});

const confirmInput = z.object({
  ...caller,
  id: z.string().uuid(),
  code: z.string().regex(/^\d{4,8}$/),
});

const configInput = z.object({
  accessToken: z.string().min(10),
  channel: z.enum(["email", "sms", "whatsapp"]),
  strict: z.boolean(),
  active: z.boolean(),
});

const listInput = z.object({ ...caller, limit: z.number().int().min(1).max(500).optional() });

/** Any signed-in till user: cashier session token or staff access token. */
async function requireStaff(data: { accessToken?: string; cashierToken?: string }) {
  const { verifyCashierSession } = await import("./pos-session.server");
  const cashier = data.cashierToken ? (await verifyCashierSession(data.cashierToken))?.username : null;
  if (cashier) return { name: cashier, isAdmin: false };
  if (data.accessToken) {
    const { verifyPosStaff } = await import("./secure-settings.server");
    const staff = await verifyPosStaff(data.accessToken);
    return { name: staff.userId, isAdmin: staff.isAdmin };
  }
  throw new Error("Not authorised");
}

/** Send a one-time code to a member on the configured channel. */
export const startMemberVerification = createServerFn({ method: "POST" })
  .validator((data: unknown) => startInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const staff = await requireStaff(data);
      const { startVerification } = await import("./verification.server");
      const started = await startVerification({
        memberId: data.memberId ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        storeId: data.storeId ?? null,
        sentBy: staff.name,
      });
      return { ok: true as const, ...started };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Check the code the member read back. */
export const confirmMemberVerification = createServerFn({ method: "POST" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) => {
    try {
      await requireStaff(data);
      const { confirmVerification } = await import("./verification.server");
      const verified = await confirmVerification(data.id, data.code);
      return verified
        ? { ok: true as const }
        : { ok: false as const, error: "That code does not match — try again" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Which channel is live, and whether verification is compulsory. */
export const getVerificationSettings = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object(caller).parse(data))
  .handler(async ({ data }) => {
    try {
      await requireStaff(data);
      const { readVerificationConfig } = await import("./verification.server");
      return { ok: true as const, config: await readVerificationConfig() };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Admins and managers choose the channel and the strict rule. */
export const saveVerificationSettings = createServerFn({ method: "POST" })
  .validator((data: unknown) => configInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const staff = await requireStaff(data);
      if (!staff.isAdmin) return { ok: false as const, error: "Admins only" };
      const { writeVerificationConfig } = await import("./verification.server");
      await writeVerificationConfig(
        { channel: data.channel, strict: data.strict, active: data.active },
        staff.name,
      );
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** The verification log, for the staff-facing audit screen. */
export const listMemberVerifications = createServerFn({ method: "POST" })
  .validator((data: unknown) => listInput.parse(data))
  .handler(async ({ data }) => {
    try {
      await requireStaff(data);
      const { listVerifications } = await import("./verification.server");
      return { ok: true as const, items: await listVerifications(data.limit ?? 200) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, items: [] };
    }
  });
