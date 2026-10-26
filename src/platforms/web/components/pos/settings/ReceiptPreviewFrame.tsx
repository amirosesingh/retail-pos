import { useEffect, useRef, useState } from "react";

/** Fit the preview to its content without changing the receipt's print layout. */
export function ReceiptPreviewFrame({ html, title }: { html: string; title: string }) {
  const [height, setHeight] = useState(320);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (
    <iframe
      title={title}
      srcDoc={html}
      className="block w-full border-0 bg-white"
      style={{ height, maxHeight: "70dvh" }}
      onLoad={event => {
        observer.current?.disconnect();
        const body = event.currentTarget.contentDocument?.body;
        if (!body) return;
        const measure = () => setHeight(Math.max(80, Math.ceil(body.getBoundingClientRect().height + Math.max(0, body.offsetTop) + 16)));
        measure();
        observer.current = new ResizeObserver(measure);
        observer.current.observe(body);
      }}
    />
  );
}
