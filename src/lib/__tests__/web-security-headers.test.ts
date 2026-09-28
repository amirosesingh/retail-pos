import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, withWebSecurityHeaders } from "../web-security-headers";

describe("hosted application security headers", () => {
  it("allows app and Cloudflare Insights scripts plus required connections", () => {
    const policy = contentSecurityPolicy("https://project-ref.supabase.co/path");
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    );
    expect(policy).toContain(
      "script-src-elem 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain(
      "connect-src 'self' https://cloudflareinsights.com https://project-ref.supabase.co wss://project-ref.supabase.co",
    );
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("preserves the response while applying browser protections", async () => {
    const secured = withWebSecurityHeaders(
      new Response("ready", {
        status: 202,
        headers: { "content-type": "text/plain", "x-existing": "kept" },
      }),
      "https://project-ref.supabase.co",
    );

    expect(secured.status).toBe(202);
    expect(secured.headers.get("x-existing")).toBe("kept");
    expect(secured.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await secured.text()).toBe("ready");
  });

  it("forces HTML to revalidate without changing API cache policy", () => {
    const html = withWebSecurityHeaders(
      new Response("<main>ready</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const api = withWebSecurityHeaders(
      new Response("{}", {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      }),
    );

    expect(html.headers.get("cache-control")).toBe("no-cache, must-revalidate");
    expect(api.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
