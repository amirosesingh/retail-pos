-- Read-only Retail POS Beta diagnosis/verification. Run through the explicitly
-- selected beta connection only. Returns no row payload, financial value,
-- staff credential or terminal ID. No business functions or writes are called.
WITH branch AS (
 SELECT s.id FROM public.stores s WHERE s.name='Beta Demo Shop'
), bound AS (
 SELECT b.id AS branch_id,t.id::text AS terminal_id
 FROM branch b CROSS JOIN LATERAL (
  SELECT token.id FROM public.terminal_tokens token WHERE token.location_id=b.id
   AND token.platform='pc' AND token.status IN ('active','used')
   AND token.revoked_at IS NULL AND token.is_claimed
  ORDER BY token.created_at DESC,token.id LIMIT 1
 ) t
), counts AS (
 SELECT c.table_name,c.row_count FROM bound b
 CROSS JOIN LATERAL public.pos_sync_counts_history_v2('default',b.branch_id,b.terminal_id,90) c
 WHERE c.table_name='sale_items'
), feed AS (
 SELECT f.*,b.branch_id AS requested_branch FROM bound b
 CROSS JOIN LATERAL public.pos_sync_pull_history_v2('default',b.branch_id,b.terminal_id,51,100) f
)
SELECT
 (SELECT count(*) FROM bound) AS verified_branch_bindings,
 (SELECT row_count FROM counts) AS scoped_sale_item_count,
 (SELECT count(*) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
  WHERE s.store_id IN (SELECT id FROM branch) AND NULLIF(btrim(i.branch_id),'') IS NULL) AS retained_legacy_own_items,
 (SELECT count(*) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
  WHERE s.store_id IN (SELECT id FROM branch) AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM s.store_id) AS explicit_scope_mismatches,
 (SELECT count(*) FROM feed) AS feed_rows,
 (SELECT max(cursor) FROM feed) AS feed_cursor,
 (SELECT count(*) FROM feed f WHERE f.table_name='sale_items' AND NOT f.tombstone) AS downloaded_sale_item_rows,
 (SELECT count(*) FROM feed f WHERE f.table_name='sale_items' AND NOT f.tombstone
  AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=(f.row_data->>'sale_id')::uuid AND s.store_id=f.requested_branch)) AS foreign_sale_item_rows,
 (SELECT count(*) FROM public.sync_change_feed f WHERE f.table_name='sale_items' AND f.branch_id='global' AND f.cursor>51 AND f.tombstone) AS historical_global_tombstones,
 (SELECT count(*) FROM public.sync_change_feed f WHERE f.table_name='sale_items'
  AND to_jsonb(f)->>'sale_parent_scope_verified'='true') AS verified_scope_metadata_events;
