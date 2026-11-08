import { externalClientSnapshot, subscribeExternalClientReset } from "@/integrations/supabase/external-client";
import { hasStaffSession } from "@/core/api/sync-relay";
import { supabaseConfig } from "./external-supabase-config";
import { TERMINAL_EMAIL_DOMAIN } from "./internal-domains";
import { createSerialChannelReplacer } from "./realtime-channel-replacer";
import { centralAuthAccessToken, subscribeCentralAuthSession } from "./session-presence";

const channels = createSerialChannelReplacer<() => Promise<unknown>>({ remove: remove => remove() });
const noChannel = async () => {};

export function subscribeNamedApprovalWake(project: string, wake: () => void, setLive: (live: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  let generation = 0;
  const join = () => {
    const attempt = ++generation;
    const token = centralAuthAccessToken();
    const current = () => {
      if (attempt !== generation || !token || token !== centralAuthAccessToken() || !hasStaffSession()) return false;
      try { return supabaseConfig().url === project; }
      catch { return false; }
    };
    setLive(false);
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
        if (current()) wake();
      }).subscribe(status => {
        if (!current()) return;
        const live = status === "SUBSCRIBED";
        if (live && !joined) wake();
        joined = live;
        setLive(live);
      });
      return () => client.removeChannel(channel);
    });
  };
  const offAuth = subscribeCentralAuthSession(join);
  const offProject = subscribeExternalClientReset(join);
  join();
  return () => {
    generation++;
    offAuth();
    offProject();
    void channels.stop();
  };
}
