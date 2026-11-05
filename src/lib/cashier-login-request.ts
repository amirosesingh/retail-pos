/** Includes PIN verification and secure session creation, not just a connectivity probe. */
export const CASHIER_LOGIN_TIMEOUT_MS = 30_000;

/** Bound both headers and body; do not retry a credential submission. */
export async function requestCashierLogin<T>(url: string, data: Record<string, unknown>): Promise<{ status: number; payload: T | null }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CASHIER_LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: abort.signal, body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => null) as T | null;
    return { status: response.status, payload };
  } finally { clearTimeout(timer); }
}
