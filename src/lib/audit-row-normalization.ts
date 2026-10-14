import type {AuditLog} from "./audit-log";
export function auditDetails(value:unknown):Record<string,unknown> {
  if(typeof value === "string") {
    try {return auditDetails(JSON.parse(value));} catch {return {};}
  }
  return value && typeof value === "object" && !Array.isArray(value)?value as Record<string,unknown>:{};
}
const text=(value:unknown,fallback="")=>typeof value==="string"?value:typeof value==="number"?String(value):fallback;
/** Old/corrupted device caches must never become invalid React children or string operations. */
export function normalizeCachedAuditRows(value:unknown):AuditLog[] {
  if(!Array.isArray(value)) return [];
  return value.flatMap(item=>{
    if(!item || typeof item!=="object" || typeof item.id!=="string") return [];
    return [{...item,id:item.id,at:text(item.at,new Date(0).toISOString()),
      action:text(item.action,"Recorded activity"),category:text(item.category,"other"),
      module:text(item.module),staffId:text(item.staffId,"unknown"),staffName:text(item.staffName,"Unknown"),
      role:text(item.role,"unknown"),route:text(item.route),storeId:typeof item.storeId==="string"?item.storeId:null,
      details:auditDetails(item.details),synced_to_cloud:item.synced_to_cloud===true,
      syncedAt:typeof item.syncedAt==="string"?item.syncedAt:null} as AuditLog];
  });
}
