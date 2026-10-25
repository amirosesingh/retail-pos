import type { ReactNode } from "react";
import { useVisibility } from "@/lib/ui-visibility";

/** Presentation only; the owning page still enforces its data/action access. */
export function DisplayElement({ name, children }: { name: string; children: ReactNode }) {
  const { visible } = useVisibility();
  return visible(name) ? children : null;
}
