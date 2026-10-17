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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RegisterZoomFitContext } from "@/lib/register-zoom-context";
import {
  REGISTER_ZOOM_MAX,
  REGISTER_ZOOM_MIN,
  useUiScalePrefs,
} from "@/lib/use-ui-scale";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const MIN_ZOOM = REGISTER_ZOOM_MIN;
export const MAX_ZOOM = REGISTER_ZOOM_MAX;

export function ZoomCanvas({ children, className }: { children: ReactNode; className?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWorkspace, setFitWorkspace] = useState(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !fitWorkspace) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWorkspace]);
  const { registerZoom } = useUiScalePrefs();

  const scale = clamp(registerZoom, REGISTER_ZOOM_MIN, REGISTER_ZOOM_MAX);
  const inverse = `${(100 / scale).toFixed(4)}%`;

  return (
    <div
      ref={viewportRef}
      className={`relative h-full min-h-0 w-full min-w-0 overflow-hidden ${className ?? ""}`}
    >
      <div
        style={{
          width: fitWorkspace && viewport.width ? viewport.width / scale : inverse,
          height: fitWorkspace && viewport.height ? viewport.height / scale : inverse,
          zoom: scale,
        }}
      >
        <RegisterZoomFitContext.Provider value={setFitWorkspace}>
          {children}
        </RegisterZoomFitContext.Provider>
      </div>
    </div>
  );
}
