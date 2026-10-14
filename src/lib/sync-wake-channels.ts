import { createSerialChannelReplacer } from "./realtime-channel-replacer";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Channel = RealtimeChannel;
type Client = { channel(topic:string, options:{config:{private:true}}):Channel; removeChannel(channel:Channel):Promise<unknown> };

/** Private signals carry table names only; records always use the scoped delta API. */
export function createSyncWakeChannels(client:Client, onChange:(table:string)=>void, onReconnect:()=>void) {
  const replacer=createSerialChannelReplacer<Channel[]>({remove:channels=>Promise.all(channels.map(channel=>client.removeChannel(channel)))});
  return {
    replace(branchId:string|null, terminalId:string|null, authenticated:boolean) {
      if (!authenticated || !branchId) return replacer.stop();
      return replacer.replace(()=>[
        "pos-sync:default:global",
        `pos-sync:default:branch:${branchId}`,
        ...(terminalId ? [`pos-sync:default:terminal:${terminalId}`] : []),
      ].map(topic => {
        const channel = client.channel(topic, {config: {private: true}});
        channel.on("broadcast", {event: "sync_changed"}, message => {
          const table = message.payload?.table;
          if (typeof table === "string" && /^[a-z_][a-z0-9_]{0,63}$/.test(table)) onChange(table);
        }).subscribe((status, error) => {
          if (status === "SUBSCRIBED") onReconnect();
          // Permission denial is permanent for this join. Let durable polling
          // continue; a refreshed session or changed scope can try a new join.
          // Network errors keep the SDK's normal reconnect behavior.
          if (status === "CHANNEL_ERROR" && /unauthorized|permission|forbidden/i.test(error?.message ?? "")) {
            void client.removeChannel(channel).catch(() => {});
          }
        });
        return channel;
      }));
    },
    stop:replacer.stop,
  };
}
