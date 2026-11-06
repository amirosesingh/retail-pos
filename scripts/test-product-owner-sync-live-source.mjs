// Isolated PostgreSQL only. Captured public owner routine and real scope/row
// admission statements; no connector, credential, POS profile or live DB.
// This composes the actual product-specific boundaries, not a complete financial
// aggregate/installed-terminal acceptance test.
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const captured={"definition":"CREATE OR REPLACE FUNCTION public.sync_apply_products(p_rows jsonb)\n RETURNS integer\n LANGUAGE plpgsql\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nDECLARE v_count integer; v_row jsonb;\r\nBEGIN\r\n\r\n\r\n  INSERT INTO public.\"products\" (\"id\",\"barcode\",\"name\",\"category\",\"cost_price\",\"selling_price\",\"ecom_price\",\"stock_quantity\",\"custom_points\",\"point_multiplier\",\"created_at\",\"sku\",\"reorder_level\",\"tax_rate\",\"ecom_visible\",\"stock_by_store\",\"updated_at\",\"landing_pct\",\"sub_category\",\"unit\",\"packs\",\"barcode_aliases\",\"is_archived\",\"archived_at\",\"brand\",\"product_group\",\"barcode_variants\",\"row_version\",\"owner_store_id\",\"deleted_at\")\r\n  SELECT \"id\",\"barcode\",\"name\",\"category\",\"cost_price\",\"selling_price\",NULL::numeric,\"stock_quantity\",\"custom_points\",\"point_multiplier\",\"created_at\",\"sku\",\"reorder_level\",\"tax_rate\",false,\"stock_by_store\",\"updated_at\",\"landing_pct\",\"sub_category\",\"unit\",\"packs\",\"barcode_aliases\",\"is_archived\",\"archived_at\",\"brand\",\"product_group\",\"barcode_variants\",\"row_version\",\"owner_store_id\",\"deleted_at\" FROM jsonb_populate_recordset(NULL::public.\"products\", COALESCE(p_rows,'[]'::jsonb))\r\n  ON CONFLICT (\"id\") DO UPDATE SET \"barcode\"=EXCLUDED.\"barcode\",\"name\"=EXCLUDED.\"name\",\"category\"=EXCLUDED.\"category\",\"cost_price\"=EXCLUDED.\"cost_price\",\"selling_price\"=EXCLUDED.\"selling_price\",\"custom_points\"=EXCLUDED.\"custom_points\",\"point_multiplier\"=EXCLUDED.\"point_multiplier\",\"created_at\"=EXCLUDED.\"created_at\",\"sku\"=EXCLUDED.\"sku\",\"reorder_level\"=EXCLUDED.\"reorder_level\",\"tax_rate\"=EXCLUDED.\"tax_rate\",\"updated_at\"=EXCLUDED.\"updated_at\",\"landing_pct\"=EXCLUDED.\"landing_pct\",\"sub_category\"=EXCLUDED.\"sub_category\",\"unit\"=EXCLUDED.\"unit\",\"packs\"=EXCLUDED.\"packs\",\"barcode_aliases\"=EXCLUDED.\"barcode_aliases\",\"is_archived\"=EXCLUDED.\"is_archived\",\"archived_at\"=EXCLUDED.\"archived_at\",\"brand\"=EXCLUDED.\"brand\",\"product_group\"=EXCLUDED.\"product_group\",\"barcode_variants\"=EXCLUDED.\"barcode_variants\",\"row_version\"=EXCLUDED.\"row_version\",\"owner_store_id\"=EXCLUDED.\"owner_store_id\",\"deleted_at\"=EXCLUDED.\"deleted_at\" WHERE EXCLUDED.\"row_version\">public.\"products\".\"row_version\";\r\n  GET DIAGNOSTICS v_count=ROW_COUNT;\r\n\r\n\r\n\r\n  RETURN v_count;\r\nEND $function$\n","metadata":{"acl":["postgres=X/postgres","service_role=X/postgres"],"cost":100,"kind":"f","rows":0,"owner":"postgres","config":["search_path=public, pg_temp"],"result":"integer","strict":false,"definer":false,"language":"plpgsql","parallel":"u","arguments":"p_rows jsonb","leakproof":false,"signature":"public.sync_apply_products(jsonb)","volatility":"v","returns_set":false,"support_absent":true},"scopeDefinition":"CREATE OR REPLACE FUNCTION public.pos_sync_validate_scope(p_organization_id text, p_branch_id text, p_terminal_id text)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nBEGIN\r\n IF p_organization_id IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'SYNC_ORGANIZATION_FORBIDDEN'; END IF;\r\n IF NULLIF(btrim(p_branch_id),'') IS NULL OR NULLIF(btrim(p_terminal_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_REQUIRED'; END IF;\r\n IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id AND t.status IN ('active','used') AND t.revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;\r\nEND $function$\n","productGuard":"IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF; ","aggregate_body_md5":"a3212a2df3c18b7031cd88963f3277ca"};
const migrationPath='supabase/migrations/20261106015347_guard_existing_product_owner_during_native_sync.sql';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const migration=await read(migrationPath),columns=JSON.parse(await read('src/lib/__tests__/fixtures/ownership22-live-metadata.json')).columns.filter(c=>c.table_name==='products');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',T='20000000-0000-4000-8000-000000000001',P='30000000-0000-4000-8000-000000000001',Q='30000000-0000-4000-8000-000000000002';
const md5=s=>createHash('md5').update(s).digest('hex');
if(process.argv.slice(2).some(arg=>arg!=='--native'))throw Error('Only optional --native isolated mode is accepted');
const native=process.argv.includes('--native');
const nativeFactory=native?await import('data:text/javascript;base64,'+Buffer.from((await read('scripts/test-seven-shift-summary-native.fixture.mjs'))+'\nexport {createNativeFixture};').toString('base64')):null;
async function createDatabase(){
 if(!native)return new PGlite();
 const connection=await nativeFactory.createNativeFixture(),exec=connection.exec,close=connection.close;
 connection.exec=async text=>{if(/^\s*--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*$/.test(text)){await exec(text.replace(/COMMIT;\s*$/,''));return exec('COMMIT;');}return exec(text);};
 let closed=false;
 connection.close=async()=>{
  if(closed)return;
  try{await close();closed=true;}
  catch(error){
   // The existing helper stops its owned PostgreSQL instance before removing
   // files. Windows can briefly retain the fixture log handle after that stop.
   // Retry deletion only inside that known uniquely generated fixture root.
   if(!['EBUSY','EPERM','ENOTEMPTY'].includes(error.code)||typeof error.path!=='string')throw error;
   const base=resolve('.tmp/seven-shift-summary-tests'),target=resolve(error.path),relative=target.slice(base.length+1),part=relative.split(sep)[0];
   if(!target.startsWith(base+sep)||!/^owned-[A-Za-z0-9]+$/.test(part))throw error;
   const owned=resolve(base,part);if(!owned.startsWith(base+sep))throw error;
   await rm(owned,{recursive:true,force:true,maxRetries:20,retryDelay:100});closed=true;
   console.log('Cleaned stopped owned fixture after bounded Windows handle retry');
  }
 };
 return connection;
}
let passed=0,db;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);passed++;};
async function definition(text){
 const m=text.match(/AS (\$\w*\$)([\s\S]*?)\1/);assert(m);
 const body="E'"+m[2].replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'";
 await db.exec(text.replace(m[0],()=> 'AS '+body));
}
async function metadataNow(){
 return (await db.query(`SELECT jsonb_build_object('signature','public.sync_apply_products(jsonb)','owner',pg_get_userbyid(p.proowner),
 'acl',(SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(p.proacl)x),'config',to_jsonb(p.proconfig),'strict',p.proisstrict,'definer',p.prosecdef,
 'volatility',p.provolatile,'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,'returns_set',p.proretset,
 'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'cost',p.procost,'rows',p.prorows,'support_absent',p.prosupport=0) v FROM pg_proc p WHERE p.oid='public.sync_apply_products(jsonb)'::regprocedure`)).rows[0].v;
}
const bodyNow=async()=>(await db.query("SELECT prosrc FROM pg_proc WHERE oid='public.sync_apply_products(jsonb)'::regprocedure")).rows[0].prosrc;
const row=async id=>(await db.query('SELECT to_jsonb(p) v FROM public.products p WHERE id=$1',[id])).rows[0]?.v;
const snapshot=async()=>({body:await bodyNow(),metadata:await metadataNow(),rows:(await db.query('SELECT to_jsonb(p) v FROM public.products p ORDER BY id')).rows.map(x=>x.v)});
async function setup(){
 if(db)await db.close();db=await createDatabase();
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;");
 await db.exec('CREATE TABLE public.products('+columns.map(c=>'"'+c.column_name+'" '+(c.udt_name.startsWith('_')?c.udt_name.slice(1)+'[]':c.udt_name)+(c.column_default?' DEFAULT '+c.column_default:'')+(c.is_nullable==='NO'?' NOT NULL':'')).join(',')+');ALTER TABLE products ADD PRIMARY KEY(id);');
 await definition(captured.definition);
 await db.exec('REVOKE ALL ON FUNCTION public.sync_apply_products(jsonb) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.sync_apply_products(jsonb) TO service_role;GRANT SELECT,INSERT,UPDATE ON products TO service_role;');
 await db.exec(`CREATE TABLE public.terminal_tokens(id uuid,location_id text,status text,revoked_at timestamptz);INSERT INTO terminal_tokens VALUES('${T}','${A}','active',NULL);`);
 await definition(captured.scopeDefinition);
 // Exact captured scope validator and product-row branch predicate; unrelated
 // aggregate/shift/financial handlers are neither stubbed nor exercised here.
 await db.exec(`CREATE FUNCTION public.fixture_bound_product_write(p_org text,p_branch_id text,p_terminal_id text,v_rows jsonb)
 RETURNS integer LANGUAGE plpgsql AS $bound$BEGIN
 PERFORM public.pos_sync_validate_scope(p_org,p_branch_id,p_terminal_id);
 ${captured.productGuard}
 RETURN public.sync_apply_products(v_rows);END $bound$;`);
 const required=Object.fromEntries(columns.filter(c=>c.is_nullable==='NO'&&!c.column_default).map(c=>[c.column_name,c.udt_name==='uuid'?P:/^(int|numeric|float)/.test(c.udt_name)?0:c.udt_name==='bool'?true:'synthetic']));
 const first={...required,id:P,name:'Synthetic original',barcode:'SYNTHETIC-1',sku:'SYNTHETIC-SKU-1',owner_store_id:A,row_version:10,selling_price:19.95,cost_price:7.25,ecom_price:25,ecom_visible:true,stock_quantity:0,stock_by_store:{[A]:0},is_archived:true,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
 const second={...first,id:Q,barcode:'SYNTHETIC-2',sku:'SYNTHETIC-SKU-2',owner_store_id:null};
 const insertColumns=Object.keys(first).map(name=>'"'+name+'"').join(',');
 await db.query('INSERT INTO products('+insertColumns+') SELECT '+insertColumns+' FROM jsonb_populate_recordset(NULL::products,$1::jsonb)',[JSON.stringify([first,second])]);
 check(md5(await bodyNow()),'a2f6dc6db0f0b8c045faf7d5f0f309b0','fixture uses exact captured live body bytes');
 check(await metadataNow(),captured.metadata,'fixture has exact captured ACL/owner/config/flags');
}
const direct=async input=>(await db.query('SELECT public.sync_apply_products($1::jsonb) n',[JSON.stringify(input)])).rows[0].n;
const bound=async(input,{org='default',branch=A,terminal=T}={})=>(await db.query('SELECT public.fixture_bound_product_write($1,$2,$3,$4::jsonb) n',[org,branch,terminal,JSON.stringify(input)])).rows[0].n;
async function denied(work,pattern){const before=await snapshot();await assert.rejects(work,pattern);await db.exec('ROLLBACK');check(await snapshot(),before,'denied operation is atomic and preserves rows/routine/permissions');}
try{
 await setup();
 const original=await row(P);await bound([{...original,owner_store_id:null,row_version:11}]);check((await row(P)).owner_store_id,null,'reproduces actual newer NULL legacy owner removal before the fix');
 await setup();const before=await snapshot();const oid=(await db.query("SELECT 'public.sync_apply_products(jsonb)'::regprocedure::oid oid")).rows[0].oid;
 await db.exec(migration);
 check((await snapshot()).rows,before.rows,'migration rewrites no business rows');check(await metadataNow(),before.metadata,'all routine permissions and flags unchanged');
 check((await db.query("SELECT 'public.sync_apply_products(jsonb)'::regprocedure::oid oid")).rows[0].oid,oid,'function object identity is preserved');
 check(md5(await bodyNow()),'a076aea59e1cc926542052040f20465e','only reviewed assignment bytes changed');
 const oldAssignment='"owner_store_id"=EXCLUDED."owner_store_id"',protectedAssignment='"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),\'\'),public."products"."owner_store_id")';
 check((await bodyNow()).replace(protectedAssignment,oldAssignment),before.body,'all other live function source bytes remain exact');
 const initial=await row(P),newer={...initial,owner_store_id:null,row_version:11,selling_price:29.95,stock_quantity:987,stock_by_store:{[B]:987},ecom_price:999,ecom_visible:false};
 check(await bound([newer]),1,'bound legitimate newer NULL upload remains accepted');check((await row(P)).owner_store_id,A,'newer NULL keeps repaired owner');
 check((await row(P)).selling_price,29.95,'legitimate price update remains accepted');
 for(const field of ['stock_quantity','stock_by_store','ecom_price','ecom_visible','is_archived','sku','barcode'])check((await row(P))[field],initial[field],field+' is preserved with existing sync semantics');
 check(await direct([{...await row(P),owner_store_id:'   ',row_version:12}]),1,'internal legacy blank assignment preserves existing semantics');check((await row(P)).owner_store_id,A,'space-only owner cannot erase known owner');
 check(await direct([{...await row(P),owner_store_id:'',row_version:13}]),1,'empty owner still accepts legitimate newer row');check((await row(P)).owner_store_id,A,'empty owner remains preserved');
 const unchanged=await row(P);check(await direct([{...unchanged,owner_store_id:B,row_version:13,selling_price:999}]),0,'same version is rejected');check(await direct([{...unchanged,owner_store_id:B,row_version:12,selling_price:999}]),0,'stale version is rejected');check(await row(P),unchanged,'rejected rows do not change owner/amount/stock');
 await denied(()=>bound([{...unchanged,owner_store_id:B,row_version:14}]),/SYNC_PRODUCT_SCOPE_FORBIDDEN/);
 await denied(()=>bound([{...unchanged,owner_store_id:null,row_version:14}],{branch:B}),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);
 await denied(()=>bound([{...unchanged,owner_store_id:null,row_version:14}],{org:'foreign'}),/SYNC_ORGANIZATION_FORBIDDEN/);
 await denied(()=>bound([{...unchanged,owner_store_id:null,row_version:14}],{terminal:''}),/SYNC_TERMINAL_REQUIRED/);
 await denied(()=>bound([{...unchanged,owner_store_id:'   ',row_version:14}]),/SYNC_PRODUCT_SCOPE_FORBIDDEN/);
 check(await bound([{...await row(P),owner_store_id:A,row_version:14}]),1,'explicit same-branch owner remains accepted');
 check(await direct([{...await row(P),owner_store_id:B,row_version:15}]),1,'explicit nonblank internal reassignment is unchanged');check((await row(P)).owner_store_id,B,'the patch does not silently rewrite explicit ownership');
 check(await bound([{...await row(Q),owner_store_id:A,row_version:11}]),1,'explicit initial ownership remains accepted');
 const R='30000000-0000-4000-8000-000000000003';check(await bound([{...initial,id:R,sku:'SYNTHETIC-NEW',barcode:'SYNTHETIC-NEW',owner_store_id:A,row_version:1}]),1,'new product insertion remains accepted');check((await row(R)).owner_store_id,A,'new insertion retains supplied owner');
 const saved=await snapshot();await db.exec(migration);check(await snapshot(),saved,'exact migration replay changes nothing');
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(direct([{...initial,row_version:999}]),/permission denied/);await db.exec('RESET ROLE');passed++;}
 await db.exec('SET ROLE service_role');check(await direct([{...await row(Q),owner_store_id:null,row_version:12}]),1,'existing service-only function grant still works');await db.exec('RESET ROLE');
 await db.exec("UPDATE terminal_tokens SET revoked_at=now() WHERE id='"+T+"'");await denied(()=>bound([{...initial,row_version:20}]),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);
 for(const [label,mutate,pattern]of [
 ['source bytes',async()=>definition(captured.definition.replace('DECLARE v_count integer;','DECLARE v_count integer; -- changed')),/SOURCE_CHANGED/],
 ['config',()=>db.exec("ALTER FUNCTION public.sync_apply_products(jsonb) SET statement_timeout='1s'"),/METADATA_CHANGED/],
 ['ACL',()=>db.exec("GRANT EXECUTE ON FUNCTION public.sync_apply_products(jsonb) TO anon"),/METADATA_CHANGED/],
 ['security',()=>db.exec("ALTER FUNCTION public.sync_apply_products(jsonb) SECURITY DEFINER"),/METADATA_CHANGED/],
 ['cost',()=>db.exec("ALTER FUNCTION public.sync_apply_products(jsonb) COST 101"),/METADATA_CHANGED/],
 ]){await setup();await mutate();await denied(()=>db.exec(migration),pattern);console.log('PASS unknown '+label+' rejected');}
 await setup();await denied(()=>db.exec(migration.replace('OR actual IS DISTINCT FROM expected_metadata OR md5(body)<>after_hash','OR true OR actual IS DISTINCT FROM expected_metadata OR md5(body)<>after_hash')),/UNEXPECTED_CHANGE/);
 console.log('PASS '+passed+' captured-live product owner guard cases; actual scope/row boundaries preserved. No live database accessed.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db?.close();}

