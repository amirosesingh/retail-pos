import {supabaseConfig} from './external-supabase-config';
import {serviceRest} from '@/core/api/pos-relay.server';

// Schema readiness only, never account permissions. A successful capability is
// monotonic for this deployment: transient failures must not downgrade writes.
const ready=new Set<string>(),absentUntil=new Map<string,number>(),pending=new Map<string,Promise<boolean>>();
const unavailable=()=>Object.assign(new Error('Financial validation is temporarily unavailable. Nothing has been saved; try again.'),{status:503,code:'EFINANCIAL_ADAPTER_UNAVAILABLE'});
export async function financialLiveAdapterReady():Promise<boolean>{
 const project=supabaseConfig().url;
 if(ready.has(project))return true;
 if((absentUntil.get(project)??0)>Date.now())return false;
 const existing=pending.get(project);if(existing)return existing;
 const work=(async()=>{
  let response:Response;
  try{response=await serviceRest('rpc/pos_live_financial_ready',{method:'POST',body:'{}'});}catch{throw unavailable();}
  let value:unknown;try{const raw=await response.text();if(raw.length>4096)throw unavailable();value=JSON.parse(raw);}catch{throw unavailable();}
  if(response.status===404&&value&&typeof value==='object'&&'code'in value&&value.code==='PGRST202'&&'message'in value&&typeof value.message==='string'&&value.message.includes('pos_live_financial_ready')){absentUntil.set(project,Date.now()+5000);return false;}
  if(!response.ok||!value||typeof value!=='object'||!('version'in value)||value.version!==2||!('ready'in value)||typeof value.ready!=='boolean')throw unavailable();
  // An installed but incomplete/changed adapter is not a legacy deployment.
  // Falling back here would bypass the installed financial guards.
  if(!value.ready)throw unavailable();
  ready.add(project);
  return true;
 })();pending.set(project,work);
 try{return await work;}finally{if(pending.get(project)===work)pending.delete(project);}
}
