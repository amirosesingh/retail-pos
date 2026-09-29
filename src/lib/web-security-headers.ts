/**
 * Browser security headers for the hosted application.
 *
 * TanStack streams a small bootstrap script into the HTML response, so inline
 * scripts are currently required. External scripts stay restricted to this
 * origin, and browser connections are limited to the app and its configured
 * Supabase project.
 */
export function contentSecurityPolicy(supabaseUrl?: string): string {
  const connections = new Set(["'self'", "https://cloudflareinsights.com"]);
  if (supabaseUrl) {
    try {
      const origin = new URL(supabaseUrl).origin;
      connections.add(origin);
      const socket = new URL(origin);
      socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
      connections.add(socket.origin);
    } catch {
      // Invalid configuration is reported by the existing setup flow. It must
      // never widen the browser policy while that flow is being displayed.
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "script-src-elem 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...connections].join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
  ].join("; ");
}

/** Clone a response with the hosted application's security boundary applied. */
export function withWebSecurityHeaders(response: Response, supabaseUrl?: string): Response {
  const headers = new Headers(response.headers);
  // The POS owns one enforced policy. Drop any report-only policy inherited
  // from an upstream renderer or proxy so browsers do not emit misleading
  // violations for resources that the enforced policy intentionally allows.
  headers.delete("Content-Security-Policy-Report-Only");
  if ((headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
    // HTML names the current build's content-hashed chunks. It must be
    // revalidated after every navigation/deployment; otherwise an old page
    // can ask a new Workers deployment for chunks that no longer exist.
    headers.set("Cache-Control", "no-cache, must-revalidate");
  }
  headers.set("Content-Security-Policy", contentSecurityPolicy(supabaseUrl));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
