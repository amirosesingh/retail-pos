/** Native shells use the saved Display settings, never browser gesture zoom. */
export function installNativeZoomLock(target: Window, page: Document): () => void {
  const viewport = page.querySelector('meta[name="viewport"]');
  const previous = viewport?.getAttribute("content");
  viewport?.setAttribute("content", "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
  const touch = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
  const key = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0", "Subtract", "Add"].includes(event.key)) event.preventDefault();
  };
  const gesture = (event: Event) => event.preventDefault();
  target.addEventListener("wheel", wheel, { passive: false });
  target.addEventListener("touchmove", touch, { passive: false });
  target.addEventListener("keydown", key);
  target.addEventListener("gesturestart", gesture);
  return () => {
    target.removeEventListener("wheel", wheel);
    target.removeEventListener("touchmove", touch);
    target.removeEventListener("keydown", key);
    target.removeEventListener("gesturestart", gesture);
    if (previous !== null && previous !== undefined) viewport?.setAttribute("content", previous);
  };
}
