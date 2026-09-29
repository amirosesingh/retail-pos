import { describe, expect, it } from "vitest";
import { RELAY_TABLES } from "@/core/api/pos-relay.server";

describe("relay table registration", () => {
  it.each(["payment_transactions", "item_activity_logs", "settings_scoped"])(
    "allows the Electron sync worker to relay %s",
    (table) => {
      expect(RELAY_TABLES.has(table)).toBe(true);
    },
  );
});
