export type ReceiptHeaderLayout = {
  showCompany: boolean;
  showCluster: boolean;
  showStore: boolean;
  showStoreCode: boolean;
  clusterPosition: "above-company" | "below-company" | "after-store";
};

export function normalizeReceiptHeaderLayout(value: unknown): ReceiptHeaderLayout {
  const layout = value && typeof value === "object" ? value as Partial<ReceiptHeaderLayout> : {};
  return {
    showCompany: layout.showCompany !== false,
    showCluster: layout.showCluster === true,
    showStore: layout.showStore !== false,
    showStoreCode: layout.showStoreCode !== false,
    clusterPosition: layout.clusterPosition === "above-company" || layout.clusterPosition === "after-store" ? layout.clusterPosition : "below-company",
  };
}
