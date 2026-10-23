import { describe, expect, it } from "vitest";
import { appleAppAssociation } from "../apple-app-association";

const path = "/.well-known/apple-app-site-association";

describe("Apple Passwords association", () => {
  it("serves the sideloaded beta identity from the actual app Worker", async () => {
    const response = appleAppAssociation(
      new Request(`https://beta-pos.luckycharmsdnbhd.com${path}`), {},
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(await response?.json()).toEqual({
      webcredentials: { apps: ["SMRQRLSBA3.com.luckycharms.pos.beta"] },
    });
  });

  it("intercepts the request before the application router", async () => {
    const { default: server } = await import("../../server");
    const response = await server.fetch(
      new Request(`https://beta-pos.luckycharmsdnbhd.com${path}`), {}, {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      webcredentials: { apps: ["SMRQRLSBA3.com.luckycharms.pos.beta"] },
    });
  });

  it("does not associate production, membership or another HTTP method", () => {
    for (const host of ["pos.luckycharmsdnbhd.com", "beta-member.luckycharmsdnbhd.com"]) {
      expect(appleAppAssociation(new Request(`https://${host}${path}`), {})?.status).toBe(404);
    }
    expect(appleAppAssociation(new Request(`https://beta-pos.luckycharmsdnbhd.com${path}`, {
      method: "POST",
    }), {})?.status).toBe(404);
  });

  it("rejects a malformed operator override and leaves other routes alone", () => {
    const request = new Request(`https://beta-pos.luckycharmsdnbhd.com${path}`);
    expect(appleAppAssociation(request, { IOS_BETA_TEAM_ID: "bad" })?.status).toBe(404);
    expect(appleAppAssociation(new Request("https://beta-pos.luckycharmsdnbhd.com/"), {})).toBeNull();
  });
});
