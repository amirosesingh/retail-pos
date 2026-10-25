// Emit a rollback-only regression transaction. All writes target temporary
// clones; no operator tables, configuration or session state are changed.
const fs = require("node:fs");
const path = require("node:path");
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261024051916_enforce_store_sync_ownership.sql"), "utf8");
const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?END \$fn\$;/g)]
  .map(match => match[0].replaceAll("public.", "pg_temp.")).join("\n\n");
if (functions.match(/CREATE OR REPLACE FUNCTION/g)?.length !== 4) throw new Error("Missing tested function definition");
process.stdout.write(`BEGIN;
CREATE TEMP TABLE stores AS SELECT * FROM public.stores WITH NO DATA;
ALTER TABLE pg_temp.stores ADD PRIMARY KEY(id);
CREATE TEMP TABLE app_users AS SELECT * FROM public.app_users WITH NO DATA;
CREATE TEMP TABLE sync_idempotency_receipts AS SELECT * FROM public.sync_idempotency_receipts WITH NO DATA;
CREATE FUNCTION pg_temp.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF $1 <> 'default' OR $2 <> 'A' OR $3 <> 'T' THEN RAISE EXCEPTION 'INVALID_TEST_TERMINAL'; END IF; END $$;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
${functions}
INSERT INTO pg_temp.stores(id,code,name,row_version) VALUES ('A','A','Original A',0),('B','B','Original B',0);
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.pos_sync_push_batch(gen_random_uuid(),'default','A','T','stores','[{"id":"B","name":"Forged","row_version":1}]','[]');
    RAISE EXCEPTION 'FOREIGN_BATCH_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'SYNC_BRANCH_FORBIDDEN' THEN RAISE; END IF; END;
  BEGIN
    PERFORM pg_temp.pos_sync_push_aggregate(gen_random_uuid(),'default','A','T','[{"table":"stores","rows":[{"id":"B","name":"Forged","row_version":1}],"changes":[]}]');
    RAISE EXCEPTION 'FOREIGN_AGGREGATE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'SYNC_BRANCH_FORBIDDEN' THEN RAISE; END IF; END;
  PERFORM pg_temp.pos_sync_push_batch(gen_random_uuid(),'default','A','T','stores','[{"id":"A","code":"A","name":"Allowed A","row_version":1}]','[]');
  IF (SELECT name FROM pg_temp.stores WHERE id='A') <> 'Allowed A' THEN RAISE EXCEPTION 'OWN_STORE_UPDATE_BROKEN'; END IF;
  PERFORM pg_temp.pos_sync_push_aggregate(gen_random_uuid(),'default','A','T','[{"table":"stores","rows":[{"id":"A","code":"A","name":"Allowed aggregate","row_version":2}],"changes":[]}]');
  IF (SELECT name FROM pg_temp.stores WHERE id='A') <> 'Allowed aggregate' THEN RAISE EXCEPTION 'OWN_STORE_AGGREGATE_BROKEN'; END IF;
  PERFORM pg_temp.pos_sync_push_batch(gen_random_uuid(),'default','A','T','stores','[]','[{"operation":"DELETE","key":{"id":"B"}}]');
  PERFORM pg_temp.pos_sync_push_aggregate(gen_random_uuid(),'default','A','T','[{"table":"stores","rows":[],"changes":[{"operation":"D","entityId":"{\\"id\\":\\"B\\"}"}]}]');
  IF (SELECT name FROM pg_temp.stores WHERE id='B') IS DISTINCT FROM 'Original B' THEN RAISE EXCEPTION 'FOREIGN_STORE_CHANGED'; END IF;
  BEGIN
    PERFORM pg_temp.sync_apply_stores('[{"id":"B","row_version":10}]');
    RAISE EXCEPTION 'DIRECT_HELPER_BYPASS';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'SYNC_BRANCH_FORBIDDEN' THEN RAISE; END IF; END;
  PERFORM pg_temp.sync_delete_stores('[{"operation":"DELETE","key":{"id":"A"}}]','A','T');
  IF EXISTS(SELECT 1 FROM pg_temp.stores WHERE id='A') THEN RAISE EXCEPTION 'OWN_STORE_DELETE_BROKEN'; END IF;
END $$;
ROLLBACK;
SELECT 'Store sync scope regression: passed (temporary tables rolled back)' AS result;
`);
