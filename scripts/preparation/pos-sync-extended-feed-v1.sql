-- Isolated preparation after the mixed gateway. Arm a scope only after the
-- stock and correction publishers and the legacy overlap guards are installed.
CREATE TABLE pos_sync_feed_v1.extended_pilots (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  armed_after bigint NOT NULL CHECK (armed_after >= 0),
  sealed_after bigint CHECK (sealed_after >= armed_after),
  PRIMARY KEY (organization_id, scope_id, epoch),
  FOREIGN KEY (organization_id, scope_id, epoch) REFERENCES pos_sync_feed_v1.cash_settings_pilots
);
CREATE TABLE pos_sync_feed_v1.extended_publications (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  operation_id uuid,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (organization_id, scope_id, epoch, seq),
  UNIQUE (organization_id, operation_id),
  FOREIGN KEY (organization_id, scope_id, epoch) REFERENCES pos_sync_feed_v1.extended_pilots
);
CREATE TABLE pos_sync_feed_v1.correction_owners (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  table_name text COLLATE "C" NOT NULL,
  entity_id uuid NOT NULL,
  row_version integer NOT NULL CHECK (row_version > 0),
  seq bigint NOT NULL,
  PRIMARY KEY (organization_id, scope_id, epoch, table_name, entity_id, row_version, seq),
  FOREIGN KEY (organization_id, scope_id, epoch, seq) REFERENCES pos_sync_feed_v1.extended_publications
);
ALTER TABLE pos_sync_feed_v1.extended_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.extended_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.correction_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.extended_pilots, pos_sync_feed_v1.extended_publications,
  pos_sync_feed_v1.correction_owners FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.extended_read_epoch(p_org text, p_branch text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $scope$
BEGIN
  RETURN (SELECT head.epoch FROM pos_sync_feed_v1.feed_heads AS head
    JOIN pos_sync_feed_v1.extended_pilots AS pilot USING (organization_id, scope_id, epoch)
    JOIN pos_sync_feed_v1.stock_pilots AS stock USING (organization_id, scope_id, epoch)
    WHERE head.organization_id=p_org AND head.scope_id=p_branch);
END;
$scope$;

CREATE FUNCTION pos_sync_feed_v1.extended_scope_epoch(p_org text,p_branch text)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
RETURN (SELECT pilot.epoch FROM pos_sync_feed_v1.extended_pilots AS pilot
  WHERE (pilot.organization_id,pilot.scope_id,pilot.epoch)=(p_org,p_branch,pos_sync_feed_v1.extended_read_epoch(p_org,p_branch))
    AND pilot.sealed_after IS NULL);

CREATE FUNCTION pos_sync_feed_v1.arm_extended_scope(p_org text, p_branch text, p_epoch uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $arm$
DECLARE
  v_head bigint;
BEGIN
  SELECT head.head_seq INTO v_head FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.cash_settings_pilots AS mixed USING (organization_id, scope_id, epoch)
  JOIN pos_sync_feed_v1.stock_pilots AS stock USING (organization_id, scope_id, epoch)
  WHERE (head.organization_id,head.scope_id,head.epoch)=(p_org,p_branch,p_epoch)
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_BASELINE_UNVERIFIED'; END IF;
  UPDATE pos_sync_feed_v1.feed_heads SET head_seq=head_seq
  WHERE (organization_id,scope_id,epoch)=(p_org,p_branch,p_epoch);
  INSERT INTO pos_sync_feed_v1.extended_pilots(organization_id,scope_id,epoch,armed_after) VALUES (p_org,p_branch,p_epoch,v_head);
END;
$arm$;

-- Seal only after the enrolled senders have stopped new capture and drained.
-- The archived prefix remains readable and this epoch cannot be reopened.
CREATE FUNCTION pos_sync_feed_v1.seal_extended_scope(p_org text,p_branch text,p_epoch uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $seal$
DECLARE
  v_head bigint;
  v_sealed bigint;
BEGIN
  SELECT head_seq INTO STRICT v_head FROM pos_sync_feed_v1.feed_heads
  WHERE (organization_id,scope_id,epoch)=(p_org,p_branch,p_epoch) FOR NO KEY UPDATE;
  UPDATE pos_sync_feed_v1.extended_pilots SET sealed_after=coalesce(sealed_after,v_head)
  WHERE (organization_id,scope_id,epoch)=(p_org,p_branch,p_epoch)
  RETURNING sealed_after INTO STRICT v_sealed;
  UPDATE pos_sync_feed_v1.feed_heads SET head_seq=head_seq
  WHERE (organization_id,scope_id,epoch)=(p_org,p_branch,p_epoch);
  RETURN v_sealed;
END;
$seal$;

CREATE FUNCTION pos_sync_feed_v1.append_extended_group(
  p_org text, p_branch text, p_epoch uuid, p_operation uuid, p_changes jsonb, p_metadata jsonb
)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $append$
DECLARE
  v_seq bigint;
  v_correction boolean;
BEGIN
  IF pos_sync_feed_v1.extended_scope_epoch(p_org,p_branch) IS DISTINCT FROM p_epoch OR p_epoch IS NULL
     OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
     OR octet_length((p_changes || jsonb_build_array(p_metadata))::text)>262144 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_PUBLICATION_UNVERIFIED';
  END IF;
  v_correction := p_metadata ? 'financial';
  IF v_correction THEN
    IF p_operation IS NULL OR p_metadata - 'financial' <> '{}'::jsonb OR
       jsonb_typeof(p_metadata->'financial') IS DISTINCT FROM 'object' OR
       (p_metadata->'financial') - ARRAY['kind','sale_id'] <> '{}'::jsonb OR
       coalesce(p_metadata->'financial'->>'kind','') NOT IN ('refund_v1','tender_v1') OR
       p_changes->0->>'table_name' IS DISTINCT FROM 'sales' OR
       p_changes->0->'row_data'->>'id' IS DISTINCT FROM p_metadata->'financial'->>'sale_id' OR
       p_changes->0->'row_data'->>'store_id' IS DISTINCT FROM p_branch THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_CORRECTION_UNVERIFIED';
    END IF;
  ELSIF p_operation IS NOT NULL OR p_metadata <> '{"stock":true}'::jsonb OR
        NOT pos_sync_feed_v1.is_live_stock_projection(p_changes,p_branch) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_STOCK_UNVERIFIED';
  END IF;

  SELECT result.seq::bigint INTO STRICT v_seq FROM pos_sync_feed_v1.append_groups(p_org,
    jsonb_build_array(jsonb_build_object('scope_id',p_branch,'epoch',p_epoch,
      'operation_id',p_operation,'changes',p_changes))) AS result;
  IF pos_sync_feed_v1.extended_scope_epoch(p_org,p_branch) IS DISTINCT FROM p_epoch THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_SCOPE_SEALED';
  END IF;
  INSERT INTO pos_sync_feed_v1.extended_publications
    VALUES(p_org,p_branch,p_epoch,v_seq,p_operation,p_changes,p_metadata);
  IF v_correction THEN
    INSERT INTO pos_sync_feed_v1.correction_owners
    SELECT p_org,p_branch,p_epoch,change->>'table_name',
      ((change->>'entity_id')::jsonb->>CASE WHEN change->>'table_name'='stock_delta_applied' THEN 'movement_id' ELSE 'id' END)::uuid,
      (change->>'row_version')::integer,v_seq
    FROM jsonb_array_elements(p_changes) AS change
    WHERE change->>'table_name' IN ('sales','sale_items','payment_transactions','stock_delta_applied')
      AND NOT (change->>'table_name'='sales' AND p_metadata->'financial'->>'kind'='refund_v1'
        AND change->'row_data'->>'is_refunded'='false');
  END IF;
  RETURN v_seq;
END;
$append$;

CREATE OR REPLACE FUNCTION pos_sync_feed_v1.assert_cash_settings_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pos_sync_feed_v1.feed_groups AS feed
    JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
    LEFT JOIN pos_sync_feed_v1.cash_publications AS cash USING (organization_id, scope_id, epoch, seq)
    LEFT JOIN pos_sync_feed_v1.extended_publications AS extended USING (organization_id, scope_id, epoch, seq)
    LEFT JOIN pos_sync_feed_v1.extended_pilots AS cohort USING (organization_id,scope_id,epoch)
    WHERE (feed.organization_id,feed.scope_id,feed.epoch,feed.seq) =
      (NEW.organization_id,NEW.scope_id,NEW.epoch,NEW.seq)
      AND NOT (CASE WHEN cash.operation_id IS NOT NULL
        THEN (cohort.sealed_after IS NULL OR feed.seq<=cohort.sealed_after)
          AND (cash.operation_id,cash.changes) IS NOT DISTINCT FROM (feed.operation_id,feed.changes)
        WHEN extended.seq IS NOT NULL
        THEN (cohort.sealed_after IS NULL OR feed.seq<=cohort.sealed_after)
          AND (extended.operation_id,extended.changes) IS NOT DISTINCT FROM (feed.operation_id,feed.changes)
        ELSE pos_sync_feed_v1.is_settings_projection(feed.changes,feed.scope_id)
      END)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  RETURN NULL;
END;
$guard$;

CREATE FUNCTION pos_sync_feed_v1.retire_extended_stock_group()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $retire$
BEGIN
  DELETE FROM pos_sync_feed_v1.extended_publications AS archived
  WHERE (archived.organization_id,archived.scope_id,archived.epoch,archived.seq)=
    (OLD.organization_id,OLD.scope_id,OLD.epoch,OLD.seq) AND archived.metadata = '{"stock":true}'::jsonb;
  RETURN NULL;
END;
$retire$;
CREATE TRIGGER pos_sync_retire_extended_stock AFTER DELETE ON pos_sync_feed_v1.feed_groups
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.retire_extended_stock_group();

CREATE FUNCTION public.pos_sync_pull_cash_settings_extended_v1(
  p_organization_id text,p_branch_id text,p_terminal_id uuid,p_binding_proof text,
  p_epoch uuid,p_after_seq text,p_upper_seq text,p_limit integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $pull$
DECLARE
  v_epoch uuid;
  v_armed bigint;
  v_sealed bigint;
  v_page jsonb;
  v_groups jsonb;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id,p_branch_id,p_terminal_id,p_binding_proof);
  v_epoch := pos_sync_feed_v1.extended_read_epoch(p_organization_id,p_branch_id);
  IF v_epoch IS NULL THEN RETURN jsonb_build_object('status','SCOPE_UNAVAILABLE'); END IF;
  v_page := pos_sync_feed_v1.pull_groups(p_organization_id,p_branch_id,p_epoch,p_after_seq,p_upper_seq,p_limit);
  IF v_page->>'status' <> 'OK' THEN RETURN v_page; END IF;
  SELECT armed_after,sealed_after INTO STRICT v_armed,v_sealed FROM pos_sync_feed_v1.extended_pilots
  WHERE (organization_id,scope_id,epoch)=(p_organization_id,p_branch_id,v_epoch);
  IF p_after_seq::bigint < v_armed THEN
    RETURN jsonb_build_object('status','SNAPSHOT_REQUIRED','reason','REPLAY_EXPIRED');
  END IF;
  SELECT coalesce(jsonb_agg(
    CASE WHEN cash.operation_id IS NOT NULL AND cash.stock_after IS NOT NULL THEN
           page.value || jsonb_build_object('acceptance',cash.acceptance,'stock',cash.stock_after)
         WHEN extended.seq IS NOT NULL AND extended.metadata ? 'financial' THEN page.value || extended.metadata
         WHEN extended.seq IS NOT NULL OR pos_sync_feed_v1.is_settings_projection(page.value->'changes',p_branch_id)
           THEN page.value
    END ORDER BY page.ordinal),'[]'::jsonb) INTO v_groups
  FROM jsonb_array_elements(v_page->'groups') WITH ORDINALITY AS page(value,ordinal)
  LEFT JOIN pos_sync_feed_v1.cash_publications AS cash ON
    (cash.organization_id,cash.scope_id,cash.epoch,cash.seq,cash.operation_id,cash.changes)=
    (p_organization_id,p_branch_id,v_epoch,(page.value->>'seq')::bigint,(page.value->>'operation_id')::uuid,page.value->'changes')
  LEFT JOIN pos_sync_feed_v1.extended_publications AS extended ON
    (extended.organization_id,extended.scope_id,extended.epoch,extended.seq)=
    (p_organization_id,p_branch_id,v_epoch,(page.value->>'seq')::bigint)
    AND (extended.operation_id,extended.changes) IS NOT DISTINCT FROM ((page.value->>'operation_id')::uuid,page.value->'changes');
  IF v_groups @> '[null]'::jsonb OR octet_length(v_groups::text)>2093056 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_EXTENDED_V1_PUBLICATION_UNVERIFIED';
  END IF;
  v_page := jsonb_set(v_page,'{groups}',v_groups);
  IF v_sealed IS NOT NULL THEN v_page := v_page || jsonb_build_object('sealed_seq',v_sealed::text); END IF;
  RETURN v_page;
END;
$pull$;

CREATE FUNCTION public.pos_sync_extended_legacy_coverage_v1(
  p_organization_id text,p_branch_id text,p_terminal_id uuid,p_binding_proof text,p_epoch uuid,p_entries jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $coverage$
DECLARE
  v_entries jsonb;
  v_epoch uuid;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id,p_branch_id,p_terminal_id,p_binding_proof);
  v_epoch := pos_sync_feed_v1.extended_read_epoch(p_organization_id,p_branch_id);
  IF v_epoch IS NULL OR (p_epoch IS NOT NULL AND p_epoch<>v_epoch) THEN
    RETURN jsonb_build_object('status','SCOPE_UNAVAILABLE');
  END IF;
  IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_EXTENDED_V1_INVALID_KEYS';
  END IF;
  IF jsonb_array_length(p_entries) NOT BETWEEN 1 AND 100 OR octet_length(p_entries::text)>16384 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_entries) AS item(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object' OR value - ARRAY['table_name','id','version'] <> '{}'::jsonb
      OR NOT value ? 'version' OR coalesce(value->>'table_name','') NOT IN
        ('sales','sale_items','payment_transactions','item_activity_logs','stock_delta_applied')
      OR coalesce(value->>'id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      OR NOT (value->'version'='null'::jsonb OR
        (jsonb_typeof(value->'version')='string' AND value->>'version' ~ '^[1-9][0-9]{0,9}$'))) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_EXTENDED_V1_INVALID_KEYS';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('table_name',key.table_name,'id',key.id,'version',key.version,
    'seq',owner.seq::text,'owned',coalesce(owner.owned,false)) ORDER BY key.table_name,key.id,key.version),'[]'::jsonb)
  INTO v_entries
  FROM (SELECT DISTINCT * FROM jsonb_to_recordset(p_entries) AS entry(table_name text,id uuid,version text)) AS key
  CROSS JOIN LATERAL (
    SELECT max(candidate.seq) AS seq,bool_or(candidate.version=key.version::bigint) AS owned FROM (
      SELECT birth.seq,1 AS version FROM pos_sync_feed_v1.cash_receipt_owners AS birth
      WHERE (birth.organization_id,birth.scope_id,birth.epoch,birth.table_name,birth.entity_id)=
        (p_organization_id,p_branch_id,v_epoch,key.table_name,key.id)
      UNION ALL
      SELECT correction.seq,correction.row_version FROM pos_sync_feed_v1.correction_owners AS correction
      WHERE (correction.organization_id,correction.scope_id,correction.epoch,correction.table_name,correction.entity_id)=
        (p_organization_id,p_branch_id,v_epoch,key.table_name,key.id)
    ) AS candidate WHERE key.version IS NULL OR candidate.version<=key.version::bigint
  ) AS owner
  WHERE owner.seq IS NOT NULL;
  RETURN jsonb_build_object('status','OK','scope_id',p_branch_id,'epoch',v_epoch,'entries',v_entries);
END;
$coverage$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.extended_read_epoch(text,text),pos_sync_feed_v1.extended_scope_epoch(text,text),
  pos_sync_feed_v1.arm_extended_scope(text,text,uuid),
  pos_sync_feed_v1.seal_extended_scope(text,text,uuid),
  pos_sync_feed_v1.append_extended_group(text,text,uuid,uuid,jsonb,jsonb),
  pos_sync_feed_v1.retire_extended_stock_group(),
  public.pos_sync_pull_cash_settings_extended_v1(text,text,uuid,text,uuid,text,text,integer),
  public.pos_sync_extended_legacy_coverage_v1(text,text,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull_cash_settings_extended_v1(text,text,uuid,text,uuid,text,text,integer),
  public.pos_sync_extended_legacy_coverage_v1(text,text,uuid,text,uuid,jsonb)
  TO service_role;
