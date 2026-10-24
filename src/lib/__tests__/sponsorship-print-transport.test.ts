import { beforeEach, expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import type { SponsorshipRecord } from "../sponsorship";
const printer = vi.hoisted(() => ({
  silent: vi.fn(),
  raw: vi.fn(),
  drawer: vi.fn(),
  available: true,
}));
vi.mock("../receipt-printer", () => ({
  canPrintReceipts: () => printer.available,
  canOpenDrawer: () => true,
  getPrinterPrefs: () => ({ printMode: "direct" }),
  silentPrint: printer.silent,
  rawPulse: printer.raw,
  protectedDrawerOpen: printer.drawer,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import {
  printSponsorshipReceipt,
  saleReceiptPreview,
  setPrintSettings,
  setPrintStore,
} from "../pos-print";
import { defaultReceiptSettings } from "../pos-seed";
const record: SponsorshipRecord = {
  id: "sp-id",
  reference: "SP-STR1-WEB01-20261024-0001",
  store_id: "a",
  store_name: "Source shop",
  recipient_name: "Club",
  recipient_contact: "",
  purpose: "Sports event",
  created_by: "issuer",
  created_by_name: "Issuer",
  created_at: "2026-10-24T01:00:00Z",
  status: "issued",
  given_at: "2026-10-24T02:00:00Z",
  given_by: "issuer",
  given_by_name: "Issuer",
  received_by: "Receiver",
  approved_by_name: "Approver",
  authorization_mode: "approval",
  document_hash: "hash",
  total_value: 15,
  lines: [
    {
      product_id: "p",
      name: "Racket",
      sku: "SKU",
      barcode: "BAR",
      quantity: 2,
      unit_value: 10,
      discount: 25,
      discount_type: "percent",
      discount_amount: 5,
      line_value: 15,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  printer.available = true;
  printer.silent.mockResolvedValue({ ok: true, handled: true });
  setPrintStore(null);
  setPrintSettings(
    {
      ...defaultReceiptSettings,
      showLogo: false,
      headerText:
        "Ref {{receipt_number}} | Recipient {{customer_name}} | Discount {{discount}} | Total {{total}} | Booking {{booking_ref}}",
      customLines: [],
    },
    { enabled: false, rate: 0, mode: "exclusive" },
  );
});
it("prints the current sponsorship reference and discount even after a different sale was rendered", async () => {
  const previous = {
    id: "previous",
    receiptNo: "OLD-SALE-909",
    storeId: "a",
    shiftId: "shift",
    cashier: "Previous cashier",
    lines: [],
    subtotal: 909,
    discount: 99,
    tax: 0,
    total: 810,
    paid: 1000,
    change: 190,
    method: "cash",
    memberId: null,
    pointsEarned: 0,
    createdAt: "2026-10-23T01:00:00Z",
    bookingRef: "OLD-BOOKING",
  } satisfies Sale;
  saleReceiptPreview(previous, null, "sale");
  expect(await printSponsorshipReceipt(record)).toEqual({ ok: true, handled: true });
  const html = printer.silent.mock.calls[0][0] as string;
  expect(html).toContain(
    "Ref SP-STR1-WEB01-20261024-0001 | Recipient Club | Discount 5.00 | Total 15.00 | Booking ",
  );
  expect(html).not.toContain("OLD-SALE-909");
  expect(html).not.toContain("OLD-BOOKING");
  expect(html).toContain("25%");
  expect(html).toContain("Sponsored value 15.00");
  expect(printer.silent.mock.calls[0].slice(1)).toEqual([defaultReceiptSettings.paper, false]);
  expect(printer.drawer).not.toHaveBeenCalled();
});
it("reprinting leaves the recorded document unchanged and repeats only the print transport", async () => {
  const before = structuredClone(record);
  await printSponsorshipReceipt(record);
  await printSponsorshipReceipt(record);
  expect(record).toEqual(before);
  expect(printer.silent).toHaveBeenCalledTimes(2);
  expect(printer.drawer).not.toHaveBeenCalled();
  expect(printer.raw).not.toHaveBeenCalled();
});
it("returns printer rejection without retrying or opening the drawer", async () => {
  printer.silent.mockResolvedValue({ ok: false, handled: true, error: "Printer unavailable" });
  expect(await printSponsorshipReceipt(record)).toMatchObject({
    ok: false,
    error: "Printer unavailable",
  });
  expect(printer.silent).toHaveBeenCalledOnce();
  expect(printer.drawer).not.toHaveBeenCalled();
});
it("does not send an unissued sponsorship to the printer", () => {
  expect(() => printSponsorshipReceipt({ ...record, status: "requested", given_at: null })).toThrow(
    /recorded/,
  );
  expect(printer.silent).not.toHaveBeenCalled();
});

it("keeps the following normal sale's own reference and totals", async () => {
  await printSponsorshipReceipt(record);
  const next = {
    id: "next",
    receiptNo: "SALE-NEXT-2",
    storeId: "a",
    shiftId: "shift",
    cashier: "Cashier",
    lines: [],
    subtotal: 40,
    discount: 2,
    tax: 0,
    total: 38,
    paid: 40,
    change: 2,
    method: "cash",
    memberId: null,
    pointsEarned: 0,
    createdAt: "2026-10-24T03:00:00Z",
  } satisfies Sale;
  const html = saleReceiptPreview(next, null, "sale");
  expect(html).toContain("Ref SALE-NEXT-2");
  expect(html).toContain("Discount 2.00 | Total 38.00");
  expect(html).not.toContain(record.reference);
});
