import { externalClientSnapshot, subscribeExternalClientReset } from "@/integrations/supabase/external-client";
import { hasStaffSession } from "@/core/api/sync-relay";
import { supabaseConfig } from "./external-supabase-config";
import { TERMINAL_EMAIL_DOMAIN } from "./internal-domains";
import { createSerialChannelReplacer } from "./realtime-channel-replacer";
import { centralAuthAccessToken, subscribeCentralAuthSession } from "./session-presence";

const channels = createSerialChannelReplacer<() => Promise<unknown>>({ remove: remove => remove() });
const noChannel = async () => {};
const listeners = new Set<{ project: string; wake: () => void; setLive: (live: boolean) => void }>();
let stopReceiver: (() => void) | undefined;
let refreshReceiver: (() => void) | undefined;
let activeProject: string | undefined;
let live = false;

function startReceiver() {
  let generation = 0;
  const join = () => {
    const attempt = ++generation;
    const token = centralAuthAccessToken();
    let project: string | undefined;
    try { project = supabaseConfig().url; } catch { /* Wait for a configured project. */ }
    activeProject = project;
    const subscribers = () => [...listeners].filter(listener => listener.project === project);
    const current = () => {
      if (attempt !== generation || !project || !subscribers().length || !token ||
          token !== centralAuthAccessToken() || !hasStaffSession()) return false;
      try { return supabaseConfig().url === project; }
      catch { return false; }
    };
    live = false;
    for (const listener of listeners) listener.setLive(false);
    if (!current()) { void channels.stop(); return; }
    void channels.replace(async () => {
      if (!current()) return noChannel;
      const client = externalClientSnapshot();
      const { data, error } = await client.auth.getSession();
      const session = data.session;
      const id = session?.user.id;
      const email = session?.user.email?.toLowerCase();
      if (error || !current() || session?.access_token !== token ||
          !id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) ||
          !email || email.startsWith("terminal.") && email.endsWith(`@${TERMINAL_EMAIL_DOMAIN}`))
        return noChannel;

      let joined = false;
      const channel = client.channel(`pos-approval-wake:v1:${id}`, { config: { private: true } });
      channel.on("broadcast", { event: "approval_changed" }, () => {
        if (current()) for (const listener of subscribers()) listener.wake();
      }).subscribe(status => {
        if (!current()) return;
        live = status === "SUBSCRIBED";
        for (const listener of subscribers()) {
          if (live && !joined) listener.wake();
          listener.setLive(live);
        }
        joined = live;
      });
      return () => client.removeChannel(channel);
    });
  };
  const offAuth = subscribeCentralAuthSession(join);
  const offProject = subscribeExternalClientReset(join);
  refreshReceiver = join;
  join();
  return () => {
    generation++;
    offAuth();
    offProject();
    void channels.stop();
  };
}

export function subscribeNamedApprovalWake(project: string, wake: () => void, setLive: (live: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = { project, wake, setLive };
  const hadProject = [...listeners].some(item => item.project === project);
  listeners.add(listener);
  if (!stopReceiver) stopReceiver = startReceiver();
  else if (activeProject === project && !hadProject) refreshReceiver?.();
  else if (activeProject === project && live) {
    setLive(true);
    wake();
  }
  return () => {
    if (!listeners.delete(listener)) return;
    if (!listeners.size) {
      stopReceiver?.();
      stopReceiver = refreshReceiver = undefined;
      activeProject = undefined;
      live = false;
    } else if (activeProject === project && ![...listeners].some(item => item.project === project)) {
      refreshReceiver?.();
    }
  };
}
