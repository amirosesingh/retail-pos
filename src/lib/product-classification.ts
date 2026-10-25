/** Missing classification values share one label across imports and platforms. */
export const DEFAULT_PRODUCT_CLASSIFICATION = "Default";
export const productClassification = (value: string | null | undefined): string =>
  value?.trim() || DEFAULT_PRODUCT_CLASSIFICATION;
