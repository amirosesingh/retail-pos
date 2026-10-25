import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** A workbook choice happens before any row is staged or saved. */
export function useImportWorksheet(open: boolean) {
  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const pending = useRef<((name: string | null) => void) | null>(null);
  const finish = useCallback((name: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    setNames([]);
    resolve?.(name);
  }, []);
  useEffect(() => { if (!open) finish(null); }, [open, finish]);
  useEffect(() => () => { pending.current?.(null); pending.current = null; }, []);
  const chooseWorksheet = useCallback((sheets: string[]) => new Promise<string | null>(resolve => {
    pending.current?.(null);
    pending.current = resolve;
    setSelected(sheets[0] ?? "");
    setNames(sheets);
  }), []);
  const worksheetDialog = <Dialog open={names.length > 0} onOpenChange={value => { if (!value) finish(null); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Choose a worksheet</DialogTitle><DialogDescription>Select the sheet containing the rows you want to import.</DialogDescription></DialogHeader>
      <Label htmlFor="import-worksheet">Worksheet</Label>
      <select id="import-worksheet" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={event => setSelected(event.target.value)}>
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => finish(null)}>Cancel</Button><Button disabled={!names.includes(selected)} onClick={() => finish(selected)}>Use this sheet</Button></div>
    </DialogContent>
  </Dialog>;
  return { chooseWorksheet, worksheetDialog };
}
