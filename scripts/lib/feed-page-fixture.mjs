// Disposable fixture only. Never reads cloud credentials or operator profiles.
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
export async function installFeedFixture(db){
 const schema=await read('supabase/schema.sql');
 const start=schema.lastIndexOf('CREATE OR REPLACE FUNCTION public.pos_sync_history_project_v1(');
 const delimiter=schema.slice(start).match(/AS (\$[a-z_]+\$)/i)?.[1];
 const bodyStart=schema.indexOf(delimiter,start)+delimiter.length;
 const end=schema.indexOf(delimiter,bodyStart)+delimiter.length+1;
 if(start<0||end<start)throw Error('Canonical projection missing');
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.fixture_feed(cursor bigint PRIMARY KEY,branch text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,row_data jsonb);
 CREATE FUNCTION public.pos_sync_pull(p_organization_id text,p_branch_id text,p_terminal_id text,p_after_cursor bigint DEFAULT 0,p_limit integer DEFAULT 500)
 RETURNS TABLE(cursor bigint,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,row_data jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
 BEGIN
 IF p_organization_id<>'default' OR p_branch_id<>'A' OR p_terminal_id<>'terminal' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
 RETURN QUERY SELECT f.cursor,f.table_name,f.entity_id,f.operation,f.row_version,f.tombstone,f.row_data FROM fixture_feed f
 WHERE f.branch=p_branch_id AND f.cursor>p_after_cursor ORDER BY f.cursor LIMIT LEAST(GREATEST(p_limit,10),2000);
 END $body$;
 REVOKE ALL ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) TO service_role;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(schema.slice(start,end));
 const pins=(await db.query(`SELECT md5(pg_get_functiondef('public.pos_sync_pull(text,text,text,bigint,integer)'::regprocedure)) pull,md5(pg_get_functiondef('public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure)) projection`)).rows[0];
 const production=await read('supabase/migrations/20261104040251_protected_byte_bounded_feed_download.sql');
 // Only the intentionally synthetic delegate differs. Production pin literals
 // are separately checked by the contract test; never substitute live bytes.
 const candidate=production.replace('e3171846683edb5d58c7a5291526555a',pins.pull).replace('4633e04e150c350518938f2ba661fca1',pins.projection);
 await db.exec(candidate);
 return {production,candidate,pins};
}
