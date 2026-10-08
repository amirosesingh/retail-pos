import { useDeferredValue, useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { boundedSelectOptions } from "@/lib/bounded-select";
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const page = useMemo(
    () => boundedSelectOptions(options, deferredQuery),
    [options, deferredQuery],
  );
  if (options.length > 100) {
    const selected = options.find((option) => option.value === value);
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn("h-9 w-full justify-between text-sm font-normal", className)}
          >
            <span className="truncate">{selected?.label ?? placeholder ?? "Select…"}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search all options…"
              aria-label={ariaLabel ? `Search ${ariaLabel}` : "Search options"}
            />
            <CommandList>
              <CommandEmpty>No matching options.</CommandEmpty>
              {page.items.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandList>
            {page.hasMore && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing first 100 matches. Type to narrow the results.
              </p>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
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
