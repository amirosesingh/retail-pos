import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ConfidentialClientApplication } = require("@azure/msal-node");
afterEach(() => vi.restoreAllMocks());

it("drops untrusted authorization response routing before the shared token exchange", async () => {
  const parent = Object.getPrototypeOf(ConfidentialClientApplication.prototype);
  const exchange = vi.spyOn(parent, "acquireTokenByCode").mockResolvedValue(null);
  const client = new ConfidentialClientApplication({ auth: { clientId: "test-client", clientSecret: "test-only" } });
  const request = { code: "trusted-code", scopes: ["scope"], redirectUri: "http://localhost", nonce: "trusted-nonce" };
  await client.acquireTokenByCode(request, {
    code: "replaced-code", state: "state", nonce: "replaced-nonce",
    cloud_instance_host_name: "attacker.invalid", cloud_instance_name: "attacker.invalid",
  });
  expect(exchange).toHaveBeenCalledWith(request, { code: "trusted-code", state: "state", nonce: "trusted-nonce" });
  exchange.mockClear();
  await client.acquireTokenByCode(request);
  expect(exchange).toHaveBeenCalledWith(request, undefined);
});

it("rejects instance-aware confidential auth requests before network access", async () => {
  const client = new ConfidentialClientApplication({ auth: { clientId: "test-client", clientSecret: "test-only" } });
  await expect(client.getAuthCodeUrl({ scopes: ["scope"], redirectUri: "http://localhost", extraQueryParameters: { instance_aware: "true" } }))
    .rejects.toMatchObject({ errorCode: "unsupported_cca_instance_aware" });
});

it("keeps Azure credential and portable SQL module contracts loadable", () => {
  const identity = require("@azure/identity");
  expect(typeof new identity.ClientSecretCredential("tenant", "client", "test-only").getToken).toBe("function");
  expect(typeof require("tedious").Connection).toBe("function");
});

it.runIf(process.platform === "win32")("keeps the Windows native SQL driver loadable", () => {
  expect(typeof require("mssql/msnodesqlv8").ConnectionPool).toBe("function");
});
