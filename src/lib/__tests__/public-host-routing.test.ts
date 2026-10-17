import { beforeEach, describe, expect, it, vi } from "vitest";
import { configuredPublicHost, publicHostPage } from "../public-host-routing";
const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest }));
import { readPublicHostConfigServer } from "../public-host-config.server";

const config = { member: "https://member.example.com", redeem: "redeem.example.com" };
const member = configuredPublicHost("member.example.com", config);
const redeem = configuredPublicHost("redeem.example.com", config);
const off = { member: false, redeem: false };
const on = { member: true, redeem: true };
beforeEach(() => { vi.resetAllMocks(); });

describe("separate POS and public subdomains", () => {
  it.each(["pos.example.com", "example.com", "preview.example.com", "member.example.com.attacker.test"])("preserves the current POS at %s with public switches off or on", (host) => {
    expect(publicHostPage(configuredPublicHost(host, config), "/", off)).toBe("pos");
    expect(publicHostPage(configuredPublicHost(host, config), "/inventory", on)).toBe("pos");
  });
  it("matches configured hosts case-insensitively and retains explicit ports", () => {
    expect(configuredPublicHost("MEMBER.EXAMPLE.COM", config)).toEqual(member);
    expect(configuredPublicHost("localhost:3000", { member: "http://localhost:3000/join", redeem: "" }).member).toBe(true);
    expect(configuredPublicHost("localhost:4000", { member: "http://localhost:3000", redeem: "" }).member).toBe(false);
  });
  it.each(["/", "/join", "/membership", "/inventory", "/settings"])("keeps disabled membership on its public closed surface at %s", (path) => {
    expect(publicHostPage(member, path, off)).toBe("closed");
  });
  it.each(["/", "/c/personal-token", "/claim/campaign", "/staff"])("keeps disabled vouchers outside the POS at %s", (path) => {
    expect(publicHostPage(redeem, path, off)).toBe("closed");
  });
  it("does not send voucher visitors to membership signup", () => {
    expect(publicHostPage(member, "/", on)).toBe("member-root");
    expect(publicHostPage(redeem, "/", on)).toBe("voucher-root");
    expect(publicHostPage(redeem, "/join", on)).toBe("closed");
    expect(publicHostPage(member, "/c/personal-token", on)).toBe("closed");
  });
  it("retains enabled customer deep links and independent switches", () => {
    expect(publicHostPage(member, "/membership", { member: true, redeem: false })).toBe("customer");
    expect(publicHostPage(redeem, "/claim/campaign", { member: false, redeem: true })).toBe("customer");
    expect(publicHostPage(redeem, "/c/personal-token", on)).toBe("customer");
    expect(publicHostPage(redeem, "/c/personal-token/extra", on)).toBe("closed");
  });
});

describe("anonymous host configuration", () => {
  it("returns only public domains, without exposing integration secrets", async () => {
    rest.mockResolvedValue({ ok: true, json: async () => [{ integration_settings: { memberDomain: config.member, redeemDomain: config.redeem, whatsappApiKey: "never-public", webhookSecret: "never-public" } }] });
    expect(await readPublicHostConfigServer()).toEqual(config);
    expect(rest.mock.calls[0][0]).toBe("pos_settings?id=eq.1&select=integration_settings&limit=1");
  });
  it("retains the POS when public hosts have not been configured", async () => {
    rest.mockResolvedValue({ ok: true, json: async () => [{ integration_settings: null }] });
    const empty = await readPublicHostConfigServer();
    expect(empty).toEqual({ member: "", redeem: "" });
    expect(publicHostPage(configuredPublicHost("pos.example.com", empty), "/", off)).toBe("pos");
  });
  it("does not treat a failed configuration read as permission to show a POS login", async () => {
    rest.mockResolvedValue({ ok: false });
    await expect(readPublicHostConfigServer()).rejects.toThrow("site configuration");
  });
});
