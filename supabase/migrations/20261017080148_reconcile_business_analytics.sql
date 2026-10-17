-- Read-only reporting definitions. No transaction rows or access policies are changed.
CREATE OR REPLACE VIEW public.v_sale_line_facts WITH (security_invoker = true) AS
WITH region AS (
  SELECT coalesce((SELECT name FROM pg_timezone_names
    WHERE name = (SELECT integration_settings->>'timeZone' FROM public.pos_settings WHERE id=1)), 'UTC') AS zone
), raw AS (
  SELECT si.*, p.cost_price AS fallback_cost, s.bill_number,s.store_id,s.cashier_name,s.created_at,s.payment_type,s.is_refunded,
    (s.created_at AT TIME ZONE region.zone)::date AS sale_day,
    to_char(s.created_at AT TIME ZONE region.zone,'YYYY-MM') AS sale_month,
    round((s.total_amount-coalesce(s.tax_amount,0)-coalesce(s.rounding_adjustment,0))::numeric,2) AS net_total,
    abs(si.unit_price*si.quantity)::numeric AS gross,
    least(abs(si.unit_price*si.quantity),abs(coalesce(si.coupon_discount,0)))::numeric AS coupon
  FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id LEFT JOIN public.products p ON p.id=si.product_id CROSS JOIN region
  WHERE NOT coalesce(s.is_refunded,false)
), discounted AS (
  SELECT raw.*, round(least(gross-coupon, greatest(0,
    CASE WHEN discount_percent>0 THEN (gross-coupon)*least(discount_percent,100)/100.0
    ELSE coalesce(discount_amount,0)*abs(quantity) END))::numeric,2) AS own_discount
  FROM raw
), weights AS (
  SELECT discounted.*, CASE WHEN is_foc THEN 0 ELSE
    (gross-coupon-own_discount)*(CASE WHEN quantity<0 THEN -1 ELSE 1 END) END AS weight
  FROM discounted
), totals AS (
  SELECT weights.*, sum(weight) OVER (PARTITION BY sale_id) AS weight_total,
    max(id::text) FILTER (WHERE weight<>0) OVER (PARTITION BY sale_id) AS last_line
  FROM weights
), allocated AS (
  SELECT totals.*, round((CASE WHEN weight_total<>0 THEN weight/weight_total*net_total ELSE 0 END)::numeric,2) AS allocated_revenue
  FROM totals
)
SELECT id AS line_id,sale_id,bill_number,store_id,cashier_name,created_at,sale_day,sale_month,
  payment_type,is_refunded,product_id,product_name,quantity,unit_price,unit_cost,is_foc,is_return,
  round((CASE WHEN quantity<>0 THEN own_discount/abs(quantity) ELSE 0 END)::numeric,2) AS unit_discount,
  own_discount*(CASE WHEN quantity<0 THEN -1 ELSE 1 END) AS line_discount,
  CASE WHEN id::text=last_line THEN net_total-sum(allocated_revenue) OVER (PARTITION BY sale_id)+allocated_revenue
       ELSE allocated_revenue END AS line_revenue,
  round((coalesce(unit_cost,fallback_cost,0)*quantity)::numeric,2) AS line_cost
FROM allocated;

CREATE OR REPLACE VIEW public.v_daily_store_sales WITH (security_invoker = true) AS
WITH region AS (
  SELECT coalesce((SELECT name FROM pg_timezone_names
    WHERE name = (SELECT integration_settings->>'timeZone' FROM public.pos_settings WHERE id=1)), 'UTC') AS zone
), facts AS (
  SELECT sale_id,sum(line_cost) AS cost,sum(line_discount) AS discount,
    sum(CASE WHEN is_foc THEN unit_price*quantity ELSE 0 END) AS foc_value,sum(quantity) AS units
  FROM public.v_sale_line_facts GROUP BY sale_id
)
SELECT (s.created_at AT TIME ZONE region.zone)::date AS sale_day,
  to_char(s.created_at AT TIME ZONE region.zone,'YYYY-MM') AS sale_month,s.store_id,
  count(*) AS bills,
  round(sum(s.total_amount-coalesce(s.tax_amount,0)-coalesce(s.rounding_adjustment,0))::numeric,2) AS revenue,
  round(sum(coalesce(f.cost,0))::numeric,2) AS cost,
  round(sum(s.total_amount-coalesce(s.tax_amount,0)-coalesce(s.rounding_adjustment,0)-coalesce(f.cost,0))::numeric,2) AS profit,
  round(sum(coalesce(f.discount,0))::numeric,2) AS discount,
  round(sum(coalesce(f.foc_value,0))::numeric,2) AS foc_value,
  round(sum(coalesce(f.units,0))::numeric,2) AS units
FROM public.sales s LEFT JOIN facts f ON f.sale_id=s.id CROSS JOIN region
WHERE NOT coalesce(s.is_refunded,false)
GROUP BY (s.created_at AT TIME ZONE region.zone)::date,to_char(s.created_at AT TIME ZONE region.zone,'YYYY-MM'),s.store_id;

CREATE OR REPLACE VIEW public.v_daily_item_sales WITH (security_invoker = true) AS
SELECT f.sale_day,f.sale_month,f.store_id,f.product_id,f.product_name,
  round(sum(f.quantity)::numeric,2) AS units,round(sum(f.line_revenue),2) AS revenue,
  round(sum(f.line_cost),2) AS cost,round(sum(f.line_revenue-f.line_cost),2) AS profit,
  coalesce(nullif(btrim(p.category),''),'Uncategorized') AS product_category
FROM public.v_sale_line_facts f LEFT JOIN public.products p ON p.id=f.product_id
GROUP BY f.sale_day,f.sale_month,f.store_id,f.product_id,f.product_name,coalesce(nullif(btrim(p.category),''),'Uncategorized');

REVOKE ALL ON public.v_sale_line_facts, public.v_daily_store_sales, public.v_daily_item_sales FROM anon;
GRANT SELECT ON public.v_sale_line_facts, public.v_daily_store_sales, public.v_daily_item_sales TO authenticated;
GRANT ALL ON public.v_sale_line_facts, public.v_daily_store_sales, public.v_daily_item_sales TO service_role;
