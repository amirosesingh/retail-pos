import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("pages every zero-sale shift beyond the old cap while preserving masks and branch/session gates", async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
      CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.staff',true)='yes'$$;
      CREATE FUNCTION public.is_terminal_active() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.active',true)='yes'$$;
      CREATE FUNCTION public.store_visible(p_store text) RETURNS boolean LANGUAGE sql AS $$SELECT p_store=current_setting('test.branch',true)$$;
      CREATE FUNCTION public.has_perm(p_perm text) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.financial',true)='yes'$$;
      CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,opened_at timestamptz,status text,
        opening_float numeric,expected_cash numeric,expected_card numeric,expected_digital numeric,
        counted_cash numeric,counted_card numeric,counted_digital numeric,closing_float numeric,final_counted_cash numeric,
        variance_cash numeric,variance_card numeric,variance_digital numeric,variance_total numeric,variance_status text);
      INSERT INTO public.shifts(id,store_id,opened_at,status,opening_float,expected_cash,variance_total)
        SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'A','2026-10-20T12:00:00Z','CLOSED',30,200,5 FROM generate_series(1,1005) n;
      INSERT INTO public.shifts(id,store_id,opened_at,status) VALUES
        ('10000000-0000-4000-8000-000000000001','B','2026-10-20T12:00:00Z','CLOSED'),
        ('10000000-0000-4000-8000-000000000002','A','2026-09-01T12:00:00Z','CLOSED');
      GRANT USAGE ON SCHEMA public,private TO authenticated;SET test.staff='yes';SET test.active='yes';SET test.branch='A';`);
    const sql=readFileSync("supabase/migrations/20261026232513_paged_secure_shift_history.sql","utf8");
    await db.exec(sql);await db.exec(sql);
    await db.exec("SET ROLE authenticated");
    const ids=new Set<string>();
    let beforeTime:string|null=null,beforeId:string|null=null;
    for(let page=0;page<3;page++) {
      const rows:Record<string,unknown>[]=(await db.query<{row:Record<string,unknown>}>(`SELECT row FROM public.shift_page_secure('A','2026-10-01','2026-10-31',$1::timestamptz,$2::uuid,500) row`,[beforeTime,beforeId])).rows.map(value=>value.row);
      expect(rows).toHaveLength(page<2?500:5);
      expect(rows.every(row=>row.opening_float===null&&row.expected_cash===null&&row.variance_total===null)).toBe(true);
      for(const row of rows) ids.add(String(row.id));
      beforeTime=String(rows.at(-1)!.opened_at);beforeId=String(rows.at(-1)!.id);
    }
    expect(ids.size).toBe(1005);
    expect((await db.query(`SELECT * FROM public.shift_page_secure('B')`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT * FROM public.shift_page_secure('')`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT * FROM public.shift_page_secure('A',null,null,null,'00000000-0000-4000-8000-000000000001')`)).rows).toHaveLength(0);
    await db.exec("SET test.financial='yes'");
    const visible=(await db.query<{row:Record<string,unknown>}>(`SELECT row FROM public.shift_page_secure('A',null,null,null,null,1) row`)).rows[0].row;
    expect(Number(visible.opening_float)).toBe(30);expect(Number(visible.expected_cash)).toBe(200);
    await db.exec("SET test.active='no'");
    expect((await db.query(`SELECT * FROM public.shift_page_secure('A')`)).rows).toHaveLength(0);
    await db.exec("SET test.active='yes';SET test.staff='no'");
    expect((await db.query(`SELECT * FROM public.shift_page_secure('A')`)).rows).toHaveLength(0);
    await db.exec("RESET ROLE;SET ROLE anon");
    await expect(db.query(`SELECT * FROM public.shift_page_secure('A')`)).rejects.toThrow(/permission denied/);
  } finally {await db.close();}
});
