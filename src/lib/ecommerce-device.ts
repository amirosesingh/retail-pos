import { terminalRuntimePlatform } from "@/core/activation/terminal-platform";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isManagementDevice } from "./management-device";
export function managementEcommerceContext(runtime: string, registered: boolean, management: boolean): boolean {
  return management || (runtime === "web" && !registered);
}
export function canUseEcommerceDevice(): boolean {
  return managementEcommerceContext(terminalRuntimePlatform(), Boolean(readTerminalConfig()?.tokenId), isManagementDevice());
}

const OPERATIONS_PRODUCT_COLUMNS = "id,barcode,name,category,cost_price,selling_price,stock_quantity,custom_points,point_multiplier,created_at,sku,reorder_level,tax_rate,stock_by_store,updated_at,landing_pct,sub_category,unit,packs,barcode_aliases,is_archived,archived_at,brand,product_group,barcode_variants,row_version,owner_store_id,catalogue_store_ids,deleted_at";
export function productReadColumns(requested = "*"): string {
  if (canUseEcommerceDevice()) return requested;
  return requested === "*" ? OPERATIONS_PRODUCT_COLUMNS : requested.split(",").filter(column => !/\b(ecom_price|ecom_visible|ecom_enabled|is_published)\b/.test(column)).join(",");
}
