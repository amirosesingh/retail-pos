/** Public and recovery surfaces deliberately stay outside signed-in chrome. */
export function bypassPersistentAppShell(pathname: string): boolean {
  return (
    pathname === "/display" ||
    pathname === "/join" ||
    pathname === "/membership" ||
    pathname === "/recovery" ||
    pathname === "/database-startup" ||
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/c/")
  );
}

/**
 * Customer-facing pages must not mount till-only providers or background
 * workers. Besides avoiding unnecessary protected queries, this prevents a
 * shared browser from exposing cashier, branch or active-shift details to a
 * member using the public portal.
 */
export function isCustomerPublicRoute(pathname: string): boolean {
  return (
    pathname === "/join" ||
    pathname === "/membership" ||
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/c/")
  );
}

/** Configuration stays reachable before the first location has been created. */
export function isLocationSetupRoute(pathname: string): boolean {
  return (
    pathname === "/stores" ||
    pathname.startsWith("/stores/") ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  );
}
