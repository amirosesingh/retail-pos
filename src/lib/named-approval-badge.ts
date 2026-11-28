import { hasStaffSession } from "@/core/api/sync-relay";
import { APP_RESUME_EVENT } from "@/core/activation/connection-health";
import { subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { subscribeExternalClientReset } from "@/integrations/supabase/external-client";
import { isTerminalApp } from "@/platform-config/platform";
import { supabaseConfig } from "./external-supabase-config";
import { subscribeNamedApprovalWake } from "./named-approval-wake";
import { readCredentials } from "./pos-credentials";
import { posFetch } from "./server-origin";
import { centralAuthAccessToken, subscribeCentralAuthSession } from "./session-presence";

const pollMs = 60_000;
const requestId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** The bell and open Approvals page share the recipient topic. Every hint still
 * requires a server-authorized read of the person's pending assignments. */
export function subscribeNamedApprovalBadge(setApprovalIds: (ids: string[]) => void): () => void {
  let stopped = false;
  let disabled = false;
  let generation = 0;
  let pending = false;
  let read: AbortController | undefined;
  let projectWithWake: string | undefined;
  let offWake: (() => void) | undefined;
  const currentProject = () => {
    try { return supabaseConfig().url; } catch { return undefined; }
  };

  const refresh = () => {
    if (stopped || disabled || !hasStaffSession() || navigator.onLine === false || document.visibilityState === "hidden") return;
    if (read) { pending = true; return; }
    const accessToken = centralAuthAccessToken();
    const projectUrl = currentProject();
    if (!accessToken || !projectUrl) return;
    const started = generation;
    const controller = new AbortController();
    read = controller;
    const current = () => !stopped && started === generation && accessToken === centralAuthAccessToken() &&
      projectUrl === currentProject() && hasStaffSession();
    void (async () => {
      try {
        const { terminalToken, deviceBindingProof } = await readCredentials();
        if (!current()) return;
        if (isTerminalApp() && (!terminalToken || !deviceBindingProof)) { setApprovalIds([]); return; }
        const response = await posFetch("/api/v1/pos/activity-preferences", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "named_approval_badge", projectUrl, accessToken, terminalToken, deviceBindingProof }),
          redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        const result = await response.json();
        if (!current()) return;
        if (!response.ok || result?.ok !== true || !Array.isArray(result.approvalIds) ||
            result.approvalIds.length > 10 || result.approvalIds.some((id: unknown) => typeof id !== "string" || !requestId.test(id)) ||
            (result.approvalIds.length > 0 && result.project !== projectUrl)) {
          setApprovalIds([]);
          return;
        }
        setApprovalIds([...new Set<string>(result.approvalIds)]);
        if (result.enabled === false) disabled = true;
        const next = result.project === projectUrl ? projectUrl : undefined;
        if (next !== projectWithWake) {
          offWake?.();
          projectWithWake = next;
          offWake = next ? subscribeNamedApprovalWake(next, refresh, () => {}) : undefined;
        }
      } catch {
        if (current()) setApprovalIds([]);
      } finally {
        if (read === controller) {
          read = undefined;
          if (pending) { pending = false; refresh(); }
        }
      }
    })();
  };

  const reset = () => {
    generation++;
    disabled = false;
    pending = false;
    read?.abort();
    read = undefined;
    offWake?.();
    offWake = undefined;
    projectWithWake = undefined;
    setApprovalIds([]);
    refresh();
  };
  const offSession = subscribeCentralAuthSession(reset);
  const offProject = subscribeExternalClientReset(reset);
  const offTerminal = subscribeTerminalConfig(reset);
  const events = ["focus", "online", APP_RESUME_EVENT];
  for (const event of events) window.addEventListener(event, refresh);
  document.addEventListener("visibilitychange", refresh);
  const timer = window.setInterval(refresh, pollMs);
  refresh();
  return () => {
    stopped = true;
    read?.abort();
    offWake?.();
    offSession();
    offProject();
    offTerminal();
    for (const event of events) window.removeEventListener(event, refresh);
    document.removeEventListener("visibilitychange", refresh);
    window.clearInterval(timer);
  };
}
