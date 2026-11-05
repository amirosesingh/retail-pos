-- FIN62 preparation prototype ONLY. Not a migration, deployed RPC or admission guard.
-- The caller must supply an already authorized branch/shift. This pure helper does
-- not authenticate callers, establish global completeness or persist a receipt.
-- One SQL statement sees one MVCC snapshot. Exact numeric strings survive JSON
-- consumers without rounding totals through JavaScript Number. Embedded payments
-- retain original JSON numbers: keep raw JSON bytes or use a lossless parser.
-- Full inputs are private.
CREATE SCHEMA IF NOT EXISTS fin62_preparation;
CREATE OR REPLACE FUNCTION fin62_preparation.shift_financial_basis(p_branch text,p_shift uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $basis$
WITH shift_scope AS MATERIALIZED (
 SELECT id,store_id,opening_float FROM public.shifts WHERE id=p_shift AND store_id=p_branch
), inputs AS MATERIALIZED (
 SELECT s.id,s.store_id,s.shift_id,s.total_amount,s.payment_type,s.payments,s.is_refunded,s.row_version
 FROM public.sales s JOIN shift_scope sh ON s.shift_id=sh.id::text AND s.store_id=sh.store_id
), parts AS (
 SELECT i.total_amount,
   CASE WHEN jsonb_typeof(i.payments)='array' THEN jsonb_array_length(i.payments)>0 ELSE false END split,
   lower(coalesce(i.payment_type,'')) method,p.cash,p.card,p.digital,p.paid
 FROM inputs i
 LEFT JOIN LATERAL (
  SELECT coalesce(sum((entry->>'amount')::numeric),0) paid,
   coalesce(sum((entry->>'amount')::numeric) FILTER(WHERE lower(entry->>'method')='cash'),0) cash,
   coalesce(sum((entry->>'amount')::numeric) FILTER(WHERE lower(entry->>'method')='card'),0) card,
   coalesce(sum((entry->>'amount')::numeric) FILTER(WHERE lower(entry->>'method') IN('wallet','bank_transfer','transfer','qr','online','ewallet')),0) digital
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.payments)='array' THEN i.payments ELSE '[]'::jsonb END) entry
 ) p ON true
 WHERE NOT coalesce(i.is_refunded,false)
), net AS (
 SELECT CASE WHEN split THEN CASE WHEN cash>0 THEN greatest(0,cash-greatest(0,paid-coalesce(total_amount,0))) ELSE cash END
   WHEN method='cash' THEN coalesce(total_amount,0) ELSE 0 END cash,
  CASE WHEN split THEN card WHEN method='card' THEN coalesce(total_amount,0) ELSE 0 END card,
  CASE WHEN split THEN digital WHEN method IN('wallet','bank_transfer','transfer','qr','online','ewallet') THEN coalesce(total_amount,0) ELSE 0 END digital
 FROM parts
)
SELECT jsonb_build_object(
 'prototypeVersion',1,'formula','current-sales-net-refund-v1','branchId',sh.store_id,'shiftId',sh.id,
 'openingFloat',coalesce(sh.opening_float,0)::text,
 'inputs',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',i.id,'branchId',i.store_id,'shiftId',i.shift_id,'totalAmount',i.total_amount::text,
   'paymentType',i.payment_type,'payments',i.payments,'refunded',i.is_refunded,'rowVersion',i.row_version::text
 ) ORDER BY i.id) FROM inputs i),'[]'::jsonb),
 'expected',jsonb_build_object(
  'cash',(SELECT round(coalesce(sh.opening_float,0)+coalesce(sum(cash),0),2)::text FROM net),
  'card',(SELECT round(coalesce(sum(card),0),2)::text FROM net),
  'digital',(SELECT round(coalesce(sum(digital),0),2)::text FROM net))
) FROM shift_scope sh;
$basis$;
REVOKE ALL ON FUNCTION fin62_preparation.shift_financial_basis(text,uuid) FROM PUBLIC;
