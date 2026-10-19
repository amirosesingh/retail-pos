import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/branding", () => ({ useBranding: () => ({ company: "Saved Store" }) }));
vi.mock("@/platform-config/approval-token", () => ({ ApprovalTokenButton: () => null }));
import { OfflineLoginInterface } from "@/platforms/mobile/components/OfflineInterface";

describe("Android local interface with online-only business access", () => {
  it("renders a themed sign-in view with sign-in disabled without an auth or database provider", () => {
    const html = renderToStaticMarkup(createElement(OfflineLoginInterface));
    expect(html).toContain("Saved Store");
    expect(html).toContain("bg-background");
    expect(html).toContain("Sign-in will be available when the connection returns.");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("Emergency access");
  });
  it("keeps runtime content unavailable offline and observes the existing automatic heartbeat", () => {
    const gate = readFileSync("src/platforms/mobile/components/OfflineGate.tsx", "utf8");
    expect(gate).toContain('inert={!available}');
    expect(gate).toContain('verdict === "unreachable"');
    const indicator = readFileSync("src/platforms/mobile/components/OfflineInterface.tsx", "utf8");
    expect(indicator).toContain("subscribeConnectivity(setState)");
    expect(indicator).not.toContain("setInterval");
    expect(indicator).not.toContain("local-db");
  });
});
