-- Prepared SQL for an isolated PostgreSQL fixture. Execute as the database
-- owner in one transaction. Hosted execution requires separate approval.
-- There are no callers, triggers, API grants or Realtime changes in this slice.
CREATE SCHEMA pos_sync_feed_v1;
REVOKE ALL ON SCHEMA pos_sync_feed_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE pos_sync_feed_v1.feed_heads (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  head_seq bigint NOT NULL DEFAULT 0,
  replay_floor bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, scope_id),
  CHECK (replay_floor >= 0 AND replay_floor <= head_seq)
);

CREATE TABLE pos_sync_feed_v1.feed_groups (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  operation_id uuid,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND changes <> '[]'::jsonb),
  PRIMARY KEY (organization_id, scope_id, epoch, seq),
  FOREIGN KEY (organization_id, scope_id)
    REFERENCES pos_sync_feed_v1.feed_heads (organization_id, scope_id)
);

ALTER TABLE pos_sync_feed_v1.feed_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.feed_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.feed_heads, pos_sync_feed_v1.feed_groups
  FROM PUBLIC, anon, authenticated, service_role;

-- A future authoritative writer must submit all affected scopes in one call
-- in its domain transaction. It must authorize and project each change first.
-- Provision each head and its epoch explicitly before a writer uses it.
CREATE FUNCTION pos_sync_feed_v1.append_groups(p_organization_id text, p_groups jsonb)
RETURNS TABLE(scope_id text, epoch uuid, seq text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $append_groups$
DECLARE
  v_group jsonb;
  v_scope text;
  v_previous_scope text;
  v_epoch uuid;
  v_seq bigint;
  -- Provisional preparation bounds. Leave room for the native download
  -- envelope and confirm group and fan-out sizes in the isolated pilot.
  v_max_request_bytes constant integer := 5242880;
  v_max_group_bytes constant integer := 1048576;
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = ''
     OR octet_length(p_organization_id) > 256
     OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_FEED_V1_INVALID_GROUPS';
  END IF;

  IF jsonb_array_length(p_groups) NOT BETWEEN 1 AND 64
     OR octet_length(p_groups::text) > v_max_request_bytes THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_FEED_V1_INVALID_GROUPS';
  END IF;

  -- Validate the bounded request before taking the first row lock.
  FOR v_group IN
    SELECT entry.value FROM jsonb_array_elements(p_groups) AS entry(value)
    ORDER BY (entry.value->>'scope_id') COLLATE "C"
  LOOP
    IF jsonb_typeof(v_group) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_group->'scope_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_group->'epoch') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_group->'changes') IS DISTINCT FROM 'array'
       OR (v_group ? 'operation_id' AND jsonb_typeof(v_group->'operation_id') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_FEED_V1_INVALID_GROUPS';
    END IF;

    v_scope := v_group->>'scope_id';
    IF btrim(v_scope) = '' OR octet_length(v_scope) > 256
       OR v_scope COLLATE "C" = v_previous_scope COLLATE "C"
       OR v_group - ARRAY['scope_id', 'epoch', 'changes', 'operation_id'] <> '{}'::jsonb
       OR v_group->'changes' = '[]'::jsonb
       OR octet_length(v_group::text) > v_max_group_bytes
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_group->'changes') AS change(value)
                  WHERE jsonb_typeof(change.value) <> 'object') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_FEED_V1_INVALID_GROUPS';
    END IF;

    PERFORM (v_group->>'epoch')::uuid, (v_group->>'operation_id')::uuid;
    v_previous_scope := v_scope;
  END LOOP;

  FOR v_group IN
    SELECT entry.value FROM jsonb_array_elements(p_groups) AS entry(value)
    ORDER BY (entry.value->>'scope_id') COLLATE "C"
  LOOP
    v_scope := v_group->>'scope_id';
    v_epoch := (v_group->>'epoch')::uuid;

    -- The UPDATE locks this scope until transaction end. Its sequence and
    -- group either become visible together or both roll back.
    UPDATE pos_sync_feed_v1.feed_heads AS head
    SET head_seq = head.head_seq + 1
    WHERE head.organization_id = p_organization_id AND head.scope_id = v_scope AND head.epoch = v_epoch
    RETURNING head.head_seq INTO v_seq;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH';
    END IF;

    INSERT INTO pos_sync_feed_v1.feed_groups (organization_id, scope_id, epoch, seq, operation_id, changes)
    VALUES (p_organization_id, v_scope, v_epoch, v_seq, (v_group->>'operation_id')::uuid, v_group->'changes');

    -- Decimal text preserves bigint precision in JSON clients.
    RETURN QUERY SELECT v_scope, v_epoch, v_seq::text;
  END LOOP;
END;
$append_groups$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.append_groups(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
