/**
 * Always-visible barcode entry for the register. Hardware scanners behave like
 * a keyboard, so the input stays focused and a global capture also catches
 * fast bursts typed while the cursor is elsewhere on the page. On the phone
 * build an extra button opens the camera scanner.
 */
import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNativeApp, scanOnceNative } from "@/platforms/mobile/camera";

/** True when the user is typing into a real field, so we must not steal keys. */
function typingInField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function ScanBar({
  onScan,
  disabled,
  className,
  captureGlobal = true,
  autoFocus = true,
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  className?: string;
  captureGlobal?: boolean;
  autoFocus?: boolean;
}) {
  const [code, setCode] = useState("");
  const [hasCamera, setHasCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The in-field camera action belongs only to Android and iOS terminals.
  // Windows continues to use keyboard-wedge, USB or Bluetooth scanners.
  // Rendered after mount so the server and the browser agree on the markup.
  useEffect(() => {
    setHasCamera(isNativeApp());
  }, []);

  // Keyboard-wedge capture: a burst of characters ending with Enter is a scan.
  useEffect(() => {
    if (!captureGlobal) return;
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e.target)) return;
      // A background register scanner must not add products to the ticket
      // while a booking or another modal owns the keyboard.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const now = Date.now();
      if (now - last > 120) buffer = "";
      last = now;
      if (e.key === "Enter") {
        const value = buffer.trim();
        buffer = "";
        if (value.length >= 3) {
          e.preventDefault();
          onScan(value);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onScan, captureGlobal]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    onScan(value);
    setCode("");
    inputRef.current?.focus();
  };

  const cameraScan = async () => {
    if (!isNativeApp()) return;
    try {
      const value = await scanOnceNative();
      if (value) onScan(value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The camera is not available.");
    }
  };

  return (
    <form onSubmit={submit} className={className}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={code}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan or enter barcode…"
            aria-label="Scan barcode"
            className={`numeric h-10 pl-9 ${hasCamera ? "pr-12" : ""}`}
          />
          {hasCamera && (
            <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 right-1 my-auto size-8" aria-label="Scan barcode with camera" title="Scan barcode with camera" disabled={disabled} onClick={() => void cameraScan()}>
              <ScanBarcode className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
