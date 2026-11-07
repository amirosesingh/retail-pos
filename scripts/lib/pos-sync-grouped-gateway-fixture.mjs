import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function verifyGroupedGateway({ sql, denySql }) {
  const read = async path => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const schema = await read("../../supabase/schema.sql");
  const table = schema.match(/CREATE TABLE IF NOT EXISTS public\.pos_store_settings \([\s\S]*?\n\);/)?.[0];
  const amendments = schema.match(/ALTER TABLE public\.pos_store_settings\s+ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? [];
  const scope = schema.match(/CREATE OR REPLACE FUNCTION public\.pos_sync_validate_scope\([\s\S]*?END \$fn\$;/)?.[0];
  assert(table && scope, "The current canonical settings table and scope routine are required");
  const settings = await read("../preparation/pos-sync-store-settings-v1.sql");
  const gateway = await read("../preparation/pos-sync-grouped-gateway-v1.sql");
  const branch = "fixture-settings-a";
  const other = "fixture-settings-b";
  const terminal = randomUUID();
  const mobile = randomUUID();
  const epoch = randomUUID();
  const proof = "a".repeat(64);
  const service = `SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';`;
  const pullCall = (scopeId = branch, terminalId = terminal, binding = proof, after = "0") =>
    `SELECT public.pos_sync_pull_grouped_v1('default','${scopeId}','${terminalId}','${binding}','${epoch}','${after}',NULL,10);`;
  const snapshotCall = (scopeId = branch) => `SELECT public.pos_sync_snapshot_grouped_v1('default','${scopeId}','${terminal}','${proof}');`;

  sql(`SET client_min_messages = warning;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
    $$;
    CREATE TABLE public.stores (id text PRIMARY KEY);
    CREATE TABLE public.terminal_tokens (
      id uuid PRIMARY KEY, location_id text, platform text, status text, revoked_at timestamptz, is_claimed boolean,
      claimed_at timestamptz, claimed_platform text, claim_proof text, claimed_proof_hash text
    );
    ${scope}
    ${table}\n${amendments.join("\n")}
    INSERT INTO public.stores VALUES ('${branch}'),('${other}');
    INSERT INTO public.terminal_tokens (id,location_id,platform,status,is_claimed,claimed_platform,claim_proof)
      VALUES ('${terminal}','${branch}','pc','used',true,'electron','${proof}'),
             ('${mobile}','${branch}','mobile','used',true,'android','${proof}');
    INSERT INTO public.pos_store_settings (store_id,max_drawer_cash_limit) VALUES ('${branch}',3.01),('${other}',4);
    BEGIN; ${settings}\n${gateway} COMMIT;
    INSERT INTO pos_sync_feed_v1.feed_heads (organization_id,scope_id,epoch)
      VALUES ('default','${branch}','${epoch}'),('default','${other}','${epoch}');
    INSERT INTO pos_sync_feed_v1.settings_pilots VALUES ('default','${branch}','${epoch}'),('default','${other}','${epoch}');`);

  for (const role of ["anon", "authenticated"])
    denySql(`SET ROLE ${role}; ${pullCall()}`, /permission denied/);
  denySql(`SET ROLE service_role; ${pullCall()}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(other)}`, /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(branch, terminal, "b".repeat(64))}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(branch, mobile)}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}SELECT pos_sync_feed_v1.pull_groups('default','${branch}','${epoch}','0');`, /permission denied/);

  const snapshot = JSON.parse(sql(service + snapshotCall()));
  assert.equal(snapshot.status, "OK");
  assert.equal(snapshot.scope_id, branch);
  assert.equal(snapshot.seq, "0");
  assert.equal(snapshot.manifest_sha256, createHash("sha256").update(snapshot.manifest_json).digest("hex"));
  assert.equal(JSON.parse(snapshot.manifest_json).changes[0].row_data.max_drawer_cash_limit, "3.01");
  assert.equal(JSON.parse(sql(service + snapshotCall())).pin_id, snapshot.pin_id);
  sql(`UPDATE public.pos_store_settings SET max_drawer_cash_limit=5.01,row_version=2 WHERE store_id='${branch}';`);
  const pull = JSON.parse(sql(service + pullCall()));
  assert.equal(pull.status, "OK");
  assert.equal(pull.next_seq, "1");
  assert.equal(pull.groups[0].changes[0].row_data.max_drawer_cash_limit, "5.01");
  assert.equal(JSON.parse(sql(service + snapshotCall())).seq, "1");

  // A branch feed can only emit its own complete settings changes.
  sql(`SELECT pos_sync_feed_v1.append_groups('default', jsonb_build_array(jsonb_build_object(
    'scope_id','${branch}','epoch','${epoch}','changes',jsonb_build_array(
      pos_sync_feed_v1.project_store_settings((SELECT row FROM public.pos_store_settings AS row WHERE store_id='${other}'))
    ))));`);
  denySql(`${service}${pullCall(branch, terminal, proof, "1")}`, /POS_GROUPED_GATEWAY_V1_PROJECTION_UNVERIFIED/);
  sql(`UPDATE public.terminal_tokens SET revoked_at=now() WHERE id='${terminal}';`);
  denySql(`${service}${snapshotCall()}`, /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  console.log("PASS isolated grouped gateway (service-only scope, bound pull, pinned snapshot, refusal of foreign data and revocation)");
}
