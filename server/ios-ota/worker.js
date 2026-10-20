// Mount only /pos-app/ios-ota/* on the existing update host. No database secrets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" } });
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
    const manifest = /^\/pos-app\/ios-ota\/(staging|production)\/manifest\.json$/.test(url.pathname);
    const bundle = /^\/pos-app\/ios-ota\/releases\/[0-9A-Za-z.+-]+\/bundle\.zip$/.test(url.pathname);
    if (!manifest && !bundle) return new Response("Not found", { status: 404 });
    if (manifest && env.OTA_STOP === "true") return new Response("Updates temporarily paused", { status: 503, headers: { ...headers, "Cache-Control": "no-store" } });
    const object = await env.OTA_BUCKET.get(url.pathname.slice(1));
    if (!object) return new Response("Not found", { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
    return new Response(request.method === "HEAD" ? null : object.body, { headers: { ...headers, "Content-Type": manifest ? "application/json" : "application/zip", "Content-Length": String(object.size), "Cache-Control": manifest ? "no-store" : "public,max-age=31536000,immutable", "ETag": object.httpEtag } });
  }
};
