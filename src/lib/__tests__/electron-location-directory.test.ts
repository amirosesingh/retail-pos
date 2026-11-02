import { describe, it, expect, vi } from "vitest";
import {
  locationReadError,
  readLocalLocationDirectory,
  resolveLocationDirectory,
  verifyTerminalLocation,
  canSelectLocation,
  selectedLocation,
  type LocationDirectoryResult,
} from "@/core/api/location-directory";
import { createBootstrapRecovery } from "@/lib/data-read-attempt";
import type { Store } from "@/core/types/pos-types";

const store = { id: "paired-branch", name: "Branch", active: true } as Store;
const mapStore = (row: Record<string, unknown>) => row as unknown as Store;
const cloudResult: LocationDirectoryResult = { ok: true, stores: [store], source: "relay" };

function bridgeFor(
  state: { enabled: boolean; connected: boolean; tradingReady?: boolean },
  query = vi.fn(async () => ({ ok: true, rows: [store] })),
) {
  return { database: { getState: vi.fn(async () => ({ ...state, state: "connected" })) }, query };
}

describe("Electron location discovery", () => {
  it("preserves a transient SDK directory error for bounded recovery", () => {
    let now = 1000;
    const recovery = createBootstrapRecovery(() => now);
    recovery.failed(locationReadError({ message: "Schema cache unavailable", code: "PGRST002" }), 1);
    now += 30_001;
    expect(recovery.healthy({ cloud: true, at: now }, 1)).toBe(true);
  });

  it("preserves permission refusals instead of retrying them as outages", () => {
    let now = 1000;
    const recovery = createBootstrapRecovery(() => now);
    const error = locationReadError({ message: "Access denied", code: "42501", status: 403 });
    expect(error).toMatchObject({ code: "42501", status: 403 });
    recovery.failed(error, 1);
    now += 30_001;
    expect(recovery.healthy({ cloud: true, at: now }, 1)).toBe(false);
  });
  it.each([
    { enabled: false, connected: false },
    { enabled: true, connected: false },
    { enabled: true, connected: true, tradingReady: false },
  ])("uses verified cloud discovery when local SQL is unavailable: %j", async (state) => {
    const bridge = bridgeFor(state);
    const cloud = vi.fn(async () => cloudResult);
    expect(
      await resolveLocationDirectory(
        () => readLocalLocationDirectory(bridge, true, mapStore),
        cloud,
      ),
    ).toEqual(cloudResult);
    expect(bridge.query).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledOnce();
  });

  it("recovers from an unpaired branch read without widening local scope", async () => {
    const query = vi.fn(async () => ({
      ok: false,
      rows: [],
      error: "The terminal branch is not configured.",
      code: "EBRANCH",
    }));
    const cloud = vi.fn(async () => cloudResult);
    const bridge = bridgeFor({ enabled: true, connected: true, tradingReady: true }, query);
    expect(
      await resolveLocationDirectory(
        () => readLocalLocationDirectory(bridge, true, mapStore),
        cloud,
      ),
    ).toEqual(cloudResult);
    expect(query).toHaveBeenCalledExactlyOnceWith("stores", { limit: 2000 });
  });

  it("recovers if the IPC connection or state read rejects during startup", async () => {
    const local = vi.fn(async () => {
      throw new Error("SQL disconnected");
    });
    expect(await resolveLocationDirectory(local, async () => cloudResult)).toEqual(cloudResult);
  });

  it("corroborates an empty replica instead of claiming there are no locations", async () => {
    const bridge = bridgeFor(
      { enabled: true, connected: true },
      vi.fn(async () => ({ ok: true, rows: [] })),
    );
    expect(
      await resolveLocationDirectory(
        () => readLocalLocationDirectory(bridge, true, mapStore),
        async () => cloudResult,
      ),
    ).toEqual(cloudResult);
  });

  it("uses a populated ready local directory without unnecessary cloud requests", async () => {
    const bridge = bridgeFor({ enabled: true, connected: true, tradingReady: true });
    const cloud = vi.fn(async () => cloudResult);
    expect(
      await resolveLocationDirectory(
        () => readLocalLocationDirectory(bridge, true, mapStore),
        cloud,
      ),
    ).toEqual({ ...cloudResult, source: "local" });
    expect(cloud).not.toHaveBeenCalled();
  });

  it("does not let the Electron bridge hijack explicitly online startup", async () => {
    const bridge = bridgeFor({ enabled: true, connected: true });
    expect(await readLocalLocationDirectory(bridge, false, mapStore)).toBeNull();
    expect(bridge.database.getState).not.toHaveBeenCalled();
    expect(bridge.query).not.toHaveBeenCalled();
  });

  it("preserves a verified empty answer and does not hide failures as empty data", async () => {
    const empty: LocationDirectoryResult = { ok: true, stores: [], source: "direct" };
    expect(
      await resolveLocationDirectory(
        async () => null,
        async () => empty,
      ),
    ).toEqual(empty);
    const error: LocationDirectoryResult = { ok: false, error: new Error("Session denied") };
    expect(
      await resolveLocationDirectory(
        async () => ({ ok: false, error: new Error("EBRANCH") }),
        async () => error,
      ),
    ).toEqual(error);
  });
});

it("does not replace a registered branch with an unrelated, missing or archived location", () => {
  expect(verifyTerminalLocation(cloudResult, "different-branch").ok).toBe(false);
  expect(verifyTerminalLocation(cloudResult, store.id)).toEqual(cloudResult);
  expect(
    verifyTerminalLocation(
      { ok: true, stores: [{ ...store, active: false }], source: "local" },
      store.id,
    ).ok,
  ).toBe(false);
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const result: LocationDirectoryResult = {
    ok: true,
    stores: [{ ...store, id: uuid }],
    source: "relay",
  };
  expect(verifyTerminalLocation(result, uuid.toUpperCase())).toEqual(result);
});

it("falls back to the paired cloud branch if the local replica only contains an unrelated branch", async () => {
  const local: LocationDirectoryResult = {
    ok: true,
    stores: [{ ...store, id: "other" }],
    source: "local",
  };
  expect(
    await resolveLocationDirectory(
      async () => local,
      async () => cloudResult,
      store.id,
    ),
  ).toEqual(cloudResult);
});

it("keeps staff on the terminal branch while allowing admin branch views", () => {
  expect(canSelectLocation("other", store.id, false)).toBe(false);
  expect(canSelectLocation(store.id, store.id, false)).toBe(true);
  expect(canSelectLocation("other", store.id, true)).toBe(true);
});

it("keeps registered operations tills branch-pinned even for a user allowed management switching", () => {
  expect(canSelectLocation("other", store.id, true, store.id)).toBe(false);
  expect(canSelectLocation(store.id, store.id, true, store.id)).toBe(true);
  expect(canSelectLocation("other", store.id, true, null)).toBe(true);
});
it("never substitutes an unrelated directory entry for an explicit or registered branch", () => {
  expect(selectedLocation([store], "missing")).toBeUndefined();
  expect(selectedLocation([store], store.id, "registered-missing")).toBeUndefined();
  expect(selectedLocation([store], "")).toBe(store);
  expect(selectedLocation([store], store.id)).toBe(store);
});
