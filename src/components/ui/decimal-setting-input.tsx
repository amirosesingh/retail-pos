import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "./input";

/** Preserve a typed decimal separator while the numeric setting updates. */
export function DecimalSettingInput({ value, onValueChange, allowNegative = false, normalizeValue, ...props }:
  Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
    value: number | undefined;
    onValueChange: (value: number) => void;
    allowNegative?: boolean;
    normalizeValue?: (value: number) => number;
  }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value ? String(value) : ""); }, [value]);
  return <Input {...props} inputMode="decimal" value={draft}
    onFocus={event => { editing.current = true; props.onFocus?.(event); }}
    onChange={event => {
      const text = event.target.value;
      const pattern = allowNegative ? /^-?\d*(?:[.,]\d*)?$/ : /^\d*(?:[.,]\d*)?$/;
      if (!pattern.test(text)) return;
      setDraft(text);
      const number = Number(text.replace(",", "."));
      if (Number.isFinite(number)) onValueChange(normalizeValue ? normalizeValue(number) : number);
    }}
    onBlur={event => {
      editing.current = false;
      const number = Number(draft.replace(",", "."));
      const parsed = Number.isFinite(number) ? number : value ?? 0;
      const next = normalizeValue ? normalizeValue(parsed) : parsed;
      setDraft(next ? String(next) : "");
      if (next !== value) onValueChange(next);
      props.onBlur?.(event);
    }} />;
}
