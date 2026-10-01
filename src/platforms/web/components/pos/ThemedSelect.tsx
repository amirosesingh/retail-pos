import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ThemedSelectOption = { value: string; label: string };

export function ThemedSelect({
  value,
  onChange,
  options,
  className,
  placeholder,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn("h-9 text-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
