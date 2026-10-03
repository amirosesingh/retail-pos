import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELAY_TABLES } from "@/core/api/pos-relay.server";

describe("relay table registration", () => {
  it.each(["payment_transactions", "item_activity_logs", "settings_scoped", "public_flags"])(
    "allows the Electron sync worker to relay %s",
    (table) => {
      expect(RELAY_TABLES.has(table)).toBe(true);
    },
  );

  it("uses the public flag key as the server-owned upsert conflict target", () => {
    const relay = readFileSync("src/core/api/pos-relay.server.ts", "utf8");
    expect(relay).toContain('public_flags: "key"');
  });
});
