import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
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
    expect(claim).toContain("coalesce(t.claim_proof, t.claimed_proof_hash) = p_proof_hash");
    expect(claim.indexOf("coalesce(t.claim_proof")).toBeLessThan(
      claim.indexOf("TERMINAL_TOKEN_EXPIRED"),
    );
    expect(claim).toContain("is_claimed = true");
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
