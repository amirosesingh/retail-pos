import { createSerialChannelReplacer } from "./realtime-channel-replacer";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Channel = RealtimeChannel;
type Client = { channel(topic:string, options:{config:{private:true}}):Channel; removeChannel(channel:Channel):Promise<unknown> };

/** Private signals carry table names only; records always use the scoped delta API. */
export function createSyncWakeChannels(client:Client, onChange:(table:string)=>void, onReconnect:()=>void, prepareJoin:()=>Promise<boolean> = async () => true) {
  const replacer=createSerialChannelReplacer<Channel[]>({remove:channels=>Promise.all(channels.map(channel=>client.removeChannel(channel)))});
  let generation = 0;
  let catchupTimer: ReturnType<typeof setTimeout> | undefined;
  let catchupQueuedAt: number | undefined;
  const clearCatchup = () => {
    if (catchupTimer !== undefined) clearTimeout(catchupTimer);
    catchupTimer = undefined;
    catchupQueuedAt = undefined;
  };
  return {
    replace(branchId:string|null, terminalId:string|null, authenticated:boolean) {
      const requestedGeneration = ++generation;
      clearCatchup();
      if (!authenticated || !branchId) return replacer.stop();
      return replacer.replace(async () => {
        if (!await prepareJoin() || requestedGeneration !== generation) return [];
        // A group of nearby joins needs one catch-up, not one per topic.
        // A late join still needs its own read: it may have missed changes
        // after an earlier topic joined. Cap deferral during a flapping socket.
        const queueCatchup = () => {
          catchupQueuedAt ??= Date.now();
          if (catchupTimer !== undefined) clearTimeout(catchupTimer);
          catchupTimer = setTimeout(() => {
            catchupTimer = undefined;
            catchupQueuedAt = undefined;
            if (requestedGeneration === generation) onReconnect();
          }, Math.min(250, Math.max(0, 1000 - (Date.now() - catchupQueuedAt))));
        };
        return [
        "pos-sync:default:global",
        `pos-sync:default:branch:${branchId}`,
        ...(terminalId ? [`pos-sync:default:terminal:${terminalId}`] : []),
      ].map(topic => {
        const channel = client.channel(topic, {config: {private: true}});
        let previousStatus: string | undefined;
        channel.on("broadcast", {event: "sync_changed"}, message => {
          if (requestedGeneration !== generation) return;
          const table = message.payload?.table;
          if (typeof table === "string" && /^[a-z_][a-z0-9_]{0,63}$/.test(table)) onChange(table);
        }).subscribe((status, error) => {
          if (requestedGeneration !== generation) return;
          if (status === "SUBSCRIBED" && previousStatus !== "SUBSCRIBED") queueCatchup();
          previousStatus = status;
          // Permission denial is permanent for this join. Let durable polling
          // continue; a refreshed session or changed scope can try a new join.
          // Network errors keep the SDK's normal reconnect behavior.
          if (status === "CHANNEL_ERROR" && /unauthorized|permission|forbidden/i.test(error?.message ?? "")) {
            void client.removeChannel(channel).catch(() => {});
          }
        });
        return channel;
      });
      });
    },
    stop() { generation += 1; clearCatchup(); return replacer.stop(); },
  };
}
