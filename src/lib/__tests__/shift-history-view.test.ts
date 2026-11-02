import { describe, expect, it } from "vitest";
import type { Shift } from "@/core/types/pos-types";
import { filterShiftHistory, shiftHistoryStatus } from "../shift-history-view";

const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = (number: number) => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`;
const shift = (number: number, patch: Partial<Shift> = {}): Shift => ({
  id: uuid(number), storeId: branch, cashier: `Operator ${number}`,
  openedAt: "2026-10-31T02:00:00.000Z", closedAt: "2026-10-31T10:00:00.000Z",
  openingFloat: 20, countedCash: 90, status: "CLOSED", note: "", terminalId: "terminal-a",
  terminalName: "Counter A", closedBy: "Closing operator", ...patch,
});
const view = (patch: Partial<Parameters<typeof filterShiftHistory>[1]> = {}) => ({
  branchId: branch, from: "", to: "", search: "", status: "all" as const,
  columnFilters: {}, countedCashVisible: false, varianceVisible: false,
  dayKey: (value: string) => value.slice(0, 10),
  formatDateTime: (value: string) => value.replace("T", " ").replace(".000Z", " UTC"),
  formatMoney: (value: number) => `MYR ${value.toFixed(2)}`,
  now: new Date("2026-11-01T02:00:00.000Z"),
  ...patch,
});
const ids = (rows: Shift[]) => rows.map(row => row.id);

describe("complete branch shift history view", () => {
  const rows = Array.from({ length: 57 }, (_, index) => shift(index + 1, index === 0 || index === 56
    ? { status: "OPEN", closedAt: null } : {}));

  it("finds both open shifts across different 25-row pages before taking the page", () => {
    const open = filterShiftHistory(rows, view({ status: "open" })).slice(0, 25);
    expect(ids(open)).toEqual([uuid(1), uuid(57)]);
    expect(filterShiftHistory(rows, view({ status: "closed" }))).toHaveLength(55);
    expect(filterShiftHistory(rows, view())).toHaveLength(57);
  });

  it("applies the Status column filter to the complete result instead of the first page", () => {
    const matching = filterShiftHistory(rows, view({ columnFilters: { Status: " open " } }));
    expect(ids(matching.slice(0, 25))).toEqual([uuid(1), uuid(57)]);
    expect(filterShiftHistory(rows, view({ columnFilters: { Cashier: "operator 57" } }))).toEqual([rows[56]]);
  });

  it("combines explicit status, search and column filters without changing the source rows", () => {
    const before = structuredClone(rows);
    const matching = filterShiftHistory(rows, view({ status: "open", search: "Counter A", columnFilters: { Cashier: "57" } }));
    expect(matching).toEqual([rows[56]]);
    expect(matching[0]).toBe(rows[56]);
    expect(rows).toEqual(before);
    expect(filterShiftHistory(rows, view({ status: "closed", columnFilters: { Status: "OPEN" } }))).toEqual([]);
  });

  it("restores all branch rows when cleared dates, status, text and column filters are supplied", () => {
    expect(filterShiftHistory(rows, view({ from: "2026-11-01", search: "missing", status: "open", columnFilters: { Terminal: "other" } }))).toEqual([]);
    expect(filterShiftHistory(rows, view())).toEqual(rows);
    expect(filterShiftHistory(rows, view({ columnFilters: { Status: "   " } }))).toEqual(rows);
  });

  it("always excludes foreign rows, including on all-dates/all-status and matching reference searches", () => {
    const foreign = shift(98, { storeId: otherBranch, status: "OPEN", closedAt: null });
    expect(filterShiftHistory([...rows, foreign], view())).toEqual(rows);
    expect(filterShiftHistory([...rows, foreign], view({ search: foreign.id }))).toEqual([]);
    expect(filterShiftHistory([shift(99, { storeId: branch.toUpperCase() })], view())).toHaveLength(1);
    expect(filterShiftHistory(rows, view({ branchId: "" }))).toEqual([]);
  });

  it("uses the supplied store-day conversion and inclusive opening-date limits", () => {
    const midnight = shift(1, { openedAt: "2026-10-30T18:00:00.000Z" });
    const storeView = view({ from: "2026-10-31", to: "2026-10-31",
      dayKey: value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) });
    expect(filterShiftHistory([midnight], storeView)).toEqual([midnight]);
    expect(filterShiftHistory([midnight], view({ from: "2026-10-31", to: "2026-10-30" }))).toEqual([]);
  });

  it("supports full reference and the existing cashier, terminal and opening-date searches", () => {
    const row = shift(31);
    for (const search of [row.id, "Counter A", "2026-10-31T02:00", "2026-10-31 02:00", row.cashier])
      expect(filterShiftHistory([row], view({ search })), search).toEqual([row]);
    expect(filterShiftHistory([row], view({ columnFilters: { Opened: "02:00", Closed: "10:00", Terminal: "counter a", "Closed by": "closing" } }))).toEqual([row]);
  });

  it("filters displayed float, duration, permitted closing counts and signed variance", () => {
    const row = shift(1, { countedCash: 873.21, varianceTotal: -17.45 });
    expect(filterShiftHistory([row], view({ columnFilters: { Float: "MYR 20.00", Duration: "8h" } }))).toEqual([row]);
    expect(filterShiftHistory([row], view({ countedCashVisible: true, varianceVisible: true,
      columnFilters: { "Closing float": "873.21", "Over / short": "-17.45" } }))).toEqual([row]);
    expect(filterShiftHistory([shift(2, { closingFloat: 72.5, countedCash: 99 })], view({ countedCashVisible: true, columnFilters: { "Closing float": "72.50" } }))).toHaveLength(1);
  });

  it("never searches hidden closing counts or variance, including stale hidden-column filters", () => {
    const row = shift(1, { countedCash: 873.21, varianceTotal: -17.45 });
    for (const search of ["873.21", "-17.45"])
      expect(filterShiftHistory([row], view({ search }))).toEqual([]);
    for (const label of ["Closing float", "Over / short", "Unknown column", "toString"])
      expect(filterShiftHistory([row], view({ columnFilters: { [label]: "1" } }))).toEqual([]);
    expect(filterShiftHistory([row], view({ countedCashVisible: true, search: "873.21" }))).toEqual([]);
    expect(filterShiftHistory([row], view({ varianceVisible: true, search: "-17.45" }))).toEqual([]);
  });

  it("obeys granular financial-column denials even when the base financial permissions are granted", () => {
    const row = shift(1, { countedCash: 873.21, varianceTotal: -17.45 });
    const granted = view({ countedCashVisible: true, varianceVisible: true });
    expect(filterShiftHistory([row], { ...granted, columnFilters: { "Closing float": "873.21" } })).toEqual([row]);
    const denied = { ...granted, hiddenColumns: ["Closing float", "Over / short", "Float"] };
    for (const [label, value] of [["Closing float", "873.21"], ["Over / short", "-17.45"], ["Float", "20.00"]])
      expect(filterShiftHistory([row], { ...denied, columnFilters: { [label]: value } })).toEqual([]);
    for (const search of ["873.21", "-17.45"])
      expect(filterShiftHistory([row], { ...denied, search })).toEqual([]);
    expect(filterShiftHistory([row], denied)).toEqual([row]);
  });

  it("preserves the existing closed timestamp or CLOSED flag interpretation without closing any row", () => {
    const open = shift(1, { status: "OPEN", closedAt: null });
    const flag = shift(2, { status: "CLOSED", closedAt: null });
    const time = shift(3, { status: "OPEN" });
    expect([open, flag, time].map(shiftHistoryStatus)).toEqual(["OPEN", "CLOSED", "CLOSED"]);
    expect(filterShiftHistory([open, flag, time], view({ status: "closed" }))).toEqual([flag, time]);
    expect(open).toMatchObject({ status: "OPEN", closedAt: null });
  });
});
