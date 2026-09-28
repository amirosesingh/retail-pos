import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AnimatedItemPhase = "entering" | "present" | "exiting";
export type AnimatedItem<T> = { key: string; item: T; phase: AnimatedItemPhase };

export function useAnimatedItems<T extends object>(items: T[], getKey: (item: T) => string) {
  const [rendered, setRendered] = useState<AnimatedItem<T>[]>(() =>
    items.map((item) => ({ key: getKey(item), item, phase: "entering" })),
  );

  useEffect(() => {
    setRendered((current) => {
      const incoming = new Map(items.map((item) => [getKey(item), item]));
      const currentByKey = new Map(current.map((row) => [row.key, row]));
      const removing = current.some((row) => !incoming.has(row.key) && row.phase !== "exiting");

      // Keep departing rows in their current position until their exit animation
      // completes. With no removals, follow the incoming order so newly arrived
      // notifications appear in their correct newest-first position.
      const next = removing
        ? current.map((row) => {
            const item = incoming.get(row.key);
            return item
              ? { ...row, item, phase: row.phase === "exiting" ? "entering" as const : row.phase }
              : { ...row, phase: "exiting" as const };
          })
        : items.map((item) => {
            const key = getKey(item);
            const existing = currentByKey.get(key);
            return existing
              ? { ...existing, item, phase: existing.phase === "exiting" ? "entering" : existing.phase }
              : { key, item, phase: "entering" as const };
          });

      if (removing) {
        const known = new Set(next.map((row) => row.key));
        for (const item of items) {
          const key = getKey(item);
          if (!known.has(key)) next.push({ key, item, phase: "entering" });
        }
      }

      const unchanged =
        next.length === current.length &&
        next.every(
          (row, index) =>
            row.key === current[index]?.key &&
            row.item === current[index]?.item &&
            row.phase === current[index]?.phase,
        );
      return unchanged ? current : next;
    });
  }, [getKey, items]);

  // `animationend` is the normal completion path. The timer also settles the
  // list in reduced-motion/webview edge cases where animation events can be
  // skipped while a tab or popover is being hidden.
  useEffect(() => {
    if (!rendered.some((row) => row.phase !== "present")) return;
    const timer = window.setTimeout(() => {
      setRendered((current) =>
        current
          .filter((row) => row.phase !== "exiting")
          .map((row) => (row.phase === "entering" ? { ...row, phase: "present" } : row)),
      );
    }, 320);
    return () => window.clearTimeout(timer);
  }, [rendered]);

  const settle = (key: string, phase: AnimatedItemPhase) => {
    setRendered((current) =>
      phase === "exiting"
        ? current.filter((row) => row.key !== key)
        : current.map((row) => (row.key === key ? { ...row, phase: "present" } : row)),
    );
  };

  return { rendered, settle };
}

export function AnimatedList<T extends object>({
  items,
  getKey,
  renderItem,
  empty,
  className,
}: {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const { rendered, settle } = useAnimatedItems(items, getKey);

  if (!rendered.length) return <>{empty}</>;

  return (
    <div className={cn("ui-animated-list", className)}>
      {rendered.map((row) => (
        <div
          key={row.key}
          className="ui-animated-list-item"
          data-state={row.phase}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) settle(row.key, row.phase);
          }}
        >
          <div className="ui-animated-list-item-inner">{renderItem(row.item)}</div>
        </div>
      ))}
    </div>
  );
}
