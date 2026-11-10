import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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

  const pinPreparation = await readFile(new URL("../preparation/pos-pin-approval-wake-v1.sql", import.meta.url), "utf8");
  const pinRequest = randomUUID();
  const pinTopic = person => `pos-pin-approval-wake:v1:${createHash("sha256").update(`a\x1f${person}`).digest("hex")}`;
  const requesterTopic = pinTopic("requester"), supervisorTopic = pinTopic("supervisor");
  const insert = `INSERT INTO authorization_requests(id,store_id,action_key,requested_by,approval_route)
    VALUES ('${pinRequest}', 'A', 'refund', 'Requester',
      '{"primaryApprovers":[{"id":"Supervisor"},{"id":"Named"},{"id":"Inactive"}]}');`;
  sql(`
    ALTER TABLE authorization_requests ADD COLUMN status text NOT NULL DEFAULT 'pending',
      ADD COLUMN consumed_at timestamptz;
    CREATE TABLE activity_events (store_id text, entity_type text, event_type text, meta jsonb,
      terminal_id text, entity_id text);
    INSERT INTO app_users VALUES
      ('Requester', NULL, 'requester@test.invalid', 'A', true, '{}'),
      ('Supervisor', NULL, 'supervisor@test.invalid', 'A', true, '{}'),
      ('Inactive', NULL, 'inactive@test.invalid', 'A', false, '{}');
    BEGIN; ${pinPreparation} COMMIT;
    BEGIN; ${insert} ROLLBACK;
  `);
  const pinMessages = () => sql("SELECT topic,event,payload,private FROM realtime.messages WHERE topic LIKE 'pos-pin-approval-wake:%' ORDER BY topic,event;");
  assert.equal(pinMessages(), "");
  sql(insert);
  assert.deepEqual(pinMessages().split("\n"), [requesterTopic, supervisorTopic].sort().map(topic => `${topic}|approval_changed|{}|t`));

  const pinRead = (claim, channel, role = "anon") => sql(`SET ROLE ${role};
    SET request.jwt.claims='${JSON.stringify(claim ? { pos_pin_approval_wake_topic: claim } : {})}';
    SET fixture.topic='${channel}'; SELECT count(*) FROM realtime.messages WHERE topic='${channel}';`);
  assert.equal(pinRead(requesterTopic, requesterTopic), "1");
  assert.equal(pinRead(requesterTopic, supervisorTopic), "0");
  assert.equal(pinRead(requesterTopic, "ordinary-topic"), "0");
  assert.equal(pinRead(null, requesterTopic), "0");
  assert.equal(pinRead(null, requesterTopic, "authenticated"), "0");
  assert.equal(pinRead(null, "ordinary-topic", "authenticated"), "1");
  denySql(`SET ROLE anon; SET request.jwt.claims='{"pos_pin_approval_wake_topic":"${requesterTopic}"}';
    SET fixture.topic='ordinary-topic';
    INSERT INTO realtime.messages VALUES ('ordinary-topic', 'broadcast', 'forged', '{}', true);`, /row-level security/);
  denySql(`SET ROLE authenticated; SET fixture.topic='ordinary-topic';
    INSERT INTO realtime.messages VALUES ('${requesterTopic}', 'broadcast', 'forged', '{}', true);`, /row-level security/);
  sql(`
    UPDATE authorization_requests SET status='pending' WHERE id='${pinRequest}';
    UPDATE authorization_requests SET status='approved' WHERE id='${pinRequest}';
    UPDATE authorization_requests SET consumed_at=now() WHERE id='${pinRequest}';
    INSERT INTO activity_events(store_id,entity_type,event_type,meta) VALUES
      ('A','authorization_request','approval_granted','{"audience_user_ids":["Requester","Named"]}'),
      ('A','authorization_request','approval_requested','{"audience_user_ids":["Requester"],"notification_routes":{"app":["Supervisor"]}}'),
      ('A','authorization_request','approval_rejected','{"audience_user_ids":["Requester"],"in_app_disabled":true}'),
      ('A','sale','sale_complete','{"audience_user_ids":["Requester"]}');
    INSERT INTO activity_events VALUES
      ('A','authorization_request','approval_granted','{"notification_routes":{"app":[],"terminalApp":["till-a"]}}',
       'till-a','${pinRequest}');
  `);
  const actual = pinMessages().split("\n");
  assert.equal(actual.length, 9);
  for (const topic of [requesterTopic, supervisorTopic]) {
    assert.equal(actual.filter(message => message === `${topic}|approval_changed|{}|t`).length, 3);
    assert.equal(actual.filter(message => message === `${topic}|approval_activity_changed|{}|t`).length, topic === requesterTopic ? 2 : 1);
  }
  console.log("PASS relay-only PIN approval wake (transaction rollback, own recipient, activity delivery, no client publishing)");
}
