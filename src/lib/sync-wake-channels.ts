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
      ].map(topic=>client.channel(topic,{config:{private:true}})
        .on("broadcast",{event:"sync_changed"},message=>{
          const table=message.payload?.table;
          if(typeof table==="string" && /^[a-z_][a-z0-9_]{0,63}$/.test(table))onChange(table);
        }).subscribe(status=>{if(status==="SUBSCRIBED")onReconnect();})));
    },
    stop:replacer.stop,
  };
}
