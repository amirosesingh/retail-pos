/**
 * Member verification gateway (server only).
 *
 * Holds the active channel (email / SMS / WhatsApp), the encrypted provider
 * credentials and the one-time codes themselves. Codes are stored as a SHA-256
 * hash, so nothing readable is ever kept in the database.
 */
import { createHash, randomInt } from "node:crypto";
import { serviceRest } from "@/core/api/pos-relay.server";
import { readSecureSetting } from "./secure-settings.server";

export type VerifyChannel = "email" | "sms" | "whatsapp";

export type VerificationConfig = {
  channel: VerifyChannel;
  strict: boolean;
  active: boolean;
};

const PROVIDER = "verification";

export const DEFAULT_CONFIG: VerificationConfig = {
  channel: "whatsapp",
  strict: false,
  active: true,
};

const hash = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");

export async function readVerificationConfig(): Promise<VerificationConfig> {
  try {
    const res = await serviceRest(
      `integration_settings?select=verification_channel,strict_verification,is_active&provider_name=eq.${PROVIDER}&limit=1`,
    );
    if (!res.ok) return DEFAULT_CONFIG;
    const rows = (await res.json()) as {
      verification_channel?: string;
      strict_verification?: boolean;
      is_active?: boolean;
    }[];
    const row = rows[0];
    if (!row) return DEFAULT_CONFIG;
    return {
      channel: (row.verification_channel as VerifyChannel) ?? "whatsapp",
      strict: row.strict_verification === true,
      active: row.is_active !== false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeVerificationConfig(patch: VerificationConfig, updatedBy: string) {
  const res = await serviceRest("integration_settings?on_conflict=provider_name", {
    method: "POST",
    body: JSON.stringify([
      {
        provider_name: PROVIDER,
        verification_channel: patch.channel,
        strict_verification: patch.strict,
        is_active: patch.active,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
    ]),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300));
}

/* --------------------------- sending the code --------------------------- */

async function sendWhatsApp(to: string, body: string) {
  const token = (await readSecureSetting("whatsapp_token")) ?? process.env["WHATSAPP_TOKEN"];
  const phoneNumberId = await readSecureSetting("whatsapp_phone_number_id");
  if (!token || !phoneNumberId) throw new Error("WhatsApp credentials are not configured");
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}`);
}

async function sendSms(to: string, body: string) {
  const sid = await readSecureSetting("twilio_account_sid");
  const token = await readSecureSetting("twilio_auth_token");
  const from = await readSecureSetting("twilio_from");
  if (!sid || !token || !from) throw new Error("SMS gateway credentials are not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) throw new Error(`SMS gateway ${res.status}`);
}

async function sendEmail(to: string, body: string) {
  const apiKey = await readSecureSetting("sendgrid_api_key");
  const from = (await readSecureSetting("email_from")) ?? "no-reply@example.com";
  if (!apiKey) throw new Error("Email credentials are not configured");
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: "Your verification code",
      content: [{ type: "text/plain", value: body }],
    }),
  });
  if (!res.ok) throw new Error(`Email provider ${res.status}`);
}

/* ------------------------------ the flow -------------------------------- */

async function memberContact(id: string): Promise<{ phone: string | null; email: string | null }> {
  const res = await serviceRest(
    `members?id=eq.${encodeURIComponent(id)}&select=phone,email&limit=1`,
  );
  if (!res.ok) throw new Error("Could not read the member contact");
  const row = ((await res.json()) as { phone?: string | null; email?: string | null }[])[0];
  if (!row) throw new Error("Member no longer exists");
  return { phone: row.phone ?? null, email: row.email ?? null };
}

export async function startVerification(input: {
  memberId?: string | null;
  phone?: string | null;
  email?: string | null;
  storeId?: string | null;
  sentBy: string;
}): Promise<{ id: string; channel: VerifyChannel }> {
  if (input.memberId) input = { ...input, ...(await memberContact(input.memberId)) };
  const config = await readVerificationConfig();
  const channel = config.channel;
  const target = channel === "email" ? input.email : input.phone;
  if (!target) {
    throw new Error(
      channel === "email"
        ? "An email address is needed to send the code"
        : "A phone number is needed to send the code",
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const res = await serviceRest("member_verifications", {
    method: "POST",
    body: JSON.stringify([
      {
        member_id: input.memberId ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        channel,
        otp_code: hash(code),
        status: "pending",
        sent_by: input.sentBy,
        store_id: input.storeId ?? null,
        expires_at: expiresAt,
      },
    ]),
    prefer: "return=representation",
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300));
  const rows = (await res.json()) as { id: string }[];
  const id = rows[0]?.id;
  if (!id) throw new Error("Could not start the verification");

  const body = `Your verification code is ${code}. It expires in 10 minutes.`;
  const digits = (target ?? "").replace(/\D/g, "");
  try {
    if (channel === "whatsapp") await sendWhatsApp(digits, body);
    else if (channel === "sms") await sendSms(target, body);
    else await sendEmail(target, body);
  } catch (e) {
    await serviceRest(`member_verifications?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed" }),
      prefer: "return=minimal",
    });
    throw e;
  }
  return { id, channel };
}

export async function confirmVerification(id: string, code: string): Promise<boolean> {
  const res = await serviceRest(
    `member_verifications?select=id,member_id,phone,email,channel,otp_code,expires_at,status,attempts&id=eq.${id}&limit=1`,
  );
  if (!res.ok) throw new Error("Could not read the verification");
  const row = ((await res.json()) as Record<string, unknown>[])[0];
  if (!row) throw new Error("That verification is no longer available");
  if (row["member_id"]) {
    const current = await memberContact(String(row["member_id"]));
    const key = row["channel"] === "email" ? "email" : "phone";
    const normalize = (value: unknown) =>
      key === "email"
        ? String(value ?? "")
            .trim()
            .toLowerCase()
        : String(value ?? "").replace(/\D/g, "");
    if (!normalize(current[key]) || normalize(current[key]) !== normalize(row[key]))
      throw new Error("Member contact changed — send a new code");
  }
  if (row["status"] === "verified") return true;
  if (Number(row["attempts"] ?? 0) >= 5) throw new Error("Too many attempts — send a new code");
  if (new Date(String(row["expires_at"])).getTime() < Date.now()) {
    throw new Error("That code has expired — send a new one");
  }

  const ok = row["otp_code"] === hash(code);
  await serviceRest(`member_verifications?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(
      ok
        ? { status: "verified", verified_at: new Date().toISOString() }
        : { attempts: Number(row["attempts"] ?? 0) + 1 },
    ),
    prefer: "return=minimal",
  });

  if (ok && row["member_id"]) {
    await serviceRest(`members?id=eq.${String(row["member_id"])}`, {
      method: "PATCH",
      body: JSON.stringify({
        is_verified: true,
        verified_at: new Date().toISOString(),
        verified_channel: row["channel"],
      }),
      prefer: "return=minimal",
    });
  }
  return ok;
}

/** Staff-facing log, newest first. The code hash is never returned. */
export type VerificationLogRow = {
  id: string;
  member_id: string | null;
  phone: string | null;
  email: string | null;
  channel: string;
  status: string;
  attempts: number;
  sent_by: string | null;
  store_id: string | null;
  created_at: string;
  verified_at: string | null;
};

export async function listVerifications(limit = 200): Promise<VerificationLogRow[]> {
  const res = await serviceRest(
    `member_verifications?select=id,member_id,phone,email,channel,status,attempts,sent_by,store_id,created_at,verified_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 500)}`,
  );
  if (!res.ok) return [];
  return (await res.json()) as VerificationLogRow[];
}
