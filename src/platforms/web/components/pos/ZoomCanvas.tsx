/**
 * Zoom surface for the register.
 *
 * The till is laid out fluidly, so instead of clipping the content we give it
 * an inverse size (100 / zoom %) and use layout zoom to size it back down.
 * Unlike a transform, CSS zoom keeps nested scrolling in Chromium's normal
 * layout/paint path instead of promoting the entire register to one oversized
 * composited layer. Because inverse x zoom is always 100%, the scaled layout
 * fills the viewport exactly and never produces a second scrollbar.
 *
 * The zoom level itself is a saved preference (Settings, Display & sizing), so
 * it survives reloads instead of resetting every time the register opens.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  REGISTER_ZOOM_MAX,
  REGISTER_ZOOM_MIN,
  setUiScalePrefs,
  useUiScalePrefs,
} from "@/lib/use-ui-scale";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const MIN_ZOOM = REGISTER_ZOOM_MIN;
export const MAX_ZOOM = REGISTER_ZOOM_MAX;

export function ZoomCanvas({ children, className }: { children: ReactNode; className?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { registerZoom } = useUiScalePrefs();
  const scaleRef = useRef(registerZoom);
  scaleRef.current = registerZoom;

  // Ctrl/Cmd + wheel and trackpad pinch (which arrives as a ctrlKey wheel).
  // React's onWheel is passive, so the listener has to be attached natively.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const apply = (next: number) =>
      setUiScalePrefs({
        registerZoom: Number(clamp(next, REGISTER_ZOOM_MIN, REGISTER_ZOOM_MAX).toFixed(3)),
      });
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      apply(scaleRef.current * Math.exp(-dy * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const scale = clamp(registerZoom, REGISTER_ZOOM_MIN, REGISTER_ZOOM_MAX);
  const inverse = `${(100 / scale).toFixed(4)}%`;

  return (
    <div
      ref={viewportRef}
      className={`relative h-full min-h-0 w-full min-w-0 overflow-hidden ${className ?? ""}`}
    >
      <div
        style={{
          width: inverse,
          height: inverse,
          zoom: scale,
        }}
      >
        {children}
      </div>
    </div>
  );
}
