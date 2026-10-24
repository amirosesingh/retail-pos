/**
 * One shared margin engine so the item report and the analytics board can
 * never disagree on revenue, cost or profit.
 */
import { lineDiscountTotal, lineUnitDiscount, r2, type CartLine, type Product, type Sale } from "@/core/types/pos-types";
import { indexProducts, lineCost, saleLineRevenues, saleLineTaxes, type ProductLookup } from "@/core/pricing/profit";

export type SoldLine = {
  saleId: string;
  receiptNo: string;
  createdAt: string;
  storeId: string;
  cashier: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  category: string;
  qty: number;
  price: number;
  unitDiscount: number;
  discount: number;
  /** Item coupon already included in the line discount total. */
  couponDiscount?: number;
  taxRate: number;
  tax: number;
  revenue: number;
  unitCost: number;
  cost: number;
  profit: number;
  marginPct: number;
  /** true when the cost came from the product record, not the bill */
  estimatedCost: boolean;
  credit: boolean;
  foc: boolean;
};

const lineOf = (
  s: Sale,
  l: CartLine,
  products: ProductLookup,
  revenue: number,
  tax: number,
): SoldLine => {
  const p = products.get(l.productId);
  const unitDiscount = lineUnitDiscount(l);
  const estimatedCost = l.cost == null;
  const unitCost = l.cost ?? p?.cost ?? 0;
  const cost = lineCost(l, products);
  const profit = r2(revenue - cost);
  return {
    saleId: s.id,
    receiptNo: s.receiptNo,
    createdAt: s.createdAt,
    storeId: s.storeId,
    cashier: s.cashier,
    productId: l.productId,
    name: l.name,
    sku: p?.sku ?? "",
    barcode: p?.barcode ?? "",
    unit: p?.unit ?? "",
    category: p?.category ?? "",
    qty: l.qty,
    price: l.price,
    unitDiscount,
    discount: lineDiscountTotal(l) * (l.qty < 0 ? -1 : 1),
    couponDiscount: Math.min(Math.abs(l.price * l.qty), Math.abs(l.couponDiscount || 0)) * (l.qty < 0 ? -1 : 1),
    taxRate: l.taxRate ?? 0,
    tax,
    revenue,
    unitCost,
    cost,
    profit,
    marginPct: revenue ? r2((profit / revenue) * 100) : 0,
    estimatedCost,
    credit: !!l.credit,
    foc: !!l.foc,
  };
};

/** Flatten every bill in the window into one row per sold line. */
export const soldLines = (sales: Sale[], products: Product[]): SoldLine[] => {
  const byId = indexProducts(products);
  return sales.flatMap((sale) => {
    const revenues = saleLineRevenues(sale);
    const taxes = saleLineTaxes(sale);
    return sale.lines.map((line, index) =>
      lineOf(sale, line, byId, revenues[index] ?? 0, taxes[index] ?? 0),
    );
  });
};

export const sumLines = (rows: SoldLine[]) => {
  const revenue = r2(rows.reduce((a, r) => a + r.revenue, 0));
  const cost = r2(rows.reduce((a, r) => a + r.cost, 0));
  const profit = r2(revenue - cost);
  return {
    lines: rows.length,
    units: r2(rows.reduce((a, r) => a + r.qty, 0)),
    revenue,
    cost,
    profit,
    discount: r2(rows.reduce((a, r) => a + r.discount, 0)),
    marginPct: revenue ? r2((profit / revenue) * 100) : 0,
  };
};

/** Everything the shop gave away on a set of bills. */
export const savingsOf = (sales: Sale[], rows: SoldLine[]) => {
  const manual = (row: SoldLine) => row.discount - (row.couponDiscount ?? 0);
  const lineDiscount = r2(rows.filter(row => !row.foc).reduce((sum, row) => sum + manual(row), 0));
  const focValue = r2(rows.filter(row => row.foc).reduce((sum, row) => sum + row.price * row.qty, 0));
  const allCoupons = sales.reduce((sum, sale) => sum + (sale.couponDiscount ?? 0), 0);
  const giftCoupons = rows.filter(row => row.foc).reduce((sum, row) => sum + (row.couponDiscount ?? 0), 0);
  const coupon = r2(Math.max(0, allCoupons - giftCoupons));
  const billDiscount = r2(Math.max(sales.reduce((sum, sale) => sum + sale.discount, 0) -
    rows.reduce((sum, row) => sum + manual(row), 0) - allCoupons, 0));
  return {
    lineDiscount,
    billDiscount,
    coupon,
    focValue,
    total: r2(lineDiscount + billDiscount + coupon + focValue),
  };
};
