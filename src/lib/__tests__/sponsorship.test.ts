import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  sponsorshipInput,
  sponsorshipLineAmounts,
  sponsorshipSnapshot,
  visibleSponsorship,
  type SponsorshipRecord,
} from "../sponsorship";
import { sponsorshipReceiptDetails } from "../sponsorship-receipt";
import { defaultRule, resolveRules, canBypassAuthorization } from "../authorization";
import { normalizePermissions, hasPermission } from "../permissions";
import { permissionEditableKeys } from "../permission-editor";
import { tablePermissionPage } from "../permission-display-groups";
import { rowToSettings, applySettingsFields } from "@/core/api/pos-db";
const record = {
  id: "00000000-0000-4000-8000-000000000001",
  reference: "SP-1",
  store_id: "a",
  store_name: "Shop",
  recipient_name: "<script>Recipient</script>",
  recipient_contact: "",
  purpose: "Sports & games",
  lines: [
    {
      product_id: "00000000-0000-4000-8000-000000000002",
      name: "Product",
      sku: "SKU",
      barcode: "BAR",
      quantity: 2,
      unit_value: 10,
      unit_cost: 6,
    },
  ],
  total_value: 20,
  document_hash: "hash",
  created_by: "issuer",
  created_by_name: "Issuer",
  created_at: "2026-10-24T00:00:00Z",
  status: "issued",
  given_at: "2026-10-24T01:00:00Z",
  given_by: "issuer",
  given_by_name: "Issuer",
  received_by: "Actual receiver",
  approved_by_name: "Approver",
} satisfies SponsorshipRecord;
it("prints escaped, recorded handover details without exposing cost", () => {
  const html = sponsorshipReceiptDetails(record, "24 Oct 2026 09:00");
  expect(html).toContain("&lt;script&gt;Recipient&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  for (const text of [
    "Actual receiver",
    "Issuer",
    "Approver",
    "24 Oct 2026 09:00",
    "SP-1",
    "20.00",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("6.00");
  expect(() =>
    sponsorshipReceiptDetails({ ...record, status: "requested", given_at: null }, "today"),
  ).toThrow(/recorded/);
});
it("strips cost from restricted responses and retains complete approval totals", () => {
  expect(visibleSponsorship(record, false).lines[0]).not.toHaveProperty("unit_cost");
  expect(visibleSponsorship(record, true).lines[0].unit_cost).toBe(6);
  expect(sponsorshipSnapshot(record).lines[0].lineTotal).toBe(20);
});
it("keeps mandatory approval enabled despite a stored bypass rule", () => {
  const rule = resolveRules(
    [
      {
        ...defaultRule("sponsorship"),
        mode: "none",
        isEnabled: false,
        requireReason: false,
        threshold: 1000,
      },
    ],
    "a",
  ).sponsorship;
  expect(rule).toMatchObject({
    mode: "request",
    isEnabled: true,
    requireReason: true,
    threshold: null,
  });
  for (const amount of [0, 1, 100])
    expect(canBypassAuthorization(rule, { userId: "owner", role: "admin" }, amount)).toBe(false);
});
it("makes sponsorship actions editable together without granting them by role", () => {
  for (const role of ["cashier", "warehouse", "supervisor"] as const) {
    const p = normalizePermissions({}, role);
    for (const key of [
      "can_view_sponsorship",
      "can_create_sponsorship",
      "can_approve_sponsorship",
      "can_issue_sponsorship",
    ])
      expect(hasPermission(p, key)).toBe(false);
  }
  expect(permissionEditableKeys("sponsorship").sort()).toEqual(
    [
      "can_view_sponsorship",
      "can_create_sponsorship",
      "can_approve_sponsorship",
      "can_issue_sponsorship",
    ].sort(),
  );
  expect(tablePermissionPage("routes/sponsorship#1")).toBe("sponsorship");
});
it("round trips the reporting toggle through the existing settings storage", () => {
  const settings = rowToSettings({
    integration_settings: { includeSponsorshipInDailySales: true },
  });
  expect(settings.integrations.includeSponsorshipInDailySales).toBe(true);
  const fields = [{ key: "pos_field:integration_settings", value: settings.integrations }];
  expect(
    rowToSettings(applySettingsFields({}, fields)).integrations.includeSponsorshipInDailySales,
  ).toBe(true);
  expect(rowToSettings({}).integrations.includeSponsorshipInDailySales === true).toBe(false);
});
it("rejects duplicate products and fractional quantities", () => {
  const input = {
    id: record.id,
    storeId: "a",
    numbering: { prefix: "SP-A-20261024", minimum: 1, padding: 4 },
    recipient: "Club",
    purpose: "Sports event",
    lines: [{ productId: record.lines[0].product_id, quantity: 1 }],
  };
  expect(sponsorshipInput.safeParse(input).success).toBe(true);
  expect(
    sponsorshipInput.safeParse({ ...input, lines: [...input.lines, ...input.lines] }).success,
  ).toBe(false);
  expect(
    sponsorshipInput.safeParse({ ...input, lines: [{ ...input.lines[0], quantity: 0.5 }] }).success,
  ).toBe(false);
});

it("shows discount and final value consistently to the approver and on the receipt", () => {
  const discounted = {
    ...record,
    total_value: 15,
    lines: [
      {
        ...record.lines[0],
        discount: 25,
        discount_type: "percent" as const,
        discount_amount: 5,
        line_value: 15,
      },
    ],
  };
  const snapshot = sponsorshipSnapshot(discounted);
  expect(snapshot).toMatchObject({ subtotal: 20, discount: 5, total: 15 });
  expect(snapshot.lines[0]).toMatchObject({ discount: 5, lineTotal: 15 });
  const receipt = sponsorshipReceiptDetails(discounted, "Today");
  expect(receipt).toContain("25%");
  expect(receipt).toContain("Discount 5.00");
  expect(receipt).toContain("Sponsored value 15.00");
  expect(sponsorshipLineAmounts(10, 2, 25, "percent")).toEqual({
    gross: 20,
    discount: 5,
    total: 15,
    valid: true,
  });
  expect(sponsorshipLineAmounts(10, 2, 21, "amount").valid).toBe(false);
});

it("also forbids sponsorship bypasses in the Windows local rule editor", () => {
  const { cleanRule } = createRequire(import.meta.url)(
    "../../../electron/db/repositories/authorization-rules.cjs",
  );
  const context = { branchId: "a", actor: "owner", isAdmin: true };
  const base = {
    actionKey: "sponsorship",
    scopeType: "global",
    mode: "request",
    requireReason: true,
  };
  expect(cleanRule(base, context)).toMatchObject({ mode: "request", require_reason: true });
  for (const patch of [
    { mode: "none" },
    { mode: "pin" },
    { threshold: 1 },
    { isEnabled: false },
    { requireReason: false },
  ])
    expect(() => cleanRule({ ...base, ...patch }, context)).toThrow(/always requires/);
});
