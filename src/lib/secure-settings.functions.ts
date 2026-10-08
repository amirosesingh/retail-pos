import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const KEYS = [
  "whatsapp_token",
  "whatsapp_phone_number_id",
  "bank_account_number",
  "bank_account_name",
  "bank_name",
  "update_feed_token",
  "integration_api_key",
  "local_db_password",
  "twilio_account_sid",
  "twilio_auth_token",
  "twilio_from",
  "sendgrid_api_key",
  "email_from",
] as const;

const saveInput = z.object({
  accessToken: z.string().min(10),
  key: z.enum(KEYS),
  value: z.string().min(1).max(4000),
});

const keyInput = z.object({
  accessToken: z.string().min(10),
  key: z.enum(KEYS),
});

const listInput = z.object({ accessToken: z.string().min(10) });

/** Encrypt and store a sensitive configuration value. Admins/managers only. */
export const saveSecureSetting = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyPosStaff, writeSecureSetting } = await import("./secure-settings.server");
    try {
      const caller = await verifyPosStaff(data.accessToken);
      if (caller.role !== "admin") return { ok: false as const, error: "Admins only" };
      await writeSecureSetting(data.key, data.value, caller.userId);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

/** Masked hints so the UI can show that a value is set without revealing it. */
export const listSecureSettings = createServerFn({ method: "POST" })
  .validator((data: unknown) => listInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyPosStaff, listSecureSettingHints } = await import("./secure-settings.server");
    try {
      const caller = await verifyPosStaff(data.accessToken);
      if (caller.role !== "admin") return { ok: false as const, error: "Admins only", items: [] };
      return { ok: true as const, items: await listSecureSettingHints() };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, items: [] };
    }
  });

/** Forget a stored credential. */
export const clearSecureSetting = createServerFn({ method: "POST" })
  .validator((data: unknown) => keyInput.parse(data))
  .handler(async ({ data }) => {
    const { verifyPosStaff, removeSecureSetting } = await import("./secure-settings.server");
    try {
      const caller = await verifyPosStaff(data.accessToken);
      if (caller.role !== "admin") return { ok: false as const, error: "Admins only" };
      await removeSecureSetting(data.key);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });