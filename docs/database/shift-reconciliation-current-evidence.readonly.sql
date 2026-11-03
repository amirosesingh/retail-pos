-- SELECT-only evidence refresh for the exact eight SHIFT49 candidates.
-- ROSEGILL / pos qhrufhtbeguxydenzfey / postgres. No amounts or payloads returned.
-- Hashes are evidence fingerprints, not permission to repair or graph tokens.
WITH wanted(id, held) AS (VALUES
 ('2e735bd8-0db2-44fb-a6f7-e28edc64f7e0'::uuid,false),
 ('85902cc1-9804-4d6f-af4f-f73a1e7799b8'::uuid,false),
 ('d252a275-ebf7-4a09-8cd7-a45706c594a3'::uuid,false),
 ('a23393c7-a38b-4bcb-93fe-1a3b057e0fe2'::uuid,false),
 ('f725325a-8919-4d9d-b9cb-24f43d185147'::uuid,false),
 ('8be4c1e9-3f88-4e7b-b52f-a6f31b5005c8'::uuid,false),
 ('acbc1ed1-2fc1-44c7-9c71-c338da7fda2f'::uuid,false),
 ('1a349429-cea1-4f45-8d2b-36678d37ad27'::uuid,true)
)
SELECT w.id AS shift_id,w.held AS authority_repair_on_hold,
 s.id IS NOT NULL AS parent_exists,s.store_id,s.opened_at,s.closed_at,s.row_version,
 md5(to_jsonb(s)::text) AS parent_fingerprint,
 s.status='CLOSED' AND s.state='CLOSED' AND s.closed_at IS NOT NULL AS closed_header_valid,
 s.expected_cash IS NULL AND s.expected_card IS NULL AND s.expected_digital IS NULL
  AND s.variance_cash IS NULL AND s.variance_total IS NULL AS exactly_five_destinations_null,
 c.total AS count_rows,c.originals AS original_count_rows,r.total AS reconciliation_rows,
 r.id AS reconciliation_id,r.count_id,md5(r.payload::text) AS reconciliation_fingerprint,
 c.ids AS count_ids,c.fingerprint AS counts_fingerprint,
 r.store_id IS NOT DISTINCT FROM s.store_id AS reconciliation_branch_matches,
 cc.id IS NOT NULL AND cc.kind='ORIGINAL' AND cc.shift_id=s.id AND cc.store_id=s.store_id
  AS original_link_valid,
 ROW(cc.counted_cash,cc.counted_card,cc.counted_digital) IS NOT DISTINCT FROM
  ROW(r.counted_cash,r.counted_card,r.counted_digital) AS count_reconciliation_tenders_match,
 ROW(COALESCE(s.final_counted_cash,s.counted_cash),s.counted_card,s.counted_digital,
  s.variance_card,s.variance_digital,s.variance_status) IS NOT DISTINCT FROM
  ROW(r.counted_cash,r.counted_card,r.counted_digital,
  r.variance_card,r.variance_digital,r.variance_status) AS untouched_summaries_match,
 md5(pos_sync_private.shift_graph(s.id)::text) AS entire_graph_fingerprint
FROM wanted w
LEFT JOIN public.shifts s ON s.id=w.id
LEFT JOIN LATERAL (
 SELECT count(*) AS total,count(*) FILTER(WHERE x.kind='ORIGINAL') AS originals,
  array_agg(x.id ORDER BY x.id) AS ids,
  md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) AS fingerprint
 FROM public.shift_cash_counts x WHERE x.shift_id=w.id
) c ON true
LEFT JOIN LATERAL (
 SELECT x.*,to_jsonb(x) AS payload,count(*) OVER() AS total
 FROM public.shift_reconciliations x WHERE x.shift_id=w.id ORDER BY x.id
) r ON true
LEFT JOIN public.shift_cash_counts cc ON cc.id=r.count_id
ORDER BY w.held,s.opened_at,w.id;
