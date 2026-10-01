import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useNodeOptions } from "@/platforms/web/components/pos/layout/node-options";

type ButtonProps = ComponentProps<typeof Button>;

export type ActionButtonProps = Omit<ButtonProps, "children"> & {
  /** Visible label — collapses to an icon-only button on narrow screens. */
  label: string;
  icon?: ReactNode;
  /** "stack" = icon above label (grid tiles), "inline" = icon beside label. */
  layout?: "stack" | "inline";
  /** Hide the text label and show only the icon (tooltip keeps the label). */
  iconOnly?: boolean;
  /** Explains why the control is unavailable, shown in place of the label. */
  disabledReason?: string;
};

/**
 * Fluid action button: icon plus label by default, sized by its own content so
 * it never overflows its row. Pass `iconOnly` for compact toolbars — the label
 * stays available through the tooltip and the accessible name.
 */
export function ActionButton({
  label: labelProp,
  icon: iconProp,
  layout = "stack",
  className,
  iconOnly = false,
  disabledReason,
  ...props
}: ActionButtonProps) {
  // An admin-customised canvas node can rename the control or drop its icon.
  const node = useNodeOptions();
  const label = node.label?.trim() ? node.label : labelProp;
  const icon = node.style === "text" ? null : iconProp;
  const forcedIconOnly = node.style === "icon";
  // Inside a canvas node the button fills the box: sizes come from the CSS
  // variables the node computes from its own size minus its padding.
  const fill = !!node.fill;
  const hideText = iconOnly || forcedIconOnly;
  // Touch devices have no hover — a long press (450ms) reveals the label.
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHeld(false);
  };
  const startHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeld(true), 450);
  };
  const tip = props.disabled && disabledReason ? `${label} — ${disabledReason}` : label;
  const control = (
    <div className="min-w-0 flex-1">
      <Button
        aria-label={label}
        {...(hideText || disabledReason ? { title: tip } : {})}
        onTouchStart={startHold}
        onTouchEnd={cancelHold}
        onTouchCancel={cancelHold}
        onTouchMove={cancelHold}
        className={cn(
          fill
            ? "h-full min-h-0 w-full min-w-0 p-0 text-[length:var(--node-font,12px)] [&_svg]:size-[var(--node-icon,16px)]"
            : "h-auto min-h-10 w-full min-w-0 px-2 py-2",
          layout === "stack" && !hideText ? "flex-col gap-1" : "justify-center gap-2",
          !fill && layout === "stack" ? "text-xs" : "",
          className,
        )}
        {...props}
      >
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
        {!hideText && (
          <span
            className={cn(
              "min-w-0 leading-tight",
              layout === "inline" ? "truncate whitespace-nowrap" : "line-clamp-2 break-words",
            )}
          >
            {label}
          </span>
        )}
      </Button>
    </div>
  );
  if (!hideText && !disabledReason) return control;
  return (
    <Tooltip {...(held ? { open: true } : {})} onOpenChange={(o) => !o && cancelHold()}>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}
