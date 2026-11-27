import { createClientOnlyFn } from "@tanstack/react-start";

export const loadProductMergeClient = createClientOnlyFn(() => import("./stock-history-product-merge.client"));
