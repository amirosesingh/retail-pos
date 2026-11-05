import { useEffect, useRef, useState } from "react";

/** Preserve the print layout and scale the complete paper to the preview width. */
export function ReceiptPreviewFrame({ html, title, paperWidth }: { html: string; title: string; paperWidth: string }) {
  const [height, setHeight] = useState(320);
  const width = Number.parseFloat(paperWidth) * 96 / 25.4;
  const [availableWidth, setAvailableWidth] = useState(width);
  const viewport = useRef<HTMLDivElement>(null);
  const cleanupBody = useRef<() => void>(() => {});
  useEffect(() => {
    const measure = () => { if (viewport.current) setAvailableWidth(viewport.current.clientWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); cleanupBody.current(); };
  }, []);
  const scale = Math.min(1, availableWidth / width);
  return (
    <div ref={viewport} className="relative w-full overflow-x-hidden overflow-y-auto" style={{ height: Math.ceil(height * scale), maxHeight: "70dvh" }}>
      <iframe title={title} srcDoc={html} className="absolute top-0 block border-0 bg-white"
        style={{ width, height, left: "50%", marginLeft: -width / 2, transform: `scale(${scale})`, transformOrigin: "top center" }}
        onLoad={event => {
          cleanupBody.current();
          const doc = event.currentTarget.contentDocument;
          const body = doc?.body;
          if (!body) return;
          let live = true;
          let frame: number | null = null;
          const measure = () => {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              frame = null;
              if (live) setHeight(Math.max(80, Math.ceil(body.getBoundingClientRect().height + Math.max(0, body.offsetTop) + 16)));
            });
          };
          measure();
          body.addEventListener("load", measure, true);
          void doc.fonts.ready.then(() => { if (live) measure(); });
          cleanupBody.current = () => { live = false; body.removeEventListener("load", measure, true); if (frame !== null) cancelAnimationFrame(frame); };
        }} />
    </div>
  );
}
