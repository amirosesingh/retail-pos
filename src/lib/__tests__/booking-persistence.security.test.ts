import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("booking persistence boundaries", () => {
  it("persists an explicit booking kind instead of trusting the legacy job-status default", () => {
    const bookings = read("src/lib/bookings-db.ts");

    expect(bookings).toContain('booking_kind: b.job ? "racket" : "standard"');
    expect(bookings).toContain('r.booking_kind === "racket"');
    expect(bookings).toContain("job: isRacket");
  });

  it("does not turn a rejected cloud payment into an unrestricted booking upsert", () => {
    const store = read("src/lib/pos-store.tsx");
    const payment = store.slice(
      store.indexOf("const addBookingPayment"),
      store.indexOf("const cancelBooking"),
    );

    expect(payment).toContain('toast.error("Payment was not recorded"');
    expect(payment).not.toContain("await commitBooking(updated)");
  });

  it("waits for database acknowledgement before showing job changes or deletion", () => {
    const store = read("src/lib/pos-store.tsx");

    expect(store).not.toContain("saveBookingQuietly");
    expect(store).toContain("await deleteBookingRow(id)");
    expect(store).toContain("await commitBooking(updated)");
  });

  it("repairs both cloud and SQL Server rows and carries kind through synchronization", () => {
    const cloud = read("supabase/migrations/20261008093000_preserve_booking_kind.sql");
    const compatibility = read("supabase/migrations/20261008095500_derive_legacy_booking_kind.sql");
    const local = read("database/sqlserver/migrations/011_preserve_booking_kind.sql");
    const registry = read("database/sqlserver/schema-registry.json");

    expect(cloud).toContain("ADD COLUMN IF NOT EXISTS booking_kind");
    expect(cloud).toContain("booking_kind=EXCLUDED.booking_kind");
    expect(compatibility).toContain("CREATE TRIGGER bookings_derive_kind");
    expect(local).toContain("version = 11");
    expect(local).toContain("SET booking_kind = N''racket''");
    expect(local).toContain("CREATE OR ALTER TRIGGER dbo.TR_bookings_set_kind");
    expect(registry).toContain('"cloudColumn": "booking_kind"');
  });
});
