import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function verifyNamedApprovalWake({ sql, denySql }) {
  const request = randomUUID(), named = randomUUID(), other = randomUUID(), machine = randomUUID();
  const preparation = await readFile(new URL("../preparation/pos-named-approval-wake-v1.sql", import.meta.url), "utf8");
  sql(`
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE SCHEMA realtime;
    GRANT USAGE ON SCHEMA private, realtime TO authenticated;
    GRANT USAGE ON SCHEMA realtime TO anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('fixture.subject', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('fixture.role', true), '')
    $$;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('fixture.topic', true), '')
    $$;
    CREATE TABLE realtime.messages (topic text, extension text, event text, payload jsonb, private boolean);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;
    CREATE POLICY broad_fixture_read ON realtime.messages FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY broad_fixture_send ON realtime.messages FOR INSERT TO anon, authenticated WITH CHECK (true);
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$
      INSERT INTO realtime.messages VALUES ($3, 'broadcast', $2, $1, $4)
    $$;
    CREATE TABLE public.app_users (
      user_id text, auth_user_id uuid, email text, store_id text, is_active boolean, permissions jsonb
    );
    CREATE TABLE public.authorization_requests (
      id uuid, store_id text, action_key text, requested_by text, approval_route jsonb
    );
    CREATE TABLE public.authorization_actions (
      action_key text, scope_type text, scope_id text, mode text, is_enabled boolean, allowed_user_ids text[]
    );
    INSERT INTO app_users VALUES
      ('Named', '${named}', 'staff@test.invalid', 'B', true, '{}'),
      ('Other', '${other}', 'other@test.invalid', 'B', true, '{}'),
      ('Machine', '${machine}', 'terminal.example@pos.local', 'B', true, '{}');
    INSERT INTO authorization_requests VALUES ('${request}', 'A', 'refund', 'requester',
      '{"ruleScopeType":"global","primaryUserIds":["named","machine"],"primaryApprovers":[{"id":"Named"},{"id":"Other"},{"id":"Machine"}]}');
    INSERT INTO authorization_actions VALUES ('refund', 'global', '', 'request', true, ARRAY['Named','Machine','Other']);
    BEGIN; ${preparation} COMMIT;
  `);
  const send = `SELECT public.pos_send_named_approval_wake_v1('${request}');`;
  const serviceSend = () => sql("SET ROLE service_role; SET fixture.role='service_role';" + send);
  const topic = `pos-approval-wake:v1:${named}`;
  const read = (role, subject, channel = topic) =>
    sql(`SET ROLE ${role}; SET fixture.subject='${subject}'; SET fixture.topic='${channel}';
      SELECT count(*) FROM realtime.messages WHERE topic='${channel}';`);
  denySql("SET ROLE authenticated; SET fixture.role='service_role';" + send, /permission denied/);
  denySql("SET ROLE service_role;" + send, /POS_NAMED_APPROVAL_WAKE_FORBIDDEN/);
  serviceSend();
  assert.equal(sql("SELECT topic, extension, event, payload, private FROM realtime.messages;"),
    `${topic}|broadcast|approval_changed|{}|t`);
  assert.equal(read("authenticated", named), "1");
  assert.equal(read("authenticated", other), "0");
  assert.equal(read("anon", named), "0");
  assert.equal(sql(`SET ROLE authenticated; SET fixture.subject='${other}'; SET fixture.topic='ordinary-topic';
    SELECT count(*) FROM realtime.messages WHERE topic='${topic}';`), "0");
  denySql(`SET ROLE authenticated; SET fixture.subject='${named}'; SET fixture.topic='${topic}';
    INSERT INTO realtime.messages VALUES ('${topic}', 'broadcast', 'approval_changed', '{}', true);`, /row-level security/);
  denySql(`SET ROLE authenticated; SET fixture.subject='${named}'; SET fixture.topic='ordinary-topic';
    INSERT INTO realtime.messages VALUES ('${topic}', 'broadcast', 'approval_changed', '{}', true);`, /row-level security/);
  sql("INSERT INTO realtime.messages VALUES ('ordinary-topic', 'broadcast', 'unrelated', '{}', false);");
  assert.equal(read("authenticated", other, "ordinary-topic"), "1");

  sql("UPDATE authorization_actions SET allowed_user_ids=ARRAY['Named','!nAmEd','Other'];");
  serviceSend();
  sql("UPDATE authorization_actions SET allowed_user_ids=ARRAY['Named'];");
  sql("UPDATE app_users SET permissions='{\"approval_scope:configured\":true,\"approval_scope:all\":true}' WHERE user_id='Named';");
  serviceSend();
  sql("UPDATE app_users SET permissions='{}', is_active=false WHERE user_id='Named';");
  serviceSend();
  assert.equal(read("authenticated", named), "0");
  sql("UPDATE app_users SET is_active=true WHERE user_id='Named';");
  sql("INSERT INTO authorization_actions VALUES ('refund', 'branch', 'A', 'request', true, ARRAY['Named']);");
  serviceSend();
  assert.equal(sql(`SELECT count(*) FROM realtime.messages WHERE topic='${topic}';`), "1");
  console.log("PASS private named approval wake (exact recipient, no client send, current rule, revocation, unrelated topics)");
}
