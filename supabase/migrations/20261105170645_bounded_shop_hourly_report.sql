-- Preparation only: bounded read for the existing authorized trading report.
-- No existing routines, grants, policies or business records are replaced.
DO $preflight$
BEGIN
  IF to_regprocedure('public.pos_report_store_hours(date,date,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Hourly report routine already exists; review its definition before upgrade';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.pos_report_store_hours(p_from date, p_to date, p_store_ids text[])
RETURNS TABLE(store_id text, hour integer, bills bigint, revenue numeric, cost numeric, profit numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $report$
DECLARE zone text;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
     OR p_from > p_to OR p_to - p_from >= 3660
     OR cardinality(p_store_ids) IS NULL OR cardinality(p_store_ids) NOT BETWEEN 1 AND 100
     OR EXISTS(SELECT 1 FROM unnest(p_store_ids) x WHERE x IS NULL OR btrim(x) = '' OR length(x) > 64)
     OR EXISTS(SELECT 1 FROM unnest(p_store_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.stores s WHERE s.id=x)) THEN
    RAISE EXCEPTION 'Choose a valid bounded date range and existing report branches' USING ERRCODE='22023';
  END IF;
  SELECT coalesce((SELECT n.name FROM pg_catalog.pg_timezone_names n
    WHERE n.name=(SELECT s.integration_settings->>'timeZone' FROM public.pos_settings s WHERE s.id=1)), 'UTC') INTO zone;
  RETURN QUERY
    WITH selected_bills AS MATERIALIZED (
      SELECT s.id,s.store_id,s.created_at,
        s.total_amount-coalesce(s.tax_amount,0)-coalesce(s.rounding_adjustment,0) AS net
      FROM public.sales s
      WHERE s.store_id=ANY(p_store_ids) AND NOT coalesce(s.is_refunded,false)
        AND s.created_at >= (p_from::timestamp AT TIME ZONE zone)
        AND s.created_at < ((p_to+1)::timestamp AT TIME ZONE zone)
    ), costs AS (
      SELECT si.sale_id,sum(round((coalesce(si.unit_cost,p.cost_price,0)*si.quantity)::numeric,2)) AS amount
      FROM selected_bills b JOIN public.sale_items si ON si.sale_id=b.id
      LEFT JOIN public.products p ON p.id=si.product_id GROUP BY si.sale_id
    )
    SELECT b.store_id,extract(hour FROM b.created_at AT TIME ZONE zone)::integer,count(*),
      round(sum(b.net)::numeric,2),round(sum(coalesce(c.amount,0))::numeric,2),
      round(sum(b.net-coalesce(c.amount,0))::numeric,2)
    FROM selected_bills b LEFT JOIN costs c ON c.sale_id=b.id
    GROUP BY b.store_id,extract(hour FROM b.created_at AT TIME ZONE zone)::integer
    ORDER BY b.store_id,extract(hour FROM b.created_at AT TIME ZONE zone)::integer;
END;
$report$;
REVOKE ALL ON FUNCTION public.pos_report_store_hours(date,date,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_report_store_hours(date,date,text[]) TO service_role;
COMMENT ON FUNCTION public.pos_report_store_hours(date,date,text[]) IS
  'Service-only bounded report read. The application verifies current staff, cost permission and fixed-terminal/management branch scope before and after this read. Maximum 100 branches x 24 hours. No writes.';
