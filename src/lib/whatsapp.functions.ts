import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const payload = z.object({
  /** Supabase access token of a signed-in supervisor/admin, when available. */
  accessToken: z.string().min(10).optional(),
  /** Signed terminal session token issued at cashier PIN sign-in. */
  terminalToken: z.string().min(10).optional(),
  phoneNumberId: z.string().max(40).optional(),
  /** digits only, international format */
  to: z.string().regex(/^\d{6,15}$/),
  body: z.string().min(1).max(3000),
});

/**
 * Sends a plain-text WhatsApp message through the Meta WhatsApp Cloud API.
 * The permanent access token lives server-side in the WHATSAPP_TOKEN secret.
 */
export const sendWhatsAppBill = createServerFn({ method: "POST" })
  .validator((data: unknown) => payload.parse(data))
  .handler(async ({ data }) => {
    // Only signed-in POS staff may send from the business account.
    const { verifyCashierSession } = await import("./pos-session.server");
    let caller = data.terminalToken ? (await verifyCashierSession(data.terminalToken))?.username : null;
    if (!caller && data.accessToken) {
      const { verifyPosStaff } = await import("./secure-settings.server");
      try {
        caller = (await verifyPosStaff(data.accessToken)).userId;
      } catch {
        caller = null;
      }
    }
    if (!caller) return { ok: false as const, error: "Not authorised" };

    const { readSecureSetting } = await import("./secure-settings.server");
    // Prefer the encrypted value saved in Settings, fall back to the secret.
    const token = (await readSecureSetting("whatsapp_token")) ?? process.env["WHATSAPP_TOKEN"];
    if (!token) {
      return { ok: false as const, error: "WhatsApp access token is not configured" };
    }
    const phoneNumberId =
      (await readSecureSetting("whatsapp_phone_number_id")) ?? data.phoneNumberId;
    if (!phoneNumberId) {
      return { ok: false as const, error: "WhatsApp phone number ID is not configured" };
    }
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: data.to,
          type: "text",
          text: { preview_url: false, body: data.body },
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      if (import.meta.env.DEV) console.error(`[whatsapp] send failed [${res.status}]`);
      return { ok: false as const, error: `WhatsApp delivery failed (${res.status})` };
    }
    return { ok: true as const, response: text.slice(0, 300) };
  });
