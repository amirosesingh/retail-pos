// Domain routing only. Application code and sealed backend configuration remain
// on the existing beta version preview; production routes never enter here.
const UPSTREAM = new URL("https://beta-retail-pos.amirosesingh.workers.dev");
const HOSTS = new Set([
  "beta-pos.luckycharmsdnbhd.com",
  "beta-member.luckycharmsdnbhd.com",
  "beta-redeem.luckycharmsdnbhd.com",
]);

export async function routeBeta(request, fetchUpstream = fetch, env = {}) {
  const original = new URL(request.url);
  if (!HOSTS.has(original.hostname)) return new Response("Not found", { status: 404 });
  if (original.hostname === "beta-pos.luckycharmsdnbhd.com" &&
      original.pathname === "/.well-known/apple-app-site-association") {
    // Sideloadly signs with the owner's Apple Team ID, which is not known to
    // this source tree. Never publish a guessed app identifier to Apple.
    const teamId = String(env.IOS_BETA_TEAM_ID ?? "").trim();
    if (!/^[A-Z0-9]{10}$/.test(teamId)) return new Response("Not configured", { status: 404 });
    return new Response(JSON.stringify({ webcredentials: { apps: [`${teamId}.com.luckycharms.pos.beta`] } }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  }
  const target = new URL(original.pathname + original.search, UPSTREAM);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cloudflare-workers-version-overrides");
  // Translate only an already same-origin browser request. An external Origin
  // remains external, so the application's existing CSRF checks still reject it.
  if (headers.get("origin") === original.origin) headers.set("origin", UPSTREAM.origin);
  const referrer = headers.get("referer");
  if (referrer) {
    try {
      const url = new URL(referrer);
      if (url.origin === original.origin) headers.set("referer", new URL(url.pathname + url.search, UPSTREAM).href);
    } catch { /* Preserve malformed/external referrers for the upstream checks. */ }
  }
  const upstream = await fetchUpstream(new Request(target, new Request(request, { headers, redirect: "manual" })));
  const response = new Response(upstream.body, upstream);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const location = response.headers.get("location");
  if (location) {
    const url = new URL(location, UPSTREAM);
    if (url.origin === UPSTREAM.origin) response.headers.set("location", new URL(url.pathname + url.search + url.hash, original.origin).href);
  }
  return response;
}

export default { fetch: (request, env) => routeBeta(request, fetch, env) };
