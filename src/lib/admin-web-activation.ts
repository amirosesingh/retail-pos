import { supabaseExternal } from "@/integrations/supabase/external-client";
import { supabaseConfig } from "./external-supabase-config";
import { isTerminalApp } from "@/platform-config/platform";

export type AdminActivation = { id: string; adminUserId: string; adminEmail: string; deviceName: string; createdAt: string; activatedAt: string | null; lastSeenAt: string | null; revokedAt: string | null; expiresAt: string };
export type AdminBrowserProof = { id: string; proof: string; pending?: boolean };
const key = (userId: string) => `pos.admin-web:${supabaseConfig().url}:${userId}`;
export async function adminActivationRequest<T>(action: string, args: Record<string, string> = {}): Promise<T> {
  if (isTerminalApp()) throw new Error("Admin web activation is available only in the web portal.");
  const { data, error } = await supabaseExternal.rpc("admin_web_activation" as never, { p_action: action, ...args } as never);
  if (error) {
    if (error.code === "PGRST202") {
      throw new Error("Admin activation is not installed or the cloud API schema cache is out of date. Apply 20261009065040_admin_web_activation_cloud_only.sql to this portal's Supabase project, then run NOTIFY pgrst, 'reload schema'; and click Refresh.");
    }
    throw new Error(error.message);
  }
  return data as T;
}
export function readAdminBrowserProof(userId: string): AdminBrowserProof | null {
  if (isTerminalApp()) return null;
  try { const parsed = JSON.parse(localStorage.getItem(key(userId)) || "null"); return parsed?.id && parsed?.proof && !parsed.pending ? parsed : null; }
  catch { return null; }
}
export function writeAdminBrowserProof(userId: string, value: AdminBrowserProof | null) {
  if (isTerminalApp()) throw new Error("Web portal only");
  if (value) localStorage.setItem(key(userId), JSON.stringify(value));
  else localStorage.removeItem(key(userId));
  window.dispatchEvent(new Event("pos:admin-web-activation"));
}
