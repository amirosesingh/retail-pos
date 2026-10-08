import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: query }));
import { loadBookings } from "../bookings-db";
beforeEach(() => {
  query.mockReset();
});
describe("complete booking and payment history", () => {
  it("continues past the former 500-booking ceiling", async () => {
    const head = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      created_at: "2026-10-08T00:00:00Z",
    }));
    let calls = 0;
    query.mockImplementation(async (table) =>
      table === "bookings"
        ? ++calls === 1
          ? head
          : [{ id: "last", created_at: "2026-10-07T00:00:00Z" }]
        : [],
    );
    const bookings = await loadBookings();
    expect(bookings).toHaveLength(501);
    expect(query.mock.calls[1]).toEqual([
      "bookings",
      expect.objectContaining({
        cursor: { column: "created_at", value: "2026-10-08T00:00:00Z", id: "499" },
      }),
    ]);
  });
  it("reads every payment page instead of losing payments after the local SQL cap", async () => {
    query.mockImplementation(async (table, options) =>
      table === "bookings"
        ? [{ id: "B1", created_at: "2026-10-08T00:00:00Z" }]
        : Array.from({ length: Math.min(1000, 2001 - options.offset) }, (_, index) => ({
            id: String(options.offset + index),
            booking_id: "B1",
            amount: 1,
            status: "settled",
            created_at: "2026-10-08T00:00:00Z",
          })),
    );
    const bookings = await loadBookings(["B1"]);
    expect(
      query.mock.calls
        .filter((call) => call[0] === "booking_payments")
        .map((call) => call[1].offset),
    ).toEqual([0, 1000, 2000]);
    expect(bookings[0].payments).toHaveLength(2001);
  });
});
