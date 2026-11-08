import { RealtimeClient } from "@supabase/supabase-js";
import { readTerminalConfig, subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { APP_RESUME_EVENT } from "@/core/activation/connection-health";
import { hasStaffSession } from "@/core/api/sync-relay";
import { externalClientSnapshot, subscribeExternalClientReset } from "@/integrations/supabase/external-client";
import { platformName } from "@/platform-config/platform";
import { sameBranchId } from "./branch-id";
import { supabaseConfig } from "./external-supabase-config";
import { TERMINAL_EMAIL_DOMAIN } from "./internal-domains";
import { cashierTokenSync, readCredentials, sessionTokenSync, subscribeCredentialChanges } from "./pos-credentials";
import { createSerialChannelReplacer } from "./realtime-channel-replacer";
import { sessionEpoch } from "./session-epoch";
import { hasSignedInIdentity, subscribeCentralAuthSession } from "./session-presence";
import { verifySession } from "./session-verify-client";

type WakeTable = "authorization_requests" | "activity_events";
const listeners = new Set<{ branchId: string; table: WakeTable; wake: () => void }>();
const sockets = createSerialChannelReplacer<RealtimeClient | null>({
  remove: async socket => {
    if (!socket) return;
    // Close the transport before waiting for channel cleanup on sign-out.
    try { await socket.disconnect(); } finally { await socket.removeAllChannels(); }
  },
});

function readScope() {
  const cashierToken = cashierTokenSync();
  if (!cashierToken || !hasSignedInIdentity() || hasStaffSession() || navigator.onLine === false) return null;
  const config = readTerminalConfig();
  if (!config) return null;
  const terminalId = config.tokenId.trim();
  const branchId = config.locationId.trim();
  if (!terminalId || !branchId || (config.deviceUse && config.deviceUse !== "operations") ||
      ![...listeners].some(listener => sameBranchId(listener.branchId, branchId))) return null;
  try {
    const { url, key } = supabaseConfig();
    return { url, key, terminalId, branchId,
      cashierToken, sessionToken: sessionTokenSync(), epoch: sessionEpoch() };
  } catch { return null; }
}

type Scope = NonNullable<ReturnType<typeof readScope>>;
const matches = (left: Scope, right: Scope | null) => !!right &&
  left.url === right.url && left.key === right.key && left.terminalId === right.terminalId &&
  left.branchId === right.branchId && left.epoch === right.epoch &&
  left.cashierToken === right.cashierToken && left.sessionToken === right.sessionToken;

async function proveWake(scope: Scope, client: ReturnType<typeof externalClientSnapshot>, current: () => boolean) {
  const email = `terminal.${scope.terminalId.toLowerCase()}@${TERMINAL_EMAIL_DOMAIN}`;
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token || !session.expires_at || session.expires_at * 1000 <= Date.now() ||
      session.user.email?.toLowerCase() !== email || !current()) return null;

  // Prove the exact token and its server-owned account mapping in the same
  // project. GoTrue user metadata cannot establish a terminal's identity.
  const bearer = session.access_token;
  const user = await client.auth.getUser(bearer);
  if (user.error || user.data.user?.id !== session.user.id ||
      user.data.user.email?.toLowerCase() !== email || !current()) return null;
  const profile = await client.from("app_users").select("auth_user_id,email,role,store_id,is_active")
    .eq("auth_user_id", session.user.id).limit(2).setHeader("Authorization", `Bearer ${bearer}`);
  const row = profile.data?.[0];
  if (profile.error || profile.data?.length !== 1 || row?.is_active !== true || row.role !== "staff" ||
      row.auth_user_id !== session.user.id || row.email?.toLowerCase() !== email ||
      !sameBranchId(row.store_id, scope.branchId) || !current()) return null;

  // Only the existing person-session relay can authorize an approval read.
  // Send no requested store or machine bearer to this verification endpoint.
  const { cashierToken, sessionToken, terminalToken, deviceBindingProof } = await readCredentials();
  if (cashierToken !== scope.cashierToken || (sessionToken ?? null) !== scope.sessionToken ||
      terminalToken !== scope.terminalId || !deviceBindingProof || !current()) return null;
  const person = await verifySession({
    data: { cashierToken, sessionToken, terminalToken, deviceBindingProof },
    signal: AbortSignal.timeout(8_000),
  });
  if (!person.ok || person.kind !== "cashier" || !person.storeId ||
      !sameBranchId(person.storeId, scope.branchId) || !current()) return null;
  return { bearer, branchId: person.storeId, expiresAt: session.expires_at * 1000 };
}

function createReceiver() {
  let stopped = false;
  let wanted: Scope | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let authClient: ReturnType<typeof externalClientSnapshot> | undefined;
  let offAuth: (() => void) | undefined;

  const stopSocket = () => {
    generation += 1;
    wanted = null;
    clearTimeout(timer);
    clearTimeout(expiryTimer);
    void sockets.stop();
  };
  const refresh = (force = false) => {
    if (stopped) return;
    const scope = readScope();
    if (!scope) { stopSocket(); return; }
    if (!force && wanted && matches(wanted, scope)) return;
    wanted = scope;
    const attempt = ++generation;
    const current = () => attempt === generation && matches(scope, readScope());
    clearTimeout(timer);
    clearTimeout(expiryTimer);
    // GoTrue invokes Auth listeners under its lock. Join and validate outside
    // that callback, so this reader cannot block staff or machine sign-in.
    timer = setTimeout(() => {
      void sockets.replace(async () => {
        let opened = false;
        try {
          if (!current()) return null;
          const client = externalClientSnapshot();
          if (authClient !== client) {
            offAuth?.();
            authClient = client;
            let observedToken: string | undefined;
            const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
              const next = session?.access_token;
              if (event === "INITIAL_SESSION") { observedToken = next; return; }
              if (next !== observedToken || event === "SIGNED_OUT" || event === "USER_UPDATED") {
                observedToken = next;
                refresh(true);
              }
            });
            offAuth = () => subscription.unsubscribe();
          }
          const proof = await proveWake(scope, client, current);
          if (!proof || !current()) return null;

          const url = new URL("realtime/v1", `${scope.url.replace(/\/+$/, "")}/`);
          url.protocol = url.protocol.replace("http", "ws");
          const socket = new RealtimeClient(url.href, { params: { apikey: scope.key } });
          try {
            await socket.setAuth(proof.bearer);
            const remaining = proof.expiresAt - Date.now();
            if (!current() || remaining <= 0) { await socket.disconnect(); return null; }
            const wake = (table?: WakeTable) => {
              if (!current() || proof.expiresAt <= Date.now()) return;
              for (const listener of [...listeners]) {
                if (sameBranchId(listener.branchId, proof.branchId) && (!table || listener.table === table)) listener.wake();
              }
            };
            let joined = false;
            socket.channel(`pos-sync:default:branch:${proof.branchId}`, { config: { private: true } })
              .on("broadcast", { event: "sync_changed" }, message => {
                const table = message.payload?.table;
                if (table === "authorization_requests" || table === "activity_events") wake(table);
              })
              .subscribe((status, error) => {
                if (!current()) return;
                const connected = status === "SUBSCRIBED";
                if (connected && !joined) wake();
                joined = connected;
                if (status === "CHANNEL_ERROR" && /unauthorized|permission|forbidden/i.test(error?.message ?? "")) stopSocket();
              });
            if (current()) expiryTimer = setTimeout(stopSocket, Math.min(remaining, 2_147_483_647));
            opened = true;
            return socket;
          } catch {
            await socket.disconnect().catch(() => undefined);
            return null;
          }
        } catch { return null; }
        finally { if (!opened && attempt === generation) wanted = null; }
      });
    }, 0);
  };

  const resume = () => refresh();
  const rebind = () => refresh(true);
  const lifecycleEvents = ["online", "offline", "focus", APP_RESUME_EVENT];
  for (const event of lifecycleEvents) window.addEventListener(event, resume);
  const offScope = [subscribeCredentialChanges(resume), subscribeCentralAuthSession(rebind),
    subscribeTerminalConfig(rebind), subscribeExternalClientReset(rebind)];
  return {
    refresh,
    stop: () => {
      stopped = true;
      stopSocket();
      offAuth?.();
      for (const off of offScope) off();
      for (const event of lifecycleEvents) window.removeEventListener(event, resume);
    },
  };
}

let receiver: ReturnType<typeof createReceiver> | undefined;

function subscribePinWake(branchId: string, table: WakeTable, wake: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = { branchId, table, wake };
  listeners.add(listener);
  receiver ??= createReceiver();
  receiver.refresh();
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size) receiver?.refresh();
    else { receiver?.stop(); receiver = undefined; }
  };
}

/** Receive request hints for open approval views on an enrolled PIN till. */
export function subscribePinApprovalWake(branchId: string, wake: () => void): () => void {
  return subscribePinWake(branchId, "authorization_requests", wake);
}

/** The mobile bell can reread its existing person-authorized activity feed. */
export function subscribeMobilePinActivityWake(branchId: string, wake: () => void): () => void {
  const platform = platformName();
  if (platform !== "android" && platform !== "ios") return () => {};
  return subscribePinWake(branchId, "activity_events", wake);
}

/** Windows waits for the authorized local mirror to commit before reading. */
export function subscribeDesktopPinActivityWake(branchId: string, wake: () => void): () => void {
  if (platformName() !== "electron") return () => {};
  return subscribePinWake(branchId, "activity_events", wake);
}
