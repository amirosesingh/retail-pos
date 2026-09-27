/** Public and recovery surfaces deliberately stay outside signed-in chrome. */
export function bypassPersistentAppShell(pathname: string): boolean {
  return (
    pathname === "/display" ||
    pathname === "/join" ||
    pathname === "/recovery" ||
    pathname === "/database-startup" ||
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/c/")
  );
}
