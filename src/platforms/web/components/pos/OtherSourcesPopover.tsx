import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Product, Store } from "@/core/types/pos-types";
import { cn } from "@/lib/utils";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "@/lib/branch-id";
import { companyStoreScope } from "@/lib/company-store-scope";
import { displayedStockQuantity } from "@/lib/stock-quantity-display";

type Props = {
  product: Product;
  stores: Store[];
  currentStoreId: string;
  className?: string;
};

const quantity = (value: number) => displayedStockQuantity(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

/** Stores must come from stockDisplayLocations and the product's catalogue scope. */
export function OtherSourcesPopover({ product, stores, currentStoreId, className }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useMemo(
    () => {
      const stock = canonicalStockMap(product.stockByStore);
      const seen = new Set<string>();
      return companyStoreScope(stores, currentStoreId)
        .filter(store => {
          const id = canonicalBranchId(store.id);
          if (!id || seen.has(id) || sameBranchId(id, currentStoreId) || store.active === false) return false;
          seen.add(id);
          return true;
        })
        .map(store => ({ store, qty: stock[canonicalBranchId(store.id)] ?? 0 }))
        .filter(row => row.qty > 0)
        .sort((a, b) => a.store.name.localeCompare(b.store.name));
    },
    [currentStoreId, product.stockByStore, stores],
  );
  const available = rows.filter((row) => row.qty > 0);
  const total = available.reduce((sum, row) => sum + row.qty, 0);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!rows.length) return <span className="text-xs text-muted-foreground">No available sources</span>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-auto min-h-8 max-w-full touch-manipulation px-2 py-1 text-left", className)}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              cancelClose();
              setOpen(true);
            }
          }}
          onPointerLeave={(event) => event.pointerType === "mouse" && scheduleClose()}
          aria-label={`Other sources for ${product.name}: ${available.length}, total ${quantity(total)} ${product.unit ?? "pcs"}`}
        >
          <span className="min-w-0 leading-tight">
            <span className="block whitespace-nowrap text-xs font-medium">
              Other Sources: <span className="numeric">{available.length}</span>
            </span>
            <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
              Total Available: <span className="numeric">{quantity(total)}</span> {product.unit ?? "pcs"}
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <div className="border-b border-border px-3 py-2">
          <p className="truncate text-sm font-semibold">{product.name}</p>
          <p className="text-xs text-muted-foreground">Available stock in this cluster's permitted branches and warehouses</p>
        </div>
        <div className="max-h-72 overflow-y-auto overscroll-contain p-2">
          {rows.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No other sources configured.</p>
          ) : (
            rows.map(({ store, qty }) => (
              <div key={store.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <Boxes className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{store.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {store.code}{store.locationType ? ` · ${store.locationType.replaceAll("_", " ")}` : ""}
                  </p>
                </div>
                <span className={cn("numeric whitespace-nowrap text-sm", qty <= 0 && "text-muted-foreground")}>
                  {quantity(qty)} {product.unit ?? "pcs"}
                </span>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
