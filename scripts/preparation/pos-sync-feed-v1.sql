-- Prepared SQL for an isolated PostgreSQL fixture. Execute as the database
-- owner in one transaction. Hosted execution requires separate approval.
-- This preparation has no deployed callers, triggers, API grants or Realtime changes.
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

-- A trusted relay must resolve the authorized organization and scope before
-- calling this reader. STABLE gives the head and group reads one MVCC snapshot,
-- including when replay retention advances concurrently.
CREATE FUNCTION pos_sync_feed_v1.pull_groups(
  p_organization_id text,
  p_scope_id text,
  p_epoch uuid,
  p_after_seq text,
  p_upper_seq text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $pull_groups$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_record record;
  v_after bigint;
  v_upper bigint;
  v_next bigint;
  v_group jsonb;
  v_groups jsonb[] := ARRAY[]::jsonb[];
  v_group_bytes integer;
  v_bytes integer := 2;
  -- Keep the complete response below the native 2 MiB ceiling with room for
  -- the scope, cursor fields and transport envelope.
  v_max_groups_bytes constant integer := 2097152 - 4096;
  v_byte_limit_reached boolean := false;
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = ''
     OR octet_length(p_organization_id) > 256
     OR p_scope_id IS NULL OR btrim(p_scope_id) = '' OR octet_length(p_scope_id) > 256
     OR p_epoch IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('status', 'INVALID_REQUEST');
  END IF;

  -- Validate textual shape and range before casting so JSON clients can round
  -- trip the full nonnegative bigint range without floating-point conversion.
  IF p_after_seq IS NULL OR p_after_seq !~ '^(0|[1-9][0-9]{0,18})$'
     OR (p_upper_seq IS NOT NULL AND p_upper_seq !~ '^(0|[1-9][0-9]{0,18})$') THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  IF p_after_seq::numeric > 9223372036854775807
     OR p_upper_seq::numeric > 9223372036854775807 THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  v_after := p_after_seq::bigint;

  SELECT head.* INTO v_head
  FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_scope_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE');
  END IF;
  IF v_head.epoch <> p_epoch THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'EPOCH_MISMATCH');
  END IF;
  IF v_after < v_head.replay_floor THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'REPLAY_EXPIRED');
  END IF;

  v_upper := coalesce(p_upper_seq::bigint, v_head.head_seq);
  IF v_upper < v_after OR v_upper > v_head.head_seq THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  v_next := v_after;

  FOR v_record IN
    SELECT feed.seq, feed.operation_id, feed.changes
    FROM pos_sync_feed_v1.feed_groups AS feed
    WHERE feed.organization_id = p_organization_id AND feed.scope_id = p_scope_id
      AND feed.epoch = p_epoch AND feed.seq > v_after AND feed.seq <= v_upper
    ORDER BY feed.seq
    LIMIT p_limit
  LOOP
    IF v_record.seq - 1 <> v_next THEN
      RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'FEED_GAP');
    END IF;
    v_group := jsonb_build_object(
      'seq', v_record.seq::text, 'operation_id', v_record.operation_id, 'changes', v_record.changes
    );
    v_group_bytes := octet_length(v_group::text) + 2;
    IF v_bytes + v_group_bytes > v_max_groups_bytes THEN
      IF v_next = v_after THEN
        RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'GROUP_TOO_LARGE');
      END IF;
      v_byte_limit_reached := true;
      EXIT;
    END IF;
    v_groups := array_append(v_groups, v_group);
    v_bytes := v_bytes + v_group_bytes;
    v_next := v_record.seq;
  END LOOP;

  IF v_next < v_upper AND cardinality(v_groups) < p_limit AND NOT v_byte_limit_reached THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'FEED_GAP');
  END IF;
  RETURN jsonb_build_object(
    'status', 'OK', 'scope_id', p_scope_id, 'epoch', p_epoch,
    'next_seq', v_next::text, 'upper_seq', v_upper::text,
    'has_more', v_next < v_upper, 'groups', to_jsonb(v_groups)
  );
END;
$pull_groups$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.pull_groups(text, text, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE pos_sync_feed_v1.snapshot_pins (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  pin_id uuid NOT NULL,
  epoch uuid NOT NULL,
  protected_seq bigint NOT NULL CHECK (protected_seq >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, scope_id, pin_id),
  FOREIGN KEY (organization_id, scope_id)
    REFERENCES pos_sync_feed_v1.feed_heads (organization_id, scope_id)
);
CREATE INDEX snapshot_pins_scope_expiry
  ON pos_sync_feed_v1.snapshot_pins (organization_id, scope_id, expires_at, pin_id);
ALTER TABLE pos_sync_feed_v1.snapshot_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.snapshot_pins FROM PUBLIC, anon, authenticated, service_role;

-- Commit the pin before opening a repeatable-read export. The exporter must
-- read its canonical projection and current head together, require the same
-- epoch and a head at or above protected_seq, and confirm the pin is still
-- live before offering the export. The pin itself is only a retention fence.
CREATE FUNCTION pos_sync_feed_v1.create_snapshot_pin(
  p_organization_id text,
  p_scope_id text,
  p_epoch uuid,
  p_ttl_seconds integer DEFAULT 3600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $create_snapshot_pin$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_pin_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = ''
     OR octet_length(p_organization_id) > 256
     OR p_scope_id IS NULL OR btrim(p_scope_id) = '' OR octet_length(p_scope_id) > 256
     OR p_epoch IS NULL OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 3600 THEN
    RETURN jsonb_build_object('status', 'INVALID_REQUEST');
  END IF;

  SELECT head.* INTO v_head
  FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_scope_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE');
  END IF;
  IF v_head.epoch <> p_epoch THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'EPOCH_MISMATCH');
  END IF;

  v_pin_id := gen_random_uuid();
  v_expires_at := clock_timestamp() + make_interval(secs => p_ttl_seconds);
  INSERT INTO pos_sync_feed_v1.snapshot_pins (organization_id, scope_id, pin_id, epoch, protected_seq, expires_at)
  VALUES (p_organization_id, p_scope_id, v_pin_id, p_epoch, v_head.head_seq, v_expires_at);

  RETURN jsonb_build_object(
    'status', 'OK', 'pin_id', v_pin_id, 'epoch', p_epoch,
    'protected_seq', v_head.head_seq::text, 'expires_at', v_expires_at
  );
END;
$create_snapshot_pin$;

-- The trusted retention worker chooses an eligible through-sequence. Lock
-- the same head as pin creation and append before pruning pins or deleting a
-- bounded prefix. The replay floor and removed groups commit together.
CREATE FUNCTION pos_sync_feed_v1.retire_groups(
  p_organization_id text,
  p_scope_id text,
  p_epoch uuid,
  p_through_seq text,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $retire_groups$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_now timestamptz;
  v_through bigint;
  v_pin bigint;
  v_ceiling bigint;
  v_floor bigint;
  v_deleted bigint;
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = ''
     OR octet_length(p_organization_id) > 256
     OR p_scope_id IS NULL OR btrim(p_scope_id) = '' OR octet_length(p_scope_id) > 256
     OR p_epoch IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RETURN jsonb_build_object('status', 'INVALID_REQUEST');
  END IF;
  IF p_through_seq IS NULL OR p_through_seq !~ '^(0|[1-9][0-9]{0,18})$' THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  IF p_through_seq::numeric > 9223372036854775807 THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  v_through := p_through_seq::bigint;

  SELECT head.* INTO v_head
  FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_scope_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE');
  END IF;
  IF v_head.epoch <> p_epoch THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'EPOCH_MISMATCH');
  END IF;
  IF v_through > v_head.head_seq THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;

  v_now := clock_timestamp();
  DELETE FROM pos_sync_feed_v1.snapshot_pins AS pin
  USING (
    SELECT candidate.pin_id
    FROM pos_sync_feed_v1.snapshot_pins AS candidate
    WHERE candidate.organization_id = p_organization_id AND candidate.scope_id = p_scope_id
      AND candidate.expires_at <= v_now
    ORDER BY candidate.expires_at, candidate.pin_id
    LIMIT p_limit
  ) AS expired
  WHERE pin.organization_id = p_organization_id AND pin.scope_id = p_scope_id
    AND pin.pin_id = expired.pin_id;

  SELECT min(pin.protected_seq) INTO v_pin
  FROM pos_sync_feed_v1.snapshot_pins AS pin
  WHERE pin.organization_id = p_organization_id AND pin.scope_id = p_scope_id
    AND pin.epoch = p_epoch AND pin.expires_at > v_now;
  v_ceiling := greatest(v_head.replay_floor, least(v_through, coalesce(v_pin, v_through)));
  v_floor := v_head.replay_floor + least(v_ceiling - v_head.replay_floor, p_limit);
  IF v_floor > v_head.replay_floor THEN
    DELETE FROM pos_sync_feed_v1.feed_groups AS feed
    WHERE feed.organization_id = p_organization_id AND feed.scope_id = p_scope_id
      AND feed.epoch = p_epoch AND feed.seq > v_head.replay_floor AND feed.seq <= v_floor;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> v_floor - v_head.replay_floor THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POS_FEED_V1_RETENTION_GAP';
    END IF;
    UPDATE pos_sync_feed_v1.feed_heads AS head SET replay_floor = v_floor
    WHERE head.organization_id = p_organization_id AND head.scope_id = p_scope_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK', 'replay_floor', v_floor::text, 'has_more', v_floor < v_ceiling,
    'blocked_by_pin', coalesce(v_pin < v_through, false)
  );
END;
$retire_groups$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.create_snapshot_pin(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pos_sync_feed_v1.retire_groups(text, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
