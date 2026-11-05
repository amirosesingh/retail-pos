import { useState } from "react";
import { DecimalSettingInput } from "./decimal-setting-input";

/** Common choices without discarding existing or custom numeric values. */
export function PresetNumber({ value, onChange, options, label, disabled, min, max, step = 1 }: {
  value: number; onChange: (value: number) => void;
  options: { value: number; label: string }[]; label: string;
  disabled?: boolean; min: number; max: number; step?: number;
}) {
  const [custom, setCustom] = useState(false);
  const isCustom = custom || !options.some((option) => option.value === value);
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label={label} disabled={disabled} className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={isCustom ? "custom" : String(value)} onChange={(event) => {
        setCustom(event.target.value === "custom");
        if (event.target.value !== "custom") onChange(Number(event.target.value));
      }}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      <option value="custom">Custom…</option>
    </select>
    {isCustom && <DecimalSettingInput aria-label={`${label} custom value`} className="h-9 w-24"
      min={min} max={max} step={step} disabled={disabled} value={value}
      allowNegative={min < 0}
      normalizeValue={n => Math.max(min, Math.min(max, Math.round(n / step) * step))}
      onValueChange={onChange} />}
  </div>;
}
