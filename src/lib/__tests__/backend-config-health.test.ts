import { afterEach, describe, expect, it, vi } from "vitest";
import { testBackendUrl } from "../backend-config";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function health(body: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async () => Response.json(body)) as typeof fetch;
}

describe("POS backend health", () => {
  it("keeps POS available when the independent membership gateway is missing", async () => {
    health({ serviceKey: true, posUrl: true, membershipService: false });
    const result = await testBackendUrl("https://pos.example.com");
    expect(result).toMatchObject({ ok: true, warn: true });
    expect(result.detail).toContain("POS database connected");
  });

  it("still rejects a backend without its POS database configuration", async () => {
    health({ serviceKey: true, posUrl: false, membershipService: true });
    expect(await testBackendUrl("https://pos.example.com")).toMatchObject({ ok: false, warn: true });
    health({ serviceKey: false, posUrl: true, membershipService: true });
    expect(await testBackendUrl("https://pos.example.com")).toMatchObject({ ok: false, warn: true });
  });
});
