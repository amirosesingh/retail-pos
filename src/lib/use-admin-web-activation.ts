import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "./pos-auth";
import { isTerminalApp } from "@/platform-config/platform";
import { adminActivationRequest, readAdminBrowserProof, writeAdminBrowserProof } from "./admin-web-activation";

/** Observe only enrolled admin browsers; existing admin sign-in is unchanged. */
export function useAdminWebActivation() {
  const { isAdmin, authUserId, logout } = useAuth();
  useEffect(() => {
    if (!isAdmin || !authUserId || isTerminalApp()) return;
    let cancelled = false;
    let running = false;
    const check = async () => {
      if (running || cancelled) return;
      const proof = readAdminBrowserProof(authUserId);
      if (!proof) return;
      running = true;
      try {
        const result = await adminActivationRequest<{ok:boolean}>("heartbeat", {p_id:proof.id,p_proof:proof.proof});
        if (!cancelled && !result.ok && readAdminBrowserProof(authUserId)?.id === proof.id) {
          writeAdminBrowserProof(authUserId,null);
          toast.error("This admin browser activation was revoked. Please sign in again.");
          await logout();
        }
      } catch { /* Network failures do not imply revocation. Retry on reconnect. */ }
      finally { running = false; }
    };
    void check();
    const timer = setInterval(() => void check(),60_000);
    const wake = () => void check();
    window.addEventListener("online",wake);
    window.addEventListener("focus",wake);
    window.addEventListener("pos:admin-web-activation",wake);
    return () => { cancelled=true; clearInterval(timer); window.removeEventListener("online",wake); window.removeEventListener("focus",wake); window.removeEventListener("pos:admin-web-activation",wake); };
  },[isAdmin,authUserId,logout]);
}
