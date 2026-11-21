-- Stock Report replica export preparation. Run as one owned transaction.
-- The relay exposes these rows only to the verified terminal's own branch.
BEGIN;

CREATE TABLE private.stock_history_replica_current (
 store_id text PRIMARY KEY,
 generation bigint NOT NULL CHECK(generation>0),
 snapshot_id uuid,
 source_key text
);
CREATE TABLE private.stock_history_replica_snapshots (
 id uuid PRIMARY KEY,
 store_id text NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 source_key text NOT NULL,
 baseline_id uuid NOT NULL REFERENCES public.stock_history_baselines(id),
 head_cursor bigint NOT NULL CHECK(head_cursor>=0),
 coverage_state text NOT NULL CHECK(coverage_state='complete'),
 coverage_from_ticks numeric(20,0) NOT NULL,
 coverage_through_ticks numeric(20,0) NOT NULL,
 baseline jsonb NOT NULL,
 manifest_pages jsonb NOT NULL,
 UNIQUE(store_id,generation)
);
CREATE TABLE private.stock_history_replica_pages (
 snapshot_id uuid NOT NULL REFERENCES private.stock_history_replica_snapshots(id) DEFERRABLE INITIALLY DEFERRED,
 page_number integer NOT NULL CHECK(page_number BETWEEN 0 AND 255),
 kind text NOT NULL CHECK(kind IN ('openings','movements')),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 100),
 payload text NOT NULL CHECK(octet_length(payload)<=245760),
 payload_hash text NOT NULL CHECK(payload_hash=encode(sha256(convert_to(payload,'UTF8')),'hex')),
 PRIMARY KEY(snapshot_id,page_number)
);
ALTER TABLE private.stock_history_replica_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.stock_history_replica_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.stock_history_replica_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_replica_current,private.stock_history_replica_snapshots,
 private.stock_history_replica_pages FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_replica_snapshot_immutable BEFORE UPDATE OR DELETE ON private.stock_history_replica_snapshots
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();
CREATE TRIGGER stock_history_replica_page_immutable BEFORE UPDATE OR DELETE ON private.stock_history_replica_pages
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_replica_scope(p_branch text,p_terminal text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_branch IS NULL OR p_terminal IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.terminal_tokens d WHERE d.id::text=p_terminal AND d.location_id=p_branch
   AND d.platform='pc' AND d.status IN('active','used') AND d.revoked_at IS NULL
   AND (d.is_claimed OR d.claimed_at IS NOT NULL) AND NOT COALESCE(d.management_sync_enabled,false))
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_replica_scope(text,text) FROM PUBLIC,anon,authenticated,service_role;

-- No certificate is synthesized here. The existing certified head must still
-- agree with the append-only capture state and the selected verified opening.
CREATE FUNCTION private.stock_history_replica_source(p_branch text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT encode(sha256(convert_to(jsonb_build_array(h.store_id,h.baseline_id,h.committed_cursor::text,
  h.coverage_generation::text,h.coverage_from_ticks::text,h.coverage_through_ticks::text,
  b.evidence_hash,e.capture->>'revision')::text,'UTF8')),'hex')
 FROM public.stock_history_heads h JOIN public.stock_history_baselines b ON b.id=h.baseline_id AND b.store_id=h.store_id
 CROSS JOIN LATERAL (SELECT private.stock_history_capture_state(p_branch,b.id) capture) e
 WHERE h.store_id=p_branch AND h.coverage_state='complete' AND b.verification_state='verified'
  AND h.coverage_from_ticks=b.cutoff_ticks AND h.coverage_through_ticks>=b.cutoff_ticks
  AND h.committed_cursor>=b.source_cursor AND e.capture->>'unvalidatedEffects'='0' AND e.capture->>'captureGaps'='0'
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_replica_source(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_save_replica_page(p_snapshot uuid,p_index integer,p_kind text,p_count integer,p_bytes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE hash text:=encode(sha256(convert_to(p_bytes,'UTF8')),'hex');
BEGIN
 IF p_index>=256 OR octet_length(p_bytes)>245760 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
 INSERT INTO private.stock_history_replica_pages VALUES(p_snapshot,p_index,p_kind,p_count,p_bytes,hash);
 RETURN jsonb_build_array(p_kind,p_count,hash);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_save_replica_page(uuid,integer,text,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_build_replica_snapshot(p_branch text,p_key text,p_generation bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE h public.stock_history_heads%ROWTYPE; b public.stock_history_baselines%ROWTYPE;
 snapshot uuid:=gen_random_uuid(); group_kind text; packed text:='['; page_count integer:=0; page_id integer:=0;
 total_bytes integer:=0; seen_openings bigint:=0; next_cursor bigint; item record; pages jsonb:='[]'; row_bytes integer;
BEGIN
 SELECT * INTO STRICT h FROM public.stock_history_heads WHERE store_id=p_branch FOR SHARE;
 SELECT * INTO STRICT b FROM public.stock_history_baselines WHERE id=h.baseline_id AND store_id=p_branch;
 IF p_key IS DISTINCT FROM private.stock_history_replica_source(p_branch)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_CHANGED'; END IF;
 IF b.expected_pairs>20000 OR h.committed_cursor-b.source_cursor>20000 OR octet_length(b.terminal_watermarks::text)>262144
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;

 next_cursor:=b.source_cursor;
 FOR item IN
  (SELECT 'openings'::text kind, o.product_id product, 0::bigint cursor,
    jsonb_build_array(o.id,o.product_id,o.quantity::text,o.product_name,o.sku,o.barcode,o.owner_store_id)::text payload
   FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch
   UNION ALL
   SELECT 'movements', NULL::uuid, m.ingested_cursor,
    jsonb_build_array(m.ingested_cursor::text,to_char(m.ingested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
     m.payload_hash,m.payload_json)::text
   FROM public.stock_history_movements m
   WHERE m.store_id=p_branch AND m.ingested_cursor>b.source_cursor AND m.ingested_cursor<=h.committed_cursor
     AND m.effective_ticks>b.cutoff_ticks AND m.effective_ticks<=h.coverage_through_ticks AND m.clock_state='verified'
     AND m.payload_hash=encode(sha256(convert_to(m.payload_json,'UTF8')),'hex')
     AND jsonb_array_length(m.payload_json::jsonb)=18
     AND (m.payload_json::jsonb)->0='1'::jsonb
     AND ((m.payload_json::jsonb)->>1,(m.payload_json::jsonb)->>2,(m.payload_json::jsonb)->>3,
      (m.payload_json::jsonb)->>4,(m.payload_json::jsonb)->>5,(m.payload_json::jsonb)->>6,
      (m.payload_json::jsonb)->>7,(m.payload_json::jsonb)->>8,(m.payload_json::jsonb)->>9,
      (m.payload_json::jsonb)->>10,(m.payload_json::jsonb)->>11,(m.payload_json::jsonb)->>12,
      (m.payload_json::jsonb)->>13,(m.payload_json::jsonb)->>14,(m.payload_json::jsonb)->>15)
     IS NOT DISTINCT FROM (m.id::text,m.operation_id::text,m.product_id::text,m.store_id,m.terminal_id,m.actor_id,
      m.source_kind,m.quantity_delta::text,m.effective_at_raw,m.effective_ticks::text,m.recorded_at_raw,
      m.product_name,m.sku,m.barcode,m.clock_state)
     AND EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch AND o.product_id=m.product_id))
  ORDER BY kind DESC,product,cursor
 LOOP
  IF item.kind='openings' THEN seen_openings:=seen_openings+1;
  ELSE
   next_cursor:=next_cursor+1;
   IF item.cursor<>next_cursor THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_PREFIX_INVALID'; END IF;
  END IF;
  row_bytes:=octet_length(item.payload);
  IF row_bytes>245758 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
  IF page_count>0 AND (item.kind<>group_kind OR page_count=100 OR octet_length(packed)+row_bytes+2>245760) THEN
   pages:=pages||jsonb_build_array(private.stock_history_save_replica_page(snapshot,page_id,group_kind,page_count,packed||']'));
   total_bytes:=total_bytes+octet_length(packed)+1;
   IF total_bytes>33554432 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
   page_id:=page_id+1;page_count:=0;packed:='[';
  END IF;
  group_kind:=item.kind;
  packed:=packed||CASE WHEN page_count=0 THEN '' ELSE ',' END||item.payload;
  page_count:=page_count+1;
 END LOOP;
 IF page_count>0 THEN
  pages:=pages||jsonb_build_array(private.stock_history_save_replica_page(snapshot,page_id,group_kind,page_count,packed||']'));
  total_bytes:=total_bytes+octet_length(packed)+1;
 END IF;
 IF total_bytes>33554432 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
 IF seen_openings<>b.expected_pairs OR next_cursor<>h.committed_cursor
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_PREFIX_INVALID'; END IF;
 IF p_key IS DISTINCT FROM private.stock_history_replica_source(p_branch)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_CHANGED'; END IF;
 INSERT INTO private.stock_history_replica_snapshots VALUES(snapshot,p_branch,p_generation,p_key,b.id,h.committed_cursor,
  h.coverage_state,h.coverage_from_ticks,h.coverage_through_ticks,jsonb_build_array(b.id,b.cutoff_at_raw,b.captured_at_raw,
   b.source_cursor::text,b.opening_kind,b.expected_pairs,b.verified_by,b.evidence_hash,b.terminal_watermarks::text),pages);
 RETURN snapshot;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_build_replica_snapshot(text,text,bigint)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_replica_manifest_json(p private.stock_history_replica_snapshots) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT jsonb_build_object('snapshotId',p.id,'headCursor',p.head_cursor::text,
  'coverageGeneration',p.generation::text,'coverageState',p.coverage_state,'coverageFrom',p.coverage_from_ticks::text,
  'coverageThrough',p.coverage_through_ticks::text,'baseline',p.baseline,'pages',p.manifest_pages)
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_replica_manifest_json(private.stock_history_replica_snapshots)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_replica_manifest(p_branch text,p_terminal text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE current_row private.stock_history_replica_current%ROWTYPE; saved private.stock_history_replica_snapshots%ROWTYPE;
 current_key text; next_generation bigint; pinned uuid;
BEGIN
 PERFORM private.stock_history_replica_scope(p_branch,p_terminal);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('stock-history-replica:'||p_branch,0))
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_BUSY'; END IF;
 SELECT * INTO current_row FROM private.stock_history_replica_current WHERE store_id=p_branch;
 current_key:=private.stock_history_replica_source(p_branch);
 IF current_key IS NOT NULL AND current_key IS DISTINCT FROM current_row.source_key THEN
  next_generation:=COALESCE(current_row.generation,0)+1;
  BEGIN
   pinned:=private.stock_history_build_replica_snapshot(p_branch,current_key,next_generation);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN ('STOCK_HISTORY_REPLICA_TOO_LARGE','STOCK_HISTORY_REPLICA_PREFIX_INVALID','STOCK_HISTORY_REPLICA_CHANGED')
   THEN RAISE; END IF;
   pinned:=NULL; current_key:=NULL;
  END;
  IF pinned IS NOT NULL THEN
   INSERT INTO private.stock_history_replica_current VALUES(p_branch,next_generation,pinned,current_key)
   ON CONFLICT(store_id) DO UPDATE SET generation=EXCLUDED.generation,snapshot_id=EXCLUDED.snapshot_id,source_key=EXCLUDED.source_key
   RETURNING * INTO current_row;
  END IF;
 END IF;
 IF current_key IS NULL THEN
  IF current_row.snapshot_id IS NOT NULL THEN
   UPDATE private.stock_history_replica_current SET generation=generation+1,snapshot_id=NULL,source_key=NULL
    WHERE store_id=p_branch RETURNING * INTO current_row;
  END IF;
  RETURN jsonb_build_object('manifest',NULL)||CASE WHEN current_row.generation IS NULL THEN '{}'::jsonb
   ELSE jsonb_build_object('withdrawal',jsonb_build_object('coverageGeneration',current_row.generation::text)) END;
 END IF;
 SELECT * INTO STRICT saved FROM private.stock_history_replica_snapshots WHERE id=current_row.snapshot_id AND store_id=p_branch;
 RETURN jsonb_build_object('manifest',private.stock_history_replica_manifest_json(saved));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_replica_manifest(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_replica_manifest(text,text) TO service_role;

CREATE FUNCTION public.pos_stock_history_replica_page(p_branch text,p_terminal text,p_snapshot uuid,p_index integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE saved record;
BEGIN
 PERFORM private.stock_history_replica_scope(p_branch,p_terminal);
 SELECT page.snapshot_id,page.page_number,page.kind,page.payload,private.stock_history_replica_manifest_json(snap) manifest
 INTO saved FROM private.stock_history_replica_pages page
 JOIN private.stock_history_replica_current pub ON pub.snapshot_id=page.snapshot_id AND pub.store_id=p_branch
 JOIN private.stock_history_replica_snapshots snap ON snap.id=page.snapshot_id AND snap.store_id=p_branch
 WHERE page.snapshot_id=p_snapshot AND page.page_number=p_index AND pub.source_key=private.stock_history_replica_source(p_branch);
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_CHANGED'; END IF;
 RETURN jsonb_build_object('manifest',saved.manifest,'snapshotId',saved.snapshot_id,'index',saved.page_number,'kind',saved.kind,'rowsJson',saved.payload);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_replica_page(text,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_replica_page(text,text,uuid,integer) TO service_role;

COMMIT;
