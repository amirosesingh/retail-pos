/**
 * Each audited rule must be decided by the register settings alone — with a
 * switched-on and a switched-off case, so a rule can never be silently
 * ignored again.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { blocksOutOfStockSale, exceedsAvailableStock } from "@/lib/register/stock-guard";
import {
  effectiveLockSeconds,
  DEFAULT_AUTO_LOCK_SECONDS,
  remainingAutoLockMs,
  setAutoLockSeconds,
} from "@/lib/auto-lock";
import { DEFAULT_POS_RULES, normalizeRules, requiresManagerPin, GATE_RULE_KEY } from "@/lib/pos-rules";

describe("prevent negative stock sale", () => {
  it.each([false, "false", 0, "0"])("honors saved off value %s for ordinary lines and one-unit job materials", value => {
    const rules = normalizeRules({ prevent_negative_stock_sale: value });
    for (const onHand of [-1, 0, 0.5]) {
      expect(exceedsAvailableStock(onHand, 1, rules.prevent_negative_stock_sale)).toBe(false);
      expect(exceedsAvailableStock(onHand, 4, rules.prevent_negative_stock_sale)).toBe(false);
    }
  });
  it("blocks insufficient job material and aggregated cart quantity when the policy is on", () => {
    expect(exceedsAvailableStock(0, 1, true)).toBe(true);
    expect(exceedsAvailableStock(0.5, 1, true)).toBe(true);
    expect(exceedsAvailableStock(3, 4, true)).toBe(true);
    expect(exceedsAvailableStock(3, 3, true)).toBe(false);
  });
  it("blocks an out-of-stock item when the rule is on", () => {
    expect(blocksOutOfStockSale(0, true)).toBe(true);
  });
  it("allows it when the rule is off", () => {
    expect(blocksOutOfStockSale(0, false)).toBe(false);
  });
  it("never blocks an item that is in stock", () => {
    expect(blocksOutOfStockSale(3, true)).toBe(false);
  });
});

describe("idle auto-lock", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
  });

  it("uses the branch rule when it is confirmed", () => {
    setAutoLockSeconds(600);
    expect(effectiveLockSeconds(90)).toBe(90);
  });
  it("honours a rule of zero as 'never lock'", () => {
    expect(effectiveLockSeconds(0)).toBe(0);
  });
  it("falls back to the per-machine value while the rule is unconfirmed", () => {
    setAutoLockSeconds(600);
    expect(effectiveLockSeconds(undefined)).toBe(600);
  });
  it("falls back to the shipped default with nothing saved", () => {
    expect(effectiveLockSeconds(undefined)).toBe(DEFAULT_AUTO_LOCK_SECONDS);
  });
  it("does not grant a fresh idle window after reopening the app", () => {
    const lastActivity = Date.UTC(2026, 8, 24, 8, 0, 0);
    expect(remainingAutoLockMs(180, lastActivity, lastActivity + 86_400_000)).toBe(0);
  });
  it("preserves only the unused part of the idle window", () => {
    const lastActivity = 1_000_000;
    expect(remainingAutoLockMs(180, lastActivity, lastActivity + 60_000)).toBe(120_000);
  });
});

describe("manager PIN gates read the register settings", () => {
  it("asks for a PIN when the matching rule is on and not when it is off", () => {
    for (const action of Object.keys(GATE_RULE_KEY) as (keyof typeof GATE_RULE_KEY)[]) {
      const key = GATE_RULE_KEY[action];
      expect(requiresManagerPin({ ...DEFAULT_POS_RULES, [key]: true }, action)).toBe(true);
      expect(requiresManagerPin({ ...DEFAULT_POS_RULES, [key]: false }, action)).toBe(false);
    }
  });
});
