import { describe, expect, it, beforeEach } from "vitest";
import { billPrefix, dayStamp, reserveBillNumber } from "@/lib/bill-number";

const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as { localStorage?: unknown }).localStorage = localStorage;
(globalThis as unknown as { window: { localStorage: typeof localStorage } }).window = {
  localStorage,
};

beforeEach(() => store.clear());

describe("bill numbers", () => {
  it("uses the configured branch, till and padding", async () => {
    const n = await reserveBillNumber("B1", [], {
      branchCode: "B101",
      terminalNo: "3",
      padding: 5,
    });
    expect(n).toMatch(/^B101-[A-Z]{3}03-[A-F0-9]{32}-\d{8}-00001$/);
  });

  it("keeps counting up within the same day", async () => {
    const cfg = { branchCode: "B1", terminalNo: "01" };
    const a = await reserveBillNumber("B1", [], cfg);
    const b = await reserveBillNumber("B1", [a], cfg);
    expect(Number(b.split("-").pop())).toBe(Number(a.split("-").pop()) + 1);
  });

  it("seeds from the highest existing number of the day", async () => {
    const cfg = { branchCode: "B1", terminalNo: "01" };
    const prefix = billPrefix("B1", new Date(), cfg);
    const next = await reserveBillNumber("B1", [`${prefix}-0042`], cfg);
    expect(next).toBe(`${prefix}-0043`);
  });

  it("stamps the day in the configured time zone", () => {
    const at = new Date("2026-08-11T20:00:00Z");
    expect(dayStamp(at, "Pacific/Kiritimati")).toBe("20260812");
    expect(dayStamp(at, "America/New_York")).toBe("20260811");
  });
});

describe("bill number reservation failures", () => {
  it("refuses to hand out a number the device could not record", async () => {
    const original = window.localStorage;
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    };
    (globalThis as { localStorage?: unknown }).localStorage = unavailable;
    (window as unknown as { localStorage: typeof unavailable }).localStorage = unavailable;
    const { reserveBillNumber, BillNumberReservationError } = await import("@/lib/bill-number");
    await expect(reserveBillNumber("B1", [], { branchCode: "B101" })).rejects.toBeInstanceOf(
      BillNumberReservationError,
    );
    (globalThis as { localStorage?: unknown }).localStorage = original;
    (window as unknown as { localStorage: typeof original }).localStorage = original;
  });

  it("awaits the durable reservation before returning a number", async () => {
    const { reserveBillNumber } = await import("@/lib/bill-number");
    const a = await reserveBillNumber("B1", [], { branchCode: "B101", padding: 4 });
    const b = await reserveBillNumber("B1", [], { branchCode: "B101", padding: 4 });
    expect(a).not.toEqual(b);
  });

  it("never hands the same number to two concurrent callers", async () => {
    const { reserveBillNumber } = await import("@/lib/bill-number");
    const cfg = { branchCode: "B1", terminalNo: "01" };
    const numbers = await Promise.all(
      Array.from({ length: 5 }, () => reserveBillNumber("B1", [], cfg)),
    );
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
