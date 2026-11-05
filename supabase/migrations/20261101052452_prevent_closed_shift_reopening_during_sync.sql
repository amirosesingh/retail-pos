-- SHIFT-32: a delayed opening snapshot must never reopen a saved closed shift.
-- Preparation/isolated tests only; live application needs exact-project approval.
-- Change the upsert predicate and existing shared fresh/replay validation only.
BEGIN;
DO $migration$
DECLARE
  signature regprocedure := to_regprocedure('public.sync_apply_shifts(jsonb)');
  proof_signature regprocedure := to_regprocedure('public.pos_sync_shift_closure_ack(jsonb,text)');
  definition text;
  normalized text;
  updated text;
  proof_definition text;
  proof_normalized text;
  proof_updated text;
  version_anchor text := 'WHERE EXCLUDED."row_version">public."shifts"."row_version" AND EXCLUDED."store_id"=public."shifts"."store_id"';
  ownership_anchor text := 'PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);';
  predicate text := $predicate$
-- SHIFT_CLOSED_SYNC_PREDICATE_BEGIN
AND (NOT (upper(COALESCE(public."shifts"."status",''))='CLOSED'
       OR upper(COALESCE(public."shifts"."state",''))='CLOSED'
       OR public."shifts"."closed_at" IS NOT NULL)
     OR (EXCLUDED."status"='CLOSED' AND EXCLUDED."state"='CLOSED'
         AND EXCLUDED."closed_at" IS NOT NULL))
-- SHIFT_CLOSED_SYNC_PREDICATE_END
$predicate$;
  validation text := $validation$
-- SHIFT_CLOSED_SYNC_VALIDATION_BEGIN
-- Only a clean, otherwise identical opening can be acknowledged as obsolete.
-- Different notes/opening facts or submitted counts remain pending for review.
-- Receipt replay skips the upsert: validate nonfinal rows against a stable
-- parent without waiting behind a multi-parent writer in another lock order.
-- A busy parent is transient, never an acknowledgement. Pure CLOSED proof
-- requests retain their existing lock path.
IF EXISTS (
  SELECT 1 FROM jsonb_populate_recordset(NULL::public.shifts,COALESCE(p_rows,'[]'::jsonb)) candidate
  WHERE NOT (COALESCE(candidate.status,'')='CLOSED' AND COALESCE(candidate.state,'')='CLOSED'
             AND candidate.closed_at IS NOT NULL)
) THEN
  BEGIN
    PERFORM locked_row.id
    FROM public.shifts locked_row
    JOIN jsonb_populate_recordset(NULL::public.shifts,COALESCE(p_rows,'[]'::jsonb)) input_scope
      ON input_scope.id=locked_row.id
    WHERE locked_row.store_id=p_branch_id
    ORDER BY locked_row.id FOR SHARE OF locked_row NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='55P03', MESSAGE='SYNC_SHIFT_CLOSURE_BUSY';
  END;
END IF;
IF EXISTS (
  SELECT 1
  FROM jsonb_populate_recordset(NULL::public.shifts,COALESCE(p_rows,'[]'::jsonb)) opening_row
  JOIN public.shifts closed_row ON closed_row.id=opening_row.id
  WHERE closed_row.store_id=p_branch_id
    AND (upper(COALESCE(closed_row.status,''))='CLOSED'
         OR upper(COALESCE(closed_row.state,''))='CLOSED' OR closed_row.closed_at IS NOT NULL)
    AND NOT (COALESCE(opening_row.status,'')='CLOSED' AND COALESCE(opening_row.state,'')='CLOSED'
             AND opening_row.closed_at IS NOT NULL)
    AND NOT (
      COALESCE(opening_row.status,'OPEN')='OPEN' AND COALESCE(opening_row.state,'ACTIVE')='ACTIVE'
      AND opening_row.closed_at IS NULL
      AND opening_row.closed_by_name IS NULL AND opening_row.closed_by_staff_id IS NULL
      AND opening_row.closed_by_role IS NULL AND opening_row.counted_cash IS NULL
      AND opening_row.counted_card IS NULL AND opening_row.counted_digital IS NULL
      AND opening_row.closing_float IS NULL AND opening_row.final_counted_cash IS NULL
      AND opening_row.variance_cash IS NULL AND opening_row.variance_card IS NULL
      AND opening_row.variance_digital IS NULL AND opening_row.variance_total IS NULL
      AND opening_row.variance_status IS NULL AND opening_row.close_reason IS NULL
      AND opening_row.closing_started_at IS NULL AND opening_row.closing_started_by IS NULL
      AND (to_jsonb(opening_row) - ARRAY[
        'status','state','closed_at','closed_by_name','closed_by_staff_id','closed_by_role',
        'counted_cash','counted_card','counted_digital','expected_cash','expected_card','expected_digital',
        'closing_float','final_counted_cash','variance_cash','variance_card','variance_digital',
        'variance_total','variance_status','close_reason','closing_started_at','closing_started_by',
        'row_version','updated_at']::text[])
        = (to_jsonb(closed_row) - ARRAY[
        'status','state','closed_at','closed_by_name','closed_by_staff_id','closed_by_role',
        'counted_cash','counted_card','counted_digital','expected_cash','expected_card','expected_digital',
        'closing_float','final_counted_cash','variance_cash','variance_card','variance_digital',
        'variance_total','variance_status','close_reason','closing_started_at','closing_started_by',
        'row_version','updated_at']::text[])
    )
) THEN RAISE EXCEPTION 'SYNC_SHIFT_CLOSURE_CONFLICT'; END IF;
-- SHIFT_CLOSED_SYNC_VALIDATION_END
$validation$;
BEGIN
  IF signature IS NULL OR proof_signature IS NULL THEN RAISE EXCEPTION 'Shift sync routine is missing'; END IF;
  SELECT pg_get_functiondef(signature) INTO definition;
  SELECT pg_get_functiondef(proof_signature) INTO proof_definition;
  normalized := replace(definition,E'\r\n',E'\n');
  proof_normalized := replace(proof_definition,E'\r\n',E'\n');
  IF (SELECT bool_or(prosecdef) FROM pg_proc WHERE oid IN (signature,proof_signature)) OR
     position('pos_sync_assert_shift_ownership' in definition)=0 OR
     position('pos_sync_shift_closure_ack' in definition)=0 OR
     position('requested_row_version' in proof_definition)=0 OR
     position('Only a clean, otherwise identical opening' in definition)>0 THEN
    RAISE EXCEPTION 'Unexpected shift sync authority contract';
  END IF;
  predicate := btrim(split_part(split_part(predicate,'-- SHIFT_CLOSED_SYNC_PREDICATE_BEGIN',2),
    '-- SHIFT_CLOSED_SYNC_PREDICATE_END',1),E' \r\n');
  validation := btrim(split_part(split_part(validation,'-- SHIFT_CLOSED_SYNC_VALIDATION_BEGIN',2),
    '-- SHIFT_CLOSED_SYNC_VALIDATION_END',1),E' \r\n');
  IF (length(definition)-length(replace(definition,version_anchor,'')))/length(version_anchor)<>1 OR
     (length(proof_definition)-length(replace(proof_definition,ownership_anchor,'')))/length(ownership_anchor)<>1 OR
     (length(proof_definition)-length(replace(proof_definition,'FOR incoming IN','')))/length('FOR incoming IN')<>1 THEN
    RAISE EXCEPTION 'Unexpected shift sync update anchors';
  END IF;
  updated := definition;
  proof_updated := proof_definition;
  IF position(predicate in normalized)>0 THEN
    IF (length(normalized)-length(replace(normalized,predicate,'')))/length(predicate)<>1 OR
       position(version_anchor||' '||predicate in normalized)=0 THEN
      RAISE EXCEPTION 'Unexpected partial shift lifecycle guard';
    END IF;
  ELSE
    IF position('public."shifts"."closed_at" IS NOT NULL' in normalized)>0 THEN
      RAISE EXCEPTION 'Unexpected partial shift lifecycle guard';
    END IF;
    updated := replace(definition,version_anchor,version_anchor||' '||predicate);
  END IF;
  IF position(validation in proof_normalized)>0 THEN
    IF (length(proof_normalized)-length(replace(proof_normalized,validation,'')))/length(validation)<>1 OR
       position(validation in proof_normalized)<position(ownership_anchor in proof_normalized) OR
       position(validation in proof_normalized)>position('FOR incoming IN' in proof_normalized) THEN
      RAISE EXCEPTION 'Unexpected partial shift lifecycle guard';
    END IF;
  ELSE
    IF position('Only a clean, otherwise identical opening' in proof_normalized)>0 THEN
      RAISE EXCEPTION 'Unexpected partial shift lifecycle guard';
    END IF;
    proof_updated := replace(proof_definition,ownership_anchor,ownership_anchor||E'\n\n'||validation);
  END IF;
  IF updated<>definition THEN EXECUTE updated; END IF;
  IF proof_updated<>proof_definition THEN EXECUTE proof_updated; END IF;
END $migration$;
COMMIT;
