import * as React from "react";

import { cn } from "@/lib/utils";
import { resolveFieldIdentity } from "@/lib/field-name";

// Types where an auto-generated name could change form semantics.
const UNMANAGED_TYPES = new Set([
  "hidden",
  "file",
  "submit",
  "button",
  "reset",
  "radio",
  "checkbox",
  "image",
]);

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const reactId = React.useId();
    const managed = !UNMANAGED_TYPES.has(type ?? "text");
    const identity = managed
      ? resolveFieldIdentity({
          id: props.id,
          name: props.name,
          ariaLabel: props["aria-label"],
          placeholder: props.placeholder,
          fallbackId: reactId,
        })
      : { id: props.id, name: props.name };
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-base shadow-none transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-fast)] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none motion-reduce:transition-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          managed && type !== "range" && "pos-text-field",
          className,
        )}
        ref={ref}
        {...props}
        id={identity.id}
        name={identity.name}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
