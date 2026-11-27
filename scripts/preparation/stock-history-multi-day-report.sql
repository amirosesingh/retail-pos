-- Schema-only extension of the reviewed Stock Report readers.
-- Install after the existing period reader (and recorded continuation when used).
-- This adds no history rows and does not change data, authority or writer coverage.
BEGIN;

CREATE OR REPLACE FUNCTION private.stock_history_calendar_period(p_start numeric,p_cutoff numeric,p_zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE first_date date; final_date date; first_day jsonb; final_day jsonb;
BEGIN
 IF p_start IS NULL OR p_cutoff IS NULL OR p_cutoff<p_start OR p_zone IS NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_RANGE_INVALID'; END IF;
 first_date:=(to_timestamp(floor(p_start/10000000)) AT TIME ZONE p_zone)::date;
 final_date:=(to_timestamp(floor(p_cutoff/10000000)) AT TIME ZONE p_zone)::date;
 -- Same inclusive 31-calendar-day limit as the local reader. Use date
 -- arithmetic so daylight-saving changes cannot shorten or extend the limit.
 IF final_date-first_date NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'STOCK_HISTORY_RANGE_INVALID'; END IF;
 first_day:=private.stock_history_calendar_day(to_char(first_date,'YYYY-MM-DD'),p_zone);
 final_day:=CASE WHEN first_date=final_date THEN first_day
  ELSE private.stock_history_calendar_day(to_char(final_date,'YYYY-MM-DD'),p_zone) END;
 IF private.stock_history_ticks(first_day->>'start')<>p_start OR
    p_cutoff<private.stock_history_ticks(final_day->>'start') OR p_cutoff>=private.stock_history_ticks(final_day->>'endExclusive')
  THEN RAISE EXCEPTION 'STOCK_HISTORY_RANGE_INVALID'; END IF;
 RETURN jsonb_build_object('start',first_day->>'start','endExclusive',final_day->>'endExclusive');
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_calendar_period(numeric,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

-- Both readers already use the period's exact lower bound and inclusive
-- cutoff in aggregation and source revisions. Change their range admission
-- only. Preserve the installed function identities, body variants and grants.
DO $calendar_period$
DECLARE
 required_reader regprocedure:=to_regprocedure('private.stock_history_read_page_core(text,text,text,text,text,uuid,integer,text,boolean,uuid,text,uuid,text,uuid)');
 recorded_reader regprocedure:=to_regprocedure('public.pos_stock_history_recorded_page(text,text,text,text,text,uuid,integer,text,text)');
 reader regprocedure; body text; definition text; expected text;
 previous text:=replace($previous$period_range:=private.stock_history_calendar_day(to_char(to_timestamp(floor(period_start/10000000)) AT TIME ZONE p_zone,'YYYY-MM-DD'),p_zone);
  IF private.stock_history_ticks(period_range->>'start')<>period_start OR cutoff<period_start
   OR cutoff>=private.stock_history_ticks(period_range->>'endExclusive') THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;$previous$,E'\r\n',E'\n');
 replacement text:='period_range:=private.stock_history_calendar_period(period_start,cutoff,p_zone);';
BEGIN
 IF required_reader IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_MULTI_DAY_DEPENDENCY_MISSING'; END IF;
 FOREACH reader IN ARRAY ARRAY[required_reader,recorded_reader] LOOP
  IF reader IS NULL THEN CONTINUE; END IF;
  SELECT prosrc,pg_get_functiondef(oid) INTO STRICT body,definition FROM pg_proc WHERE oid=reader;
  expected:=CASE WHEN strpos(body,previous)>0 THEN previous ELSE replace(previous,E'\n',E'\r\n') END;
  IF length(body)-length(replace(body,replacement,''))=length(replacement)
   AND strpos(body,expected)=0 THEN CONTINUE; END IF;
  IF length(body)-length(replace(body,expected,''))<>length(expected) OR strpos(body,replacement)<>0
   THEN RAISE EXCEPTION 'STOCK_HISTORY_MULTI_DAY_READER_CHANGED: %',reader; END IF;
  EXECUTE replace(definition,body,replace(body,expected,replacement));
 END LOOP;
END $calendar_period$;

COMMIT;
