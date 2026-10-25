import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { readNumber } from "@/lib/product-import";
import { displayImportMoney } from "@/lib/import-money-format";

/** Preserve an in-progress decimal separator; never round stored import values. */
export function ImportMoneyInput({ value, onValueChange, ...props }: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onFocus" | "onBlur"> & {
  value: number | null; onValueChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => displayImportMoney(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(displayImportMoney(value)); }, [value]);
  return <Input {...props} inputMode="decimal" value={text} onFocus={() => { focused.current = true; }}
    onChange={event => {
      const next = event.target.value;
      setText(next);
      onValueChange(next.trim() === "" ? null : readNumber(next) ?? Number.NaN);
    }} onBlur={() => { focused.current = false; if (Number.isFinite(value) || value === null) setText(displayImportMoney(value)); }} />;
}
