// contextBridge makes window.pos non-writable in packaged Electron. Keep the
// authorized wrapper outside that property so database callers always use it.
const bridges = new Map<string, object>();
export function registerDesktopBridge(name: string, bridge: object): () => void {
  bridges.set(name, bridge);
  return () => { if (bridges.get(name) === bridge) bridges.delete(name); };
}
export function desktopBridge<T extends object>(name: string, fallback: T | null): T | null {
  return (bridges.get(name) as T | undefined) ?? fallback;
}
