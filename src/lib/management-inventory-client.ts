import { useEffect, useState } from "react";
import type { Product, Store } from "@/core/types/pos-types";
import { desktopBridge } from "./desktop-bridge-registry";
import { isManagementDevice } from "./management-device";

export type ManagementInventoryLocation = Pick<Store, "id" | "code" | "name" | "locationType" | "active"> & { replicaReady: boolean };
export type ManagementInventoryProduct = Pick<Product, "id" | "name" | "sku" | "barcode" | "brand" | "category" |
  "subCategory" | "archived" | "reorderLevel" | "stockByStore"> & { cost: number | null; retailPriceByStore: Record<string, number> };
export type ManagementInventoryRequest = { kind: "locations" } |
  { kind: "current" | "authorize-export"; branchId: string } | { kind: "current" | "authorize-export"; all: true };
export type ManagementInventoryResult = { ok: false; code?: string; error: string } |
  { ok: true; locations: ManagementInventoryLocation[]; products?: ManagementInventoryProduct[]; canViewCost?: boolean; canExportReports?: boolean };

export const toManagementReportStore = (location: ManagementInventoryLocation): Store => ({ ...location, address: "", phone: "" });
export const toManagementReportProduct = (product: ManagementInventoryProduct): Product => ({
  ...product, cost: product.cost ?? Number.NaN, price: Number.NaN, taxRate: 0,
});

export function managementInventoryReader() {
  return typeof window !== "undefined" && isManagementDevice()
    ? desktopBridge("pos", window.pos ?? null)?.managementInventory : undefined;
}

export function useManagementInventory(request: ManagementInventoryRequest | null, revision: string | number = 0) {
  const serialized = request && JSON.stringify(request);
  const key = serialized && JSON.stringify([serialized, revision]);
  const [data, setData] = useState<{ key: string; result: ManagementInventoryResult } | null>(null);
  useEffect(() => {
    if (!serialized || !key) return;
    const read = managementInventoryReader();
    if (!read) {
      setData({ key, result: { ok: false, error: "This Electron build needs the Management stock report reader." } });
      return;
    }
    let active = true;
    void read(JSON.parse(serialized) as ManagementInventoryRequest).then(result => {
      if (active) setData({ key, result });
    }, () => {
      if (active) setData({ key, result: { ok: false, error: "The Management local inventory reader did not answer." } });
    });
    return () => { active = false; };
  }, [key, serialized]);
  return key && data?.key === key ? data.result : null;
}
