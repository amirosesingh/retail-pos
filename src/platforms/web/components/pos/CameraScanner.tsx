/**
 * Camera QR/barcode reader shared by pairing and stock lookups.
 *
 * Permission is requested up front so a blocked camera shows a readable
 * message instead of an empty black box, and on Android the native MLKit
 * reader is used because it handles EAN-13 far better than the web decoder.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";
import { ensureCameraPermission, isNativeApp, scanOnceNative } from "@/platforms/mobile/camera";

export function CameraScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose?: () => void;
}) {
  const domId = `qr-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const handled = useRef(false);
  const [error, setError] = useState("");

  const emit = useCallback(
    (value: string) => {
      if (handled.current) return;
      handled.current = true;
      onScan(value);
    },
    [onScan],
  );

  useEffect(() => {
    let scanner: { stop: () => Promise<void> } | null = null;
    let stopped = false;

    void (async () => {
      const permission = await ensureCameraPermission();
      if (stopped) return;
      if (!permission.ok) {
        setError(permission.reason ?? "The camera is not available.");
        return;
      }

      if (isNativeApp()) {
        try {
          const value = await scanOnceNative();
          if (!stopped && value) emit(value);
          else if (!stopped) onClose?.();
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : "Scanning failed.");
        }
        return;
      }

      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const instance = new Html5Qrcode(domId);
        scanner = instance as unknown as { stop: () => Promise<void> };
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // A square viewfinder cuts off long EAN/UPC and Code 128 labels.
            // Keep enough height for QR while using the available phone width.
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const width = Math.min(Math.floor(viewfinderWidth * 0.88), 360);
              return {
                width,
                height: Math.min(Math.floor(viewfinderHeight * 0.7), Math.floor(width * 0.7)),
              };
            },
          },
          (text) => {
            if (stopped || handled.current) return;
            void instance
              .stop()
              .catch(() => {})
              .then(() => emit(text));
          },
          () => {},
        );
      } catch {
        if (!stopped) setError("The camera could not be started. Close other apps using it and retry.");
      }
    })();

    return () => {
      stopped = true;
      void scanner?.stop().catch(() => {});
    };
  }, [domId, emit, onClose]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <CameraOff className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-black/80">
      <div id={domId} className="w-full" />
      <p className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Looking for a code…
      </p>
    </div>
  );
}
