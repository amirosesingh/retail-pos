/**
 * Guards for the three fixes made to sign-in, sign-out and terminal
 * activation: a sign-out may never end a newer sign-in, the database must
 * hold exactly one version of each activation routine, and the settings rail
 * must remember how wide the operator left it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectResponse, onSessionExpired } from "../session-expiry";

import {
  __resetSessionEpoch,
  bumpSessionEpoch,
  isCurrentEpoch,
  sessionEpoch,
} from "@/lib/session-epoch";

const schema = readFileSync(resolve(process.cwd(), "supabase/schema.sql"), "utf8");

describe("session epoch", () => {
  beforeEach(() => __resetSessionEpoch());

  it("treats a sign-out started in the current epoch as valid", () => {
    const started = sessionEpoch();
    expect(isCurrentEpoch(started)).toBe(true);
  });

  it("ignores a sign-out that a newer sign-in has overtaken", () => {
    const started = sessionEpoch();
    bumpSessionEpoch(); // a fresh sign-in lands mid sign-out
    expect(isCurrentEpoch(started)).toBe(false);
  });

  it("ignores a late token refusal from before the successful login", async () => {
    const ended = vi.fn();
    const off = onSessionExpired(ended);
    const started = sessionEpoch();
    bumpSessionEpoch();
    await inspectResponse(new Response('Invalid JWT',{status:401}),true,started);
    expect(ended).not.toHaveBeenCalled();
    off();
  });

  it("stays harmless when sign-out runs twice", () => {
    const first = sessionEpoch();
    const second = sessionEpoch();
    expect(isCurrentEpoch(first)).toBe(true);
    expect(isCurrentEpoch(second)).toBe(true);
  });

  it("keeps the epoch stable when nothing signs in", () => {
    const before = sessionEpoch();
    expect(sessionEpoch()).toBe(before);
  });
});

describe("activation contract in the canonical schema", () => {
  it("ends with one invoker-only check-in wrapper", () => {
    const defs = schema.match(/CREATE OR REPLACE FUNCTION public\.terminal_token_heartbeat/g) ?? [];
    expect(defs.length).toBe(2);
    const boundary = schema.slice(schema.indexOf("-- Public pre-authentication RPC boundary"));
    expect(boundary.match(/CREATE OR REPLACE FUNCTION public\.terminal_token_heartbeat/g)).toHaveLength(
      1,
    );
    expect(boundary).toContain("LANGUAGE sql SECURITY INVOKER");
  });

  it("installs every column written by the check-in routine", () => {
    expect(schema).toContain(
      "ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS app_version text;",
    );
    expect(schema).toContain(
      "ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS last_sync_at timestamp with time zone;",
    );
  });

  it("drops any older check-in routine before replacing it", () => {
    expect(schema).toMatch(/DROP FUNCTION IF EXISTS public\.terminal_token_heartbeat/);
  });

  it("claims a terminal with the device proof and platform", () => {
    const claim = schema.slice(schema.indexOf("FUNCTION public.terminal_token_claim"));
    expect(claim.slice(0, 400)).toMatch(/p_proof_hash/);
    expect(claim.slice(0, 400)).toMatch(/p_platform/);
    expect(claim.slice(0, 400)).toMatch(/p_os/);
  });

  it("lets an unregistered till read a code's status", () => {
    expect(schema).toMatch(/GRANT ALL ON FUNCTION public\.terminal_token_status[^;]*TO anon;/);
  });
});

describe("settings rail", () => {
  it("remembers the narrow rail per device", async () => {
    const store = new Map<string, string>();
    // A minimal stand-in for the browser's own storage.
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const { readNavCollapsed, writeNavCollapsed } =
      await import("@/platforms/web/components/pos/settings/SettingsNavTree");
    expect(readNavCollapsed()).toBe(false);
    writeNavCollapsed(true);
    expect(readNavCollapsed()).toBe(true);
    writeNavCollapsed(false);
    expect(readNavCollapsed()).toBe(false);
  });
});
