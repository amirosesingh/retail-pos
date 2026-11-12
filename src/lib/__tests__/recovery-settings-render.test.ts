import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { RecoverySection } from "../recovery-section";

const f = vi.hoisted(() => ({
  profile: { loading: false, error: true, connectionReady: true, registrationReady: false, registrationCode: null as string | null, registrationMessage: null as string | null, config: null, cloud: true, retry: vi.fn() },
  panel: vi.fn(), activation: vi.fn(), gate: vi.fn(),
}));
vi.mock("@/lib/use-recovery-profile", () => ({ useRecoveryProfile: () => f.profile }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => true }));
vi.mock("@/platforms/web/components/pos/settings/panels/CloudConnectionPanel", () => ({ CloudConnectionPanel: () => {
  f.panel();
  return createElement("div", null, createElement("input", { value: "https://saved.example", readOnly: true }), createElement("input", { value: "https://saved-pos.example", readOnly: true }));
} }));
vi.mock("@/platforms/web/components/pos/TerminalActivation", () => ({ TerminalActivation: () => { f.activation(); return createElement("form", { "data-activation": true }); } }));
vi.mock("@/platforms/web/components/pos/ReceiptPrinterSettings", () => ({ RecoveryPrinterSettings: () => null }));
vi.mock("@/components/shared/TerminalRegistrationDetails", () => ({ TerminalRegistrationDetails: () => null }));
vi.mock("@/core/activation/registration-status", () => ({ useStartupGate: () => { f.gate(); return { loading: false }; }, emergencyMode: () => "online-unregistered" }));
import { RecoveryHub } from "@/platforms/web/components/pos/RecoveryHub";
const renderHub = (section: RecoverySection) => renderToStaticMarkup(createElement<{ section?: RecoverySection }>(RecoveryHub, { section }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(f.profile, { loading: false, error: true, connectionReady: true, registrationReady: false, registrationCode: null, registrationMessage: null, config: null, cloud: true });
});

it("renders the existing connection fields when only registration recovery failed", () => {
  const html = renderHub("connection");
  expect(f.panel).toHaveBeenCalledOnce();
  expect(html).toContain('value="https://saved.example"');
  expect(html).toContain('value="https://saved-pos.example"');
  expect(html).toContain("saved connection settings are available");
  expect(html).toContain("Registration recovery pending");
  expect(html).not.toContain("Saved settings could not be read");
  expect(html).not.toContain("Not activated"); expect(html).not.toContain("Not bound");
  expect(f.gate).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
});

it("keeps the activation form closed even when its recovery card is explicitly opened", () => {
  const html = renderHub("activation");
  expect(html).toContain("Retry its recovery before changing activation");
  expect(f.activation).not.toHaveBeenCalled();
  expect(f.gate).not.toHaveBeenCalled();
});

it("shows the specific safe registration reason while retaining readable connection fields", () => {
  Object.assign(f.profile, { registrationCode: "EACTIVATION_RECOVERY_BINDING", registrationMessage: "The saved registration could not be matched to this device's previous terminal binding. The saved setup has been kept." });
  const html = renderHub("connection");
  expect(html).toContain("previous terminal binding");
  expect(html).toContain("Retry saved registration");
  expect(html).toContain('value="https://saved.example"');
  expect(html).not.toContain("Saved settings could not be read");
  expect(f.activation).not.toHaveBeenCalled(); expect(f.gate).not.toHaveBeenCalled();
});

it("keeps connection fields blocked when actual storage remains unreadable", () => {
  Object.assign(f.profile, { connectionReady: false });
  const html = renderHub("connection");
  expect(html).toContain("Saved settings could not be read");
  expect(f.panel).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
});

it("offers activation only for confirmed absence after successful storage reads", () => {
  Object.assign(f.profile, { error: false, registrationReady: true, cloud: false });
  const html = renderHub("activation");
  expect(f.activation).toHaveBeenCalledOnce();
  expect(html).toContain("Not activated"); expect(html).toContain("Not bound");
});
