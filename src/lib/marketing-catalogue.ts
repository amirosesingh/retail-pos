import type { Product } from "@/core/types/pos-types";
import { sameBranchId } from "./branch-id";

type Selection = { kind:"product"|"category"|"bill";value?:string|null };
/** Existing rules may be maintained without silently changing their old scope. */
export function marketingSelectionError(selection:Selection,original:Selection|undefined,products:readonly Product[],draftBranch:string,currentBranch:string):string|null {
  if(selection.kind==="bill") return null;
  if(!selection.value) return `Select a ${selection.kind} from this branch's catalogue.`;
  if(original?.kind===selection.kind && original.value===selection.value) return null;
  if(!sameBranchId(draftBranch,currentBranch)) return "The selected branch changed. Reopen this draft before choosing a new product or category.";
  const available=products.some(product=>product.archived!==true && (selection.kind==="product"?sameBranchId(product.id,selection.value):product.category===selection.value));
  return available?null:`This ${selection.kind} is not available in the selected branch's catalogue.`;
}

export function keepExistingMarketingOption(options:{value:string;label:string}[],value:string|null|undefined,originalValue:string|null|undefined,kind:"product"|"category") {
  return value && value===originalValue && !options.some(option=>option.value===value)
    ? [...options,{value,label:`Existing ${kind} (not in this branch's active catalogue)`}]
    : options;
}
