/**
 * Can an item with nothing on the shelf still be rung up?
 *
 * The register settings are the only thing that decides. The till used to
 * refuse outright, whatever the branch had chosen, so the setting could never
 * take effect.
 */
export function blocksOutOfStockSale(onHand: number, preventNegativeStock: boolean): boolean {
  return onHand <= 0 && preventNegativeStock;
}

export function exceedsAvailableStock(onHand: number, requested: number, preventNegativeStock: boolean): boolean {
  return preventNegativeStock && requested > onHand;
}
