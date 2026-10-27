import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ registration: vi.fn(), proof: vi.fn() }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: h.registration }));
vi.mock("@/core/activation/device-proof", () => ({ deviceProofHash: h.proof }));
import { readNativeTerminalProof } from "../native-terminal-proof";

beforeEach(() => {
  h.registration.mockReset().mockReturnValue(null);
  h.proof.mockReset().mockResolvedValue(null);
});

describe("native registration proof handoff", () => {
  it("keeps web management unregistered without creating a device proof", async () => {
    expect(await readNativeTerminalProof()).toEqual({});
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("uses the saved claim proof without requesting another key or exposing replica credentials", async () => {
    h.registration.mockReturnValue({
      tokenId: "terminal-a", deviceBindingProof: "AB".repeat(32),
      deviceClaimProof: "replica-secret", supabaseKey: "connection-key", locationId: "branch-a",
    });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "ab".repeat(32) });
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("recovers the existing device proof for a legacy registration without a stored copy", async () => {
    h.registration.mockReturnValue({ tokenId: "terminal-a" });
    h.proof.mockResolvedValue("cd".repeat(32));
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "cd".repeat(32) });
    expect(h.proof).toHaveBeenCalledOnce();
  });

  it("retains terminal identity when a proof is unavailable so the server can refuse registration verification", async () => {
    h.registration.mockReturnValue({ tokenId: "terminal-a" });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a" });
  });
});
