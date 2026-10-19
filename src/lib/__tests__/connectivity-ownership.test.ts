import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("connectivity lifecycle ownership", () => {
  const root = read("src/routes/__root.tsx");
  const loader = read("src/components/shared/TillLoader.tsx");
  const gate = read("src/platforms/mobile/components/OfflineGate.tsx");
  const sync = read("src/lib/sync-engine.ts");
  const health = read("src/core/activation/connection-health.ts");
  const auth = read("src/lib/pos-auth.tsx");
  const store = read("src/lib/pos-store.tsx");

  it("has one app-level owner and no screen-level owners", () => {
    expect(root).toContain("startConnectivityMonitor");
    expect(root).toContain("subscribeSyncConfig");

    expect(loader).not.toContain("startConnectivityMonitor");
    expect(gate).not.toContain("startConnectivityMonitor");
    expect(sync).not.toContain("startConnectivityMonitor");
  });

  it("keeps consumers subscribed without owning the heartbeat", () => {
    expect(loader).toContain("subscribeConnectivity");
    expect(gate).toContain("subscribeConnectivity");
    expect(sync).toContain("subscribeConnectivity");
  });

  it("keeps manual retry and reconnect wake behaviour", () => {
    expect(gate).toContain("heartbeat()");
    expect(sync).toContain('runExclusive("network")');
    expect(sync).toContain('announceSettingsChange("reconnect")');
  });

  it("recovers automatically after browser and native foreground transitions", () => {
    expect(health).toContain('window.addEventListener("focus", resume)');
    expect(health).toContain('document.addEventListener("visibilitychange", resume)');
    expect(health).toContain('App.addListener("appStateChange"');
    expect(root).toContain("CONNECTIVITY_RESTORED_EVENT");
    expect(root).toContain('queryClient.refetchQueries({ type: "active" })');
    expect(auth).toContain("APP_RESUME_EVENT");
    expect(store).toContain("APP_RESUME_EVENT");
  });

  it("opens terminal setup before network gating only after local settings are confirmed absent", () => {
    expect(root).toContain('if (!isTerminalApp() || isRecoveryPath(pathname)) return children');
    expect(root).toContain('profile.state === "missing" || profile.state === "incomplete"');
    expect(root.indexOf("<TerminalConnectionSetup>")).toBeLessThan(root.indexOf("<OfflineGate>"));
    expect(root).toContain('if (!profile) return <TillLoader');
    expect(root).toContain('cloudConfigured={profile.have.supabaseKey}');
  });

  it("distinguishes offline, timeout, service and configuration messages", () => {
    expect(gate).toContain("No internet connection. Please check your connection and try again.");
    expect(gate).toContain("The central service is taking too long to respond");
    expect(gate).toContain("Central service unavailable");
    expect(gate).toContain("Cannot reach the central service");
    expect(gate).toContain("Connection settings need attention");
    expect(gate).toContain("Sign-in expired");
    expect(gate).toContain("Access not permitted");
  });
});
