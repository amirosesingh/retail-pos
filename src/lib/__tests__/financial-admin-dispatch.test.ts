import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn(), ready: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ validator: (parse: (data: unknown) => unknown) => ({ handler: (handle: (value: { data: unknown }) => unknown) => (value: { data: unknown }) => handle({ data: parse(value.data) }) }) }) }));
vi.mock('@/core/api/pos-relay.server', () => ({ serviceRest: mocks.rest, verifyRelayCaller: async () => ({}) }));
vi.mock('@/core/api/relay-policy.server', () => ({ resolveRelayScope: mocks.scope }));
vi.mock('../privileged-caller.server', () => ({ requireCallerScope: mocks.scope }));
vi.mock('../financial-live-readiness.server', () => ({ financialLiveAdapterReady: mocks.ready }));
import { correctSaleTender } from '../tender-correction.functions';
import { correctPostedSale } from '../sale-corrections.functions';
import { addMissedBill } from '../missed-bill.functions';
const id = '11111111-1111-4111-8111-111111111111';
const administrator = { kind: 'staff', role: 'admin', roleSlug: 'admin', storeId: 'A', appUserId: id, staffUserId: 'verified-admin', label: 'Admin', actorName: 'Admin', terminalId: 'till-a' };
const tender = { saleId: id, storeId: 'A', method: 'card' };
const sale = {
  saleId: id, storeId: 'A', expectedVersion: 2, clientKey: id, reason: 'Correct original bill',
  totals: { subtotal_amount: 10, discount_amount: 0, tax_amount: 0, total_amount: 10, coupon_discount: 0 },
  items: [{ id, product_id: null, product_name: 'Service', variant_code: null, unit_price: 10, unit_cost: 0, quantity: 1, discount_percent: 0, discount_amount: 0, tax_rate: 0, is_return: false as const, is_foc: false, promo_id: null, coupon_code: null, coupon_discount: 0 }],
};
const missed = {
  storeId: 'A', clientKey: id, originalReference: 'Paper 1', occurredAt: '2026-01-01T10:00:00Z', cashierId: 'cashier', originalShiftId: id,
  reason: 'Original bill not entered', stockHandling: 'already_corrected' as const, stockReason: 'Previously counted',
  items: [{ productId: id, quantity: 1, unitPrice: 10, unitCost: 4, discountAmount: 0, taxAmount: 0 }], payments: [{ method: 'cash' as const, amount: 10 }],
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.scope.mockResolvedValue(administrator); mocks.ready.mockResolvedValue(true);
  mocks.rest.mockImplementation(async () => Response.json({ saleId: id, receiptNo: 'MB-1', sale: {}, items: [] }));
});

describe('administrator financial adapter compatibility', () => {
  it('sends only the verified author to sale correction and retains every business argument', async () => {
    expect((await correctPostedSale({ data: sale })).ok).toBe(true);
    const [path, init] = mocks.rest.mock.calls[0];
    expect(path).toBe('rpc/pos_live_financial_admin_correct_sale');
    expect(JSON.parse(init.body)).toEqual({ p_author: id, p_sale: id, p_store: 'A', p_expected_version: 2, p_items: sale.items, p_totals: sale.totals, p_reason: sale.reason, p_terminal: 'till-a', p_client_key: id });
  });
  it('retains tender correction terminal attribution without accepting a supplied author', async () => {
    expect((await correctSaleTender({ data: { ...tender, p_author: 'forged' } })).ok).toBe(true);
    expect(mocks.rest.mock.calls[0][0]).toBe('rpc/pos_live_financial_admin_correct_tender');
    expect(JSON.parse(mocks.rest.mock.calls[0][1].body)).toEqual({ p_author: id, p_sale: id, p_store: 'A', p_method: 'card', p_terminal: 'till-a' });
  });
  it('preserves missed-bill historical attribution and removes authentication material', async () => {
    expect((await addMissedBill({ data: { ...missed, sessionToken: 'private-session', deviceBindingProof: 'a'.repeat(64) } })).ok).toBe(true);
    expect(mocks.rest.mock.calls[0][0]).toBe('rpc/pos_live_financial_admin_add_missed_bill');
    const body = JSON.parse(mocks.rest.mock.calls[0][1].body);
    expect(body).toEqual({ p_author: id, p_terminal: 'till-a', p_entry: missed });
    expect(JSON.stringify(body)).not.toContain('private-session');
  });
  it('checks administrator and branch restrictions before capability or writes', async () => {
    for (const scope of [{ ...administrator, role: 'staff', roleSlug: 'cashier' }, { ...administrator, storeId: 'B' }]) {
      mocks.scope.mockResolvedValue(scope);
      expect((await correctPostedSale({ data: sale })).ok).toBe(false);
      expect((await correctSaleTender({ data: tender })).ok).toBe(false);
      expect((await addMissedBill({ data: missed })).ok).toBe(false);
    }
    expect(mocks.ready).not.toHaveBeenCalled(); expect(mocks.rest).not.toHaveBeenCalled();
  });
  it('preserves the three legacy calls only when the capability is absent', async () => {
    mocks.ready.mockResolvedValue(false);
    await correctPostedSale({ data: sale }); await correctSaleTender({ data: tender }); await addMissedBill({ data: missed });
    expect(mocks.rest.mock.calls.map(([path]) => path)).toEqual(['rpc/pos_admin_correct_sale', 'rpc/pos_admin_correct_tender', 'rpc/pos_admin_add_missed_bill']);
  });
  it('does not downgrade after a new adapter fails', async () => {
    mocks.rest.mockImplementation(async () => Response.json({ code: 'P0001' }, { status: 409 }));
    expect((await correctPostedSale({ data: sale })).ok).toBe(false);
    expect(mocks.rest).toHaveBeenCalledTimes(1);
    expect(mocks.rest.mock.calls[0][0]).toBe('rpc/pos_live_financial_admin_correct_sale');
  });
  it('never writes when readiness cannot be verified', async () => {
    mocks.ready.mockRejectedValue(new Error('Financial validation unavailable'));
    expect((await correctPostedSale({ data: sale })).ok).toBe(false);
    expect((await correctSaleTender({ data: tender })).ok).toBe(false);
    expect((await addMissedBill({ data: missed })).ok).toBe(false);
    expect(mocks.rest).not.toHaveBeenCalled();
  });
});
