import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  fetch: vi.fn(),
  functions: {
    loadSponsorships: vi.fn(),
    requestSponsorship: vi.fn(),
    handOverSponsorship: vi.fn(),
    loadSponsorshipDailyValues: vi.fn(),
    getSponsorshipAccess: vi.fn(),
    getSponsorshipDirectPolicy: vi.fn(),
    saveSponsorshipDirectPolicy: vi.fn(),
  },
}));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => mocks.native }));
vi.mock("../server-origin", () => ({ posFetch: mocks.fetch, serverOrigin: () => "https://app.example" }));
vi.mock("../sponsorship.functions", () => mocks.functions);
import * as client from "../sponsorship-client";
import { handleHostedFunctionRequest } from "../hosted-function-endpoint.server";

beforeEach(() => { vi.resetAllMocks(); mocks.native = true; });

const operations = Object.keys(mocks.functions) as (keyof typeof mocks.functions)[];
it.each(operations)("routes native %s to its guarded server operation exactly once", async name => {
  // Exercise the real endpoint dispatch behind the transport without live stock writes.
  const data = { sessionToken: "staff-proof", terminalToken: "terminal-proof" };
  const refusal = { ok: false, error: "Action permission required" };
  mocks.functions[name].mockResolvedValue(refusal);
  mocks.fetch.mockImplementation(async (_path: string, init: RequestInit) =>
    handleHostedFunctionRequest(new Request("https://app.example/api/v1/pos/sync?operation=app_function", init)),
  );
  const signal = new AbortController().signal;
  const call = client[name] as (input: { data: typeof data; signal: AbortSignal }) => Promise<unknown>;
  expect(await call({ data, signal })).toEqual(refusal);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0][1].signal).toBe(signal);
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: `sponsorship.${name}`, data });
  expect(mocks.functions[name]).toHaveBeenCalledExactlyOnceWith({ data });
  for (const other of operations.filter(other => other !== name)) {
    expect(mocks.functions[other]).not.toHaveBeenCalled();
  }
});
it.each(operations)("keeps web %s on the original server function", async name => {
  mocks.native = false;
  const data = { sessionToken: "staff-proof" };
  const result = { ok: true };
  mocks.functions[name].mockResolvedValue(result);
  const call = client[name] as (input: { data: typeof data }) => Promise<unknown>;
  expect(await call({ data })).toEqual(result);
  expect(mocks.functions[name]).toHaveBeenCalledExactlyOnceWith({ data });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
