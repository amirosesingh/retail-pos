import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  registered: true,
  signedIn: true,
  totpEnabled: false,
}));

vi.mock("@/lib/pos-auth", () => ({
  useAuth: () => ({
    user: state.signedIn ? { staffId: "manager" } : null,
    appUser: state.signedIn ? {
      user_id: "manager",
      permissions: { approval_totp_enabled: state.totpEnabled },
    } : null,
  }),
}));
vi.mock("@/core/activation/terminal-tokens", () => ({
  readTerminalConfig: () => state.registered ? { tokenId: "terminal-a" } : null,
}));
vi.mock("@/lib/approval-token-client", () => ({
  TOKEN_CHANGED: "pos:approval-token-changed",
  enrollOwnApprovalToken: vi.fn(),
  offlineTokenOwner: vi.fn(),
  setupOfflineApprovalToken: vi.fn(),
  unlockOfflineApprovalToken: vi.fn(),
  loadApprovalToken: vi.fn(),
}));
vi.mock("@/lib/approval-totp", () => ({ approvalTotp: vi.fn() }));
vi.mock("@/lib/background-refresh", () => ({ subscribeBackgroundRefresh: vi.fn(() => () => {}) }));
vi.mock("@/lib/time-zone", () => ({ formatDateTime: vi.fn() }));

import { ApprovalTokenButton } from "../ApprovalToken";

beforeEach(() => {
  state.registered = true;
  state.signedIn = true;
  state.totpEnabled = false;
});

describe("approval token setup visibility", () => {
  it("does not expose the token control before this user has permission", () => {
    expect(renderToStaticMarkup(createElement(ApprovalTokenButton))).toBe("");
  });

  it("shows setup immediately after permission is enabled, before enrollment completes", () => {
    state.totpEnabled = true;
    expect(renderToStaticMarkup(createElement(ApprovalTokenButton))).toContain("Set up approval token");
  });

  it("does not offer setup without a registered device or signed-in user", () => {
    state.totpEnabled = true;
    state.registered = false;
    expect(renderToStaticMarkup(createElement(ApprovalTokenButton))).toBe("");
    state.registered = true;
    state.signedIn = false;
    expect(renderToStaticMarkup(createElement(ApprovalTokenButton))).toBe("");
  });
});
