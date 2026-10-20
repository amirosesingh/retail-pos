/** Operator identity is established by interactive login, never an Auth event.
 * This is a UI lifecycle binding; server-side credentials still authorize requests.
 */
const KEY = "pos.session.operatorAuthId";
export type AuthIdentity = { id: string; email?: string };
export function isOperatorIdentity(user: AuthIdentity | null | undefined): boolean {
  return Boolean(user?.id && !user.email?.trim().toLowerCase().endsWith("@pos.local"));
}
export function matchesOperatorIdentity(user: AuthIdentity | null | undefined, operatorId: string | null): boolean {
  return isOperatorIdentity(user) && Boolean(operatorId && user?.id === operatorId);
}
export function readOperatorIdentity(): string | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage.getItem(KEY); }
  catch { return null; }
}
export function saveOperatorIdentity(user: AuthIdentity): void {
  if (!isOperatorIdentity(user)) throw new Error("A terminal account cannot sign in as an operator.");
  try { window.sessionStorage.setItem(KEY, user.id); } catch { /* in-memory login remains usable */ }
}
export function clearOperatorIdentity(): void {
  try { window.sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
