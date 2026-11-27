-- Prepared Beta schema only. Reissue an exact existing movement receipt when
-- the original proof is missing from its local copy. This admits no new claim.
-- The migration runner owns the schema transaction.

CREATE OR REPLACE FUNCTION public.pos_stock_history_recover_accepted_receipts(
 p_project text,p_branch text,p_terminal text,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE candidate jsonb; receipt record; seen uuid[]:=ARRAY[]::uuid[]; movement uuid;
 receipts jsonb:='[]'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 IF p_project IS NULL OR length(p_project)>2048 OR p_branch IS NULL OR p_terminal IS NULL
  OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 8 OR octet_length(convert_to(p_rows::text,'UTF8'))>126976
  THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
 IF NOT EXISTS(SELECT FROM public.terminal_tokens t
  WHERE t.id::text COLLATE "C"=p_terminal AND t.location_id COLLATE "C"=p_branch AND t.platform='pc'
   AND t.status IN('active','used') AND t.revoked_at IS NULL AND (t.is_claimed OR t.claimed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN';END IF;

 FOR candidate IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(candidate))<>3
   OR COALESCE(candidate->>'id','') COLLATE "C"!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   OR COALESCE(candidate->>'payloadHash','') COLLATE "C"!~'^[0-9a-f]{64}$'
   OR jsonb_typeof(candidate->'payloadJson') IS DISTINCT FROM 'string'
   THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
  movement:=(candidate->>'id')::uuid;
  IF movement=ANY(seen) THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
  seen:=array_append(seen,movement);

  SELECT r.payload_hash,r.ingested_cursor,r.accepted_at,r.effect_ids INTO receipt
  FROM private.stock_history_claim_receipts r
  JOIN public.stock_history_movements m ON m.id=r.movement_id
  JOIN pos_sync_private.shift_author_keys k ON k.key_id=r.key_id AND k.author_id=r.author_id
   AND k.project_origin COLLATE "C"=p_project AND k.terminal_id COLLATE "C"=p_terminal
  WHERE r.movement_id=movement AND r.store_id COLLATE "C"=p_branch AND r.terminal_id COLLATE "C"=p_terminal
   AND m.store_id COLLATE "C"=p_branch AND m.terminal_id COLLATE "C"=p_terminal AND m.actor_id COLLATE "C"=r.author_id::text
   AND m.ingested_cursor=r.ingested_cursor AND m.ingested_at=r.accepted_at
   AND r.payload_hash COLLATE "C"=candidate->>'payloadHash' AND m.payload_hash COLLATE "C"=r.payload_hash
   AND convert_to(r.payload_json,'UTF8')=convert_to(candidate->>'payloadJson','UTF8')
   AND convert_to(m.payload_json,'UTF8')=convert_to(r.payload_json,'UTF8')
   AND r.payload_hash=encode(sha256(convert_to(r.payload_json,'UTF8')),'hex');
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_REQUIRED';END IF;

  receipts:=receipts||jsonb_build_array(jsonb_build_object('id',movement,'payloadHash',receipt.payload_hash,
   'ingestedCursor',receipt.ingested_cursor::text,'acceptedAt',
   to_char(receipt.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z','effectIds',to_jsonb(receipt.effect_ids)));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'version',1,'branchId',p_branch,'terminalId',p_terminal,'receipts',receipts);
END $fn$;

REVOKE ALL ON FUNCTION public.pos_stock_history_recover_accepted_receipts(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_recover_accepted_receipts(text,text,text,jsonb) TO service_role;
