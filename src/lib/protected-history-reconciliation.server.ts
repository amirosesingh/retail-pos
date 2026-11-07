import {serviceRest} from '@/core/api/pos-relay.server';

export type HistoryReconcileRead = (
 | {action:'begin';organizationId:string;branchId:string}
 | {action:'page';organizationId:string;branchId:string;afterId:string|null;upperId:string}
 | {action:'finish';organizationId:string;branchId:string;upperId:string|null}
 | {action:'rows';organizationId:string;branchId:string;ids:string[]}
) & {accessPolicy?:'branch-history-v1'};

const PREFIX='X-POS-History-Reconcile-';
async function invalid(response:Response){
 try{await response.body?.cancel();}catch{/* No progress is committed. */}
 return Response.json({ok:false,code:'EHISTORY_INDEX_PROTOCOL',error:'The protected history response could not be verified; recovery remains pending.'},{status:502});
}

/** Current relay admission/projection is resolved before this read-only call. */
export async function protectedHistoryReconciliation(args:{read:HistoryReconcileRead;terminalId:string;keepCommerce:boolean;signal?:AbortSignal}):Promise<Response>{
 const {read}=args,rows=read.action==='rows',version=read.accessPolicy==='branch-history-v1'?'2':'1';
 const body={p_organization_id:read.organizationId,p_branch_id:read.branchId,p_terminal_id:args.terminalId,p_keep_commerce:args.keepCommerce,
  ...(rows?{p_ids:read.ids,p_max_bytes:2*1024*1024}:{p_action:read.action,p_after_id:read.action==='page'?read.afterId:null,p_upper_id:read.action==='begin'?null:read.upperId,p_limit:1000})};
 let response:Response;
 try{response=await serviceRest('rpc/'+(rows?'pos_sync_history_rows_v':'pos_sync_history_index_v')+version,{
  method:'POST',headers:{'Accept-Encoding':'identity'},body:JSON.stringify(body),...(args.signal?{signal:args.signal}:{}),
 });}catch{return Response.json({ok:false,code:'SERVICE_UNAVAILABLE',error:'The central history service did not answer; recovery will retry.'},{status:503});}
 // Preserve real authorization/network/schema failures. There is no fallback to
 // an unprotected history read or a client-selected privacy mode.
 if(!response.ok)return new Response(response.body,{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'}});
 const max=rows?5*1024*1024:128*1024;
 const text=response.headers.get(PREFIX+'Bytes')??'',countText=response.headers.get(PREFIX+'Rows')??'';
 const size=Number(text),count=Number(countText),length=response.headers.get('content-length');
 if(response.status!==200||!response.body||response.headers.get(PREFIX+'Version')!==version||response.headers.get(PREFIX+'Kind')!==(rows?'rows':'index')||
  !/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(size)||size>max||
  !/^(?:0|[1-9][0-9]*)$/.test(countText)||!Number.isSafeInteger(count)||count>(rows?10:1000)||rows&&count<1||
  rows&&size>2*1024*1024&&count!==1||
  !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||
  ![null,'identity'].includes(response.headers.get('content-encoding'))||
  length!==null&&(!/^[0-9]+$/.test(length)||Number(length)!==size))return invalid(response);
 try{
  const NativeFixedLengthStream=(globalThis as typeof globalThis & {FixedLengthStream?:new(length:number)=>ReadableWritablePair<Uint8Array,Uint8Array>}).FixedLengthStream;
  let buffer:ArrayBuffer;
  if(typeof NativeFixedLengthStream==='function'){
   const bounded=new NativeFixedLengthStream(size);
   [buffer]=await Promise.all([new Response(bounded.readable).arrayBuffer(),response.body.pipeTo(bounded.writable)]);
  }else{
   let received=0;
   const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,controller){received+=chunk.byteLength;if(received>size||received>max)throw new Error('EHISTORY_INDEX_PROTOCOL');controller.enqueue(chunk);},
    flush(){if(received!==size)throw new Error('EHISTORY_INDEX_PROTOCOL');},
   }));
   buffer=await new Response(body).arrayBuffer();
  }
  return new Response(buffer,{headers:{'content-type':'application/json','cache-control':'no-store',
   [PREFIX+'Version']:version,[PREFIX+'Kind']:rows?'rows':'index',[PREFIX+'Bytes']:String(size),[PREFIX+'Rows']:String(count)}});
 }catch{return invalid(response);}
}
