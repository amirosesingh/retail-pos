-- Add a category dimension to the bounded daily analytics feed. The view
-- remains SECURITY INVOKER so product and sale-line RLS still applies to the
-- signed-in reporting user.
CREATE OR REPLACE VIEW public.v_daily_item_sales
WITH (security_invoker = true) AS
SELECT
  f.sale_day,
  f.sale_month,
  f.store_id,
  f.product_id,
  f.product_name,
  round(sum(f.quantity), 2) AS units,
  round(sum(f.line_revenue), 2) AS revenue,
  round(sum(f.line_cost), 2) AS cost,
  round(sum(f.line_revenue - f.line_cost), 2) AS profit,
  COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized') AS product_category
FROM public.v_sale_line_facts f
LEFT JOIN public.products p ON p.id = f.product_id
GROUP BY
  f.sale_day,
  f.sale_month,
  f.store_id,
  f.product_id,
  f.product_name,
  COALESCE(NULLIF(btrim(p.category), ''), 'Uncategorized');

REVOKE ALL ON TABLE public.v_daily_item_sales FROM anon;
GRANT SELECT ON TABLE public.v_daily_item_sales TO authenticated;
GRANT ALL ON TABLE public.v_daily_item_sales TO service_role;
