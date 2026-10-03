import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  decodePairingRequest,
  encodePairingRequest,
  isRetryableActivationError,
  withActivationRetry,
} from "@/core/activation/terminal-tokens";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("terminal activation retries", () => {
  it("retries a transient lost response and returns the idempotent result", async () => {
    const request = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(true);

    await expect(withActivationRetry(request, [0])).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an expired or revoked token verdict", async () => {
    const request = vi.fn<() => Promise<boolean>>().mockRejectedValue(
      new Error("TERMINAL_TOKEN_EXPIRED"),
    );

    await expect(withActivationRetry(request, [0, 0])).rejects.toThrow("TERMINAL_TOKEN_EXPIRED");
    expect(request).toHaveBeenCalledTimes(1);
    expect(isRetryableActivationError(new Error("TERMINAL_TOKEN_REVOKED"))).toBe(false);
  });
});

describe("terminal registration trust boundary", () => {
  const schema = source("supabase/schema.sql");
  const accountFn = source("src/lib/terminal-account.functions.ts");
  const accountServer = source("src/lib/terminal-account.server.ts");

  it("requires a durable proof before a new claim", () => {
    const claim = schema.slice(
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_claim"),
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat"),
    );
    expect(claim).toContain("TERMINAL_DEVICE_PROOF_REQUIRED");
    expect(claim).toContain("TERMINAL_DEVICE_PROOF_MISMATCH");
    expect(claim).toContain("lower(t.claim_proof) <> lower(p_proof_hash)");
    expect(claim).toContain(
      "lower(coalesce(t.claim_proof, t.claimed_proof_hash)) = lower(p_proof_hash)",
    );
    expect(claim.indexOf("lower(coalesce(t.claim_proof")).toBeLessThan(
      claim.indexOf("TERMINAL_TOKEN_EXPIRED"),
    );
    expect(claim).toContain("is_claimed = true");
  });

  it("accepts only proof-bound phone pairing payloads", () => {
    const request = {
      tokenId: "3e8b4d95-9b6b-4a8a-8bf7-3698f0fb0be0",
      deviceName: "Counter 3",
      proofHash: "a".repeat(64),
    };
    expect(decodePairingRequest(encodePairingRequest(request))).toEqual(request);
    expect(decodePairingRequest(request.tokenId)).toBeNull();
    expect(
      decodePairingRequest(`POSPAIR1:${btoa(JSON.stringify({ ...request, proofHash: "short" }))}`),
    ).toBeNull();
    expect(
      decodePairingRequest(
        `POSPAIR1:${btoa(JSON.stringify({ ...request, tokenId: "legacy-terminal-id" }))}`,
      ),
    ).toBeNull();
  });

  it("rejects stale non-UUID pairing ids before the hosted verifier sees them", () => {
    const activation = source("src/core/activation/terminal-tokens.ts");
    expect(activation).toContain("TERMINAL_UUID.test(parsed.tokenId)");
    expect(activation).toContain("crypto.randomUUID()");
  });

  it("keeps a remotely revoked terminal locked instead of exposing activation", () => {
    const shell = source("src/platforms/web/components/pos/AppShell.tsx");
    const screen = source("src/platforms/web/components/pos/TerminalActivation.tsx");
    const revocation = source("src/lib/use-revocation-check.ts");
    const desktop = source("electron/main.cjs");
    expect(shell).toContain("<TerminalRevokedScreen reason={terminal.reason} />");
    expect(screen).not.toContain("onReactivate");
    expect(revocation).toContain("REVOCATION_CHECK_MS = 10 * 1000");
    expect(revocation).toContain('window.addEventListener("pos:app-resume", checkNow)');
    expect(desktop).toContain("terminalIdentityPausedSync=true");
    expect(desktop).toContain("stopAutomaticSync()");
    expect(desktop).toContain("syncCoordinator.pause()");
  });

  it("keeps pairing credentials behind the hosted proof-check endpoint", () => {
    const endpoint = source("src/routes/api/public/terminal-pairing.ts");
    expect(endpoint).toContain("claim_proof=eq.");
    expect(endpoint).toContain("Cache-Control");
    expect(endpoint).toContain("supabaseConfig()");
    expect(endpoint).not.toContain("SERVICE_ROLE_KEY");
  });

  it("keeps the PC/mobile claim boundary fail-closed", () => {
    const claim = schema.slice(
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_claim"),
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat"),
    );
    expect(schema).toContain("CONSTRAINT terminal_tokens_platform_check");
    expect(claim).toContain(") IS NOT TRUE THEN");
    expect(claim).toContain("t.platform = 'mobile' AND p_platform = 'android'");
    expect(claim).toContain("t.platform = 'pc' AND p_platform = 'electron'");
    expect(claim).toContain("TERMINAL_PLATFORM_MISMATCH");
  });

  it("binds heartbeat telemetry to the claiming device and removes direct anon updates", () => {
    const heartbeat = schema.slice(
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat"),
      schema.indexOf("CREATE OR REPLACE FUNCTION public.terminal_token_status"),
    );
    expect(heartbeat).toContain("p_proof_hash text");
    expect(heartbeat).toContain("coalesce(claim_proof, claimed_proof_hash) = p_proof_hash");
    expect(schema).toContain(
      'DROP POLICY IF EXISTS "Terminals can stamp their heartbeat" ON public.terminal_tokens',
    );
    expect(schema).not.toContain('CREATE POLICY "Terminals can stamp their heartbeat"');
  });

  it("never provisions machine credentials from a spoofable device label", () => {
    expect(accountFn).toContain("proofHash: z.string()");
    expect(accountFn).not.toContain("device: z.string()");
    expect(accountServer).toContain("timingSafeEqual");
    expect(accountServer).toContain("claim_proof,claimed_proof_hash");
    expect(accountServer).not.toContain("claimed_by_device?.trim");
  });

  it("checks every authorization write and reads worker secrets at request time", () => {
    expect(accountServer).toContain('runtimeEnvValue("SETTINGS_ENCRYPTION_KEY")');
    expect(accountServer).toContain("if (!profile.ok)");
    expect(accountServer).toContain("if (!role.ok)");
    expect(accountServer).toContain("if (!repaired.ok)");
  });
});
