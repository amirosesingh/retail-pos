import { expect,it } from "vitest";
import type { Product,Store } from "@/core/types/pos-types";
import { defaultSettings } from "../pos-seed";
import { createCatalogueVisibility } from "../branch-policy";
import { keepExistingMarketingOption,marketingSelectionError } from "../marketing-catalogue";
const product=(id:string,ownerStoreId:string,category="Shoes",extra:Partial<Product>={}):Product=>({id,ownerStoreId,category,name:id,sku:id,barcode:id,price:10,cost:5,stockByStore:{},reorderLevel:0,taxRate:0,...extra});
const products=[product("own","A"),product("sibling","B"),product("foreign","C","Apparel"),product("received","C","Transferred",{catalogueStoreIds:["A"]}),product("archived","A","Old",{archived:true})];
const stores=[{id:"A",groupId:"sports"},{id:"B",groupId:"sports"},{id:"C",groupId:"apparel"}] as Store[];
const visible=createCatalogueVisibility(defaultSettings,stores,[]);
const available=products.filter(row=>row.archived!==true&&visible(row,"A"));
it("offers only the current cluster and proven received products without transfer-history access",()=>{
  expect(available.map(row=>row.id)).toEqual(["own","sibling","received"]);
  expect(marketingSelectionError({kind:"product",value:"foreign"},undefined,available,"A","A")).toMatch(/not available/);
  expect(marketingSelectionError({kind:"category",value:"Apparel"},undefined,available,"A","A")).toMatch(/not available/);
  expect(marketingSelectionError({kind:"product",value:"received"},undefined,available,"A","A")).toBeNull();
  expect(marketingSelectionError({kind:"category",value:"Transferred"},undefined,available,"A","A")).toBeNull();
});
it("keeps an unchanged existing campaign/product scope editable without moving it to another cluster",()=>{
  expect(marketingSelectionError({kind:"product",value:"foreign"},{kind:"product",value:"foreign"},available,"A","C")).toBeNull();
  expect(marketingSelectionError({kind:"product",value:"foreign"},{kind:"product",value:"own"},available,"A","A")).toMatch(/not available/);
});
it("rejects new selections after the draft's branch changes and preserves global bill campaigns",()=>{
  expect(marketingSelectionError({kind:"product",value:"own"},undefined,available,"A","B")).toMatch(/branch changed/);
  expect(marketingSelectionError({kind:"bill"},undefined,available,"A","C")).toBeNull();
});
it("labels an existing unavailable value without adding arbitrary new foreign options",()=>{
  const options=[{value:"own",label:"Own product"}];
  expect(keepExistingMarketingOption(options,"foreign","foreign","product")).toEqual([...options,{value:"foreign",label:"Existing product (not in this branch's active catalogue)"}]);
  expect(keepExistingMarketingOption(options,"foreign","own","product")).toEqual(options);
  expect(keepExistingMarketingOption(options,"own","own","product")).toEqual(options);
});
