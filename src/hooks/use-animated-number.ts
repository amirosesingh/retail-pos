import { useEffect, useRef, useState } from "react";

/** Animate a KPI from its previous value (zero on first display) to the latest total. */
export function useAnimatedNumber(value: number, duration = 650): number {
  const safeValue = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      previous.current = safeValue;
      setDisplay(safeValue);
      return;
    }
    const from = previous.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (safeValue - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = safeValue;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, safeValue]);

  return display;
}
