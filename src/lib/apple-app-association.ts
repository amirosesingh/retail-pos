/** Public Apple Passwords association for the currently sideloaded beta identity. */
const BETA_SIGNING_TEAM_ID = "SMRQRLSBA3";
const BETA_HOST = "beta-pos.luckycharmsdnbhd.com";
const ASSOCIATION_PATH = "/.well-known/apple-app-site-association";

export function appleAppAssociation(request: Request, runtimeEnv: unknown): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== ASSOCIATION_PATH) return null;
  // The stable site must never claim the beta bundle identifier.
  if (url.hostname !== BETA_HOST || request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }
  const env = runtimeEnv && typeof runtimeEnv === "object"
    ? runtimeEnv as Record<string, unknown> : {};
  const configured = env.IOS_BETA_TEAM_ID;
  const teamId = configured === undefined ? BETA_SIGNING_TEAM_ID : configured;
  if (typeof teamId !== "string" || !/^[A-Z0-9]{10}$/.test(teamId)) {
    return new Response("Not configured", { status: 404 });
  }
  return Response.json(
    { webcredentials: { apps: [`${teamId}.com.luckycharms.pos.beta`] } },
    { headers: { "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex" } },
  );
}
