/** Missing optional preparation must not replace ordinary business admission.
 * Only PostgREST's exact missing-wrapper response proves no wrapper ran. Never
 * retry a permission/conflict/timeout under another operation or bypass it. */
export async function fallbackUnavailableStockSource(response:Response,body:string,
 send:(path:string,init:{method:string;body:string})=>Promise<Response>){
 if(response.status!==404)return response;
 const raw=await response.clone().text();if(new TextEncoder().encode(raw).length>8192)return response;
 let error:{code?:unknown;message?:unknown};try{error=JSON.parse(raw);}catch{return response;}
 if(error?.code!=='PGRST202'||typeof error.message!=='string'||!error.message.includes('pos_sync_push_stock_source_aggregate'))return response;
 const value=JSON.parse(body) as Record<string,unknown>;
 const expected=['p_batch_id','p_organization_id','p_branch_id','p_terminal_id','p_operations','p_project','p_cohorts'];
 if(Object.keys(value).length!==expected.length||expected.some(key=>!Object.hasOwn(value,key)))return response;
 const {p_project:_project,p_cohorts:_cohorts,...business}=value;
 return send('rpc/pos_sync_push_aggregate',{method:'POST',body:JSON.stringify(business)});
}
