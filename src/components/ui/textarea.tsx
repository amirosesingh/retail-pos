import * as React from "react";

import { cn } from "@/lib/utils";
import { resolveFieldIdentity } from "@/lib/field-name";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    const reactId = React.useId();
    const identity = resolveFieldIdentity({
      id: props.id,
      name: props.name,
      ariaLabel: props["aria-label"],
      placeholder: props.placeholder,
      fallbackId: reactId,
    });
    return (
      <textarea
        className={cn(
          "pos-text-area flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
Textarea.displayName = "Textarea";

export { Textarea };
