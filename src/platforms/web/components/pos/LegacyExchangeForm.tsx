import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CartLine, Product } from "@/core/types/pos-types";
import { legacyExchangeLine, legacyExchangeReference } from "@/lib/legacy-exchange";

export function LegacyExchangeForm({ products, onAdd }: { products: Product[]; onAdd: (reference: string, lines: CartLine[]) => Promise<void> }) {
  const [receipt, setReceipt] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [paid, setPaid] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = query.trim() ? products.filter(p => `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 15) : [];
  return <fieldset disabled={busy} className="space-y-3 rounded-md border p-3">
    <p className="text-sm">Admin only · Old POS exchange. Enter all returned items from this receipt. The original amount paid becomes credit; only the extra amount is recorded as this sale. No cash refunds.</p>
    <Input aria-label="Old POS receipt number" placeholder="Old POS receipt number" value={receipt} onChange={e => setReceipt(e.target.value)} maxLength={100} />
    <Input aria-label="Find returned product" placeholder="Search returned product by name or barcode" value={query} onChange={e => {setQuery(e.target.value);setSelected(null);}} />
    {!selected && <div className="max-h-40 overflow-y-auto">{matches.map(p => <Button key={p.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => {setSelected(p);setQuery(p.name);}}>{p.name} · {p.barcode}</Button>)}</div>}
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs">Quantity returned<Input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <label className="text-xs">Original paid per item<Input type="number" min="0.01" step="0.01" value={paid} onChange={e => setPaid(e.target.value)} /></label>
    </div>
    <Button variant="outline" disabled={!selected} onClick={() => {try {if (!selected) return;const line=legacyExchangeLine(selected,Number(quantity),Number(paid));setLines(current => [...current,line]);setSelected(null);setQuery("");setPaid("");setQuantity("1");setError("");} catch(e) {setError((e as Error).message);}}}>Add returned item</Button>
    {lines.map((line,index) => <div key={index} className="flex items-center justify-between gap-2 text-sm"><span>{line.name} · {Math.abs(line.qty)} × {line.price.toFixed(2)}</span><Button variant="ghost" onClick={() => setLines(current => current.filter((_,i) => i!==index))}>Remove</Button></div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={!lines.length || busy} onClick={async () => {setBusy(true);setError("");try {await onAdd(legacyExchangeReference(receipt),lines);} catch(e) {setError((e as Error).message);} finally {setBusy(false);}}}>Use old POS credit</Button>
  </fieldset>;
}
