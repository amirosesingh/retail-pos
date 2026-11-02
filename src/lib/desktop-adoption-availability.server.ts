/** Temporary verification failure, never evidence that an account was denied. */
export class DesktopAdoptionUnavailableError extends Error {
  readonly status = 503;
  constructor() { super("Sign-in verification is temporarily unavailable. Please try again."); }
}

type AdoptionAccount = {
  user_id: string;
  full_name?: string | null;
  role: string | null;
  role_slug: string | null;
  permissions: Record<string, unknown> | null;
  store_id: string | null;
  is_active: boolean;
};

const nullableText = (value: unknown) => value === null || typeof value === "string";

/** Opt-in read for adoption only; an unreadable result cannot prove revocation. */
export async function readAdoptionAccounts(read: () => Promise<Response>): Promise<AdoptionAccount[]> {
  try {
    const response = await read();
    if (!response.ok) throw new DesktopAdoptionUnavailableError();
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) throw new DesktopAdoptionUnavailableError();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          typeof row.user_id !== "string" || !row.user_id.trim() ||
          typeof row.is_active !== "boolean" ||
          !nullableText(row.role) || !nullableText(row.role_slug) || !nullableText(row.store_id) ||
          (row.full_name !== undefined && !nullableText(row.full_name)) ||
          (row.permissions !== null && (typeof row.permissions !== "object" || Array.isArray(row.permissions)))) {
        throw new DesktopAdoptionUnavailableError();
      }
    }
    return rows as AdoptionAccount[];
  } catch {
    throw new DesktopAdoptionUnavailableError();
  }
}
