import { notifyError } from "@/lib/notify";
/**
 * Product table for stock paperwork (transfers, requests, receiving).
 *
 * A dropdown over the whole catalogue is useless once a shop carries a few
 * thousand items, so this is a compact fixed-header table fed by an indexed,
 * capped database search — the client never loads the whole catalogue. It
 * only picks a product; it never creates or edits one, so it is safe on every
 * stock screen.
 *
 * A barcode scanner is a keyboard: typing a code and pressing Enter adds the
 * matching item straight away, so a stack of goods can be counted in without
 * touching the mouse.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

import type { Product } from "@/core/types/pos-types";
import { stockAt } from "@/lib/pos-store";
import { exactCodeMatch, searchCatalog, searchLocal } from "@/lib/product-search";

export function ProductPicker({
  products,
  storeId,
  storeCode,
  destinationStoreId,
  destinationStoreCode,
  onPick,
  limit = 25,
  placeholder = "Scan barcode, or search by name / SKU",
}: {
  products: Product[];
  storeId: string;
  storeCode?: string;
  /** Shown as an extra stock column when a receiving branch is in play. */
  destinationStoreId?: string;
  destinationStoreCode?: string;
  onPick: (product: Product, qty: number) => void;
  limit?: number;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Product[]>(() => searchLocal(products, "", limit));
  
  const inputRef = useRef<HTMLInputElement>(null);

  /* Debounced, capped catalogue query with a local fallback. */
  useEffect(() => {
    const needle = term.trim();
    if (!needle) {
      setRows(searchLocal(products, "", limit));
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void searchCatalog(needle, products, limit).then((res) => {
        if (alive) setRows(res.products);
      }).catch(cause => { if (alive) notifyError(cause, "Searching products"); });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [term, products, limit]);

  const showBranch = Boolean(destinationStoreId);

  function add(product: Product, amount = 1) {
    onPick(product, amount);
  }

  /** Scanner / Enter: an exact code adds immediately and clears the box. */
  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = term.trim();
    if (!code) return;
    const hit = exactCodeMatch(rows, code) ?? exactCodeMatch(products, code);
    if (!hit) return;
    add(hit, 1);
    setTerm("");
    inputRef.current?.focus();
  }

  const columns = useMemo(() => (showBranch ? 4 : 3), [showBranch]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onScanKey}
          placeholder={placeholder}
          className="pl-8"
          aria-label="Scan or search products"
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Barcode</th>
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 text-right font-medium">
                Current branch{storeCode ? ` · ${storeCode}` : ""}
              </th>
              {showBranch && (
                <th className="px-2 py-1.5 text-right font-medium">
                  Available{destinationStoreCode ? ` · ${destinationStoreCode}` : ""}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr
                key={p.id}
                onDoubleClick={() => add(p, 1)}
                title="Double-click to add this item"
                className="cursor-pointer align-middle transition-colors hover:bg-muted/60"
              >
                <td className="numeric truncate px-2 py-1.5 text-muted-foreground">
                  {p.barcode || p.sku || "—"}
                </td>
                <td className="px-2 py-1.5">{p.name}</td>
                {/* A figure below zero means the item was sold on two tills at
                    once while one of them was offline. It is shown as it is,
                    never hidden or clamped, so the count is corrected. */}
                <td
                  className={`numeric px-2 py-1.5 text-right ${
                    stockAt(p, storeId) < 0 ? "font-semibold text-destructive" : ""
                  }`}
                  title={stockAt(p, storeId) < 0 ? "Oversold — count this item and correct it" : undefined}
                >
                  {stockAt(p, storeId)}
                </td>
                {showBranch && (
                  <td className="numeric px-2 py-1.5 text-right text-muted-foreground">
                    {destinationStoreId ? stockAt(p, destinationStoreId) : "—"}
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing matches “{term}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Double-click a row to add it. Set the quantity in the list.
      </p>
    </div>
  );
}
