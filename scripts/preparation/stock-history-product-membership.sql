-- #401 preparation. Recorded source observations only. Keep unapplied until
-- original-time admission and both report readers consume this evidence.
BEGIN;

DO $guard$
BEGIN
 IF to_regprocedure('private.stock_history_immutable()') IS NULL
  OR to_regprocedure('private.stock_history_capture_state(text,uuid)') IS NULL
  OR to_regclass('public.stock_transfer_items_transfer_idx') IS NULL
 THEN RAISE EXCEPTION 'STOCK_MEMBERSHIP_DEPENDENCY_REQUIRED'; END IF;
 IF to_regclass('private.stock_history_product_membership_observations') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('stock_membership_products','stock_membership_product_owner','stock_membership_transfers','stock_membership_transfer_items'))
 THEN RAISE EXCEPTION 'STOCK_MEMBERSHIP_EXISTING_SCHEMA_REVIEW_REQUIRED'; END IF;
END $guard$;

CREATE TABLE private.stock_history_product_membership_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 product_id uuid NOT NULL,
 store_id text COLLATE "C" CHECK (length(store_id) BETWEEN 1 AND 128 AND btrim(store_id)=store_id),
 event_kind text NOT NULL CHECK (event_kind IN ('product_created','product_deleted','direct_owner_added','direct_owner_removed','posted_inbound_seen')),
 source_version integer,
 transfer_id uuid,
 transfer_line_id uuid,
 transfer_version integer,
 source_posted_at timestamptz,
 product_snapshot jsonb CHECK (jsonb_typeof(product_snapshot)='object' AND octet_length(product_snapshot::text)<=8192),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (CASE WHEN event_kind='posted_inbound_seen' THEN store_id IS NOT NULL AND transfer_id IS NOT NULL
  AND transfer_line_id IS NOT NULL AND source_posted_at IS NOT NULL
  ELSE transfer_id IS NULL AND transfer_line_id IS NULL AND transfer_version IS NULL AND source_posted_at IS NULL END)
);
CREATE INDEX stock_membership_observations_branch_product ON private.stock_history_product_membership_observations(store_id,product_id,id DESC);
CREATE UNIQUE INDEX stock_membership_transfer_once_per_observed_revision ON private.stock_history_product_membership_observations
 (transaction_id,transfer_id,transfer_line_id,store_id,product_id,source_version,transfer_version,source_posted_at) NULLS NOT DISTINCT
 WHERE event_kind='posted_inbound_seen';
ALTER TABLE private.stock_history_product_membership_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_product_membership_observations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.stock_history_product_membership_observations_id_seq FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_membership_observations_immutable BEFORE UPDATE OR DELETE ON private.stock_history_product_membership_observations
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();
CREATE TRIGGER stock_membership_observations_no_truncate BEFORE TRUNCATE ON private.stock_history_product_membership_observations
 FOR EACH STATEMENT EXECUTE FUNCTION private.stock_history_immutable();

-- Exact source identity is retained, including after FK cascades remove a
-- product link. Oversized identity remains unknown rather than truncated.
CREATE FUNCTION private.stock_history_membership_identity(p_name text,p_sku text,p_barcode text,p_owner text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN p_name IS NOT NULL AND octet_length(snapshot::text)<=8192 THEN snapshot END
 FROM (SELECT jsonb_build_object('name',p_name,'sku',p_sku,'barcode',p_barcode,'ownerStoreId',p_owner) snapshot) row
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_membership_identity(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_capture_membership_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE old_owner text; new_owner text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT s.id INTO old_owner FROM public.stores s WHERE s.id=OLD.owner_store_id AND s.id COLLATE "C"=OLD.owner_store_id COLLATE "C"
   AND length(s.id) BETWEEN 1 AND 128 AND btrim(s.id)=s.id;
  IF TG_OP='DELETE' OR old_owner IS NOT NULL THEN
   INSERT INTO private.stock_history_product_membership_observations(product_id,store_id,event_kind,source_version,product_snapshot)
   VALUES(OLD.id,old_owner,CASE WHEN TG_OP='DELETE' THEN 'product_deleted' ELSE 'direct_owner_removed' END,OLD.row_version,
    private.stock_history_membership_identity(OLD.name,OLD.sku,OLD.barcode,OLD.owner_store_id));
  END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT s.id INTO new_owner FROM public.stores s WHERE s.id=NEW.owner_store_id AND s.id COLLATE "C"=NEW.owner_store_id COLLATE "C"
   AND length(s.id) BETWEEN 1 AND 128 AND btrim(s.id)=s.id;
  IF TG_OP='INSERT' OR new_owner IS NOT NULL THEN
   INSERT INTO private.stock_history_product_membership_observations(product_id,store_id,event_kind,source_version,product_snapshot)
   VALUES(NEW.id,new_owner,CASE WHEN TG_OP='INSERT' THEN 'product_created' ELSE 'direct_owner_added' END,NEW.row_version,
    private.stock_history_membership_identity(NEW.name,NEW.sku,NEW.barcode,NEW.owner_store_id));
  END IF;
 END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_membership_product() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_membership_products AFTER INSERT OR DELETE ON public.products
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_capture_membership_product();
CREATE TRIGGER stock_membership_product_owner AFTER UPDATE ON public.products FOR EACH ROW
 WHEN (OLD.owner_store_id COLLATE "C" IS DISTINCT FROM NEW.owner_store_id COLLATE "C")
 EXECUTE FUNCTION private.stock_history_capture_membership_product();

-- Record the direct destination only. A completed receipt must have the
-- canonical verified stamp and a positive verified line. Old inferred
-- receipts and shared-cluster visibility are separate sources of uncertainty.
CREATE FUNCTION private.stock_history_observe_inbound_membership(p_transfer uuid,p_line uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF p_line IS NULL AND (SELECT count(*) FROM (SELECT 1 FROM public.stock_transfer_items i WHERE i.transfer_id=p_transfer LIMIT 101) bounded)>100 THEN
  RETURN;
 END IF;
 INSERT INTO private.stock_history_product_membership_observations
  (product_id,store_id,event_kind,source_version,transfer_id,transfer_line_id,transfer_version,source_posted_at,product_snapshot)
 SELECT p.id,s.id,'posted_inbound_seen',i.row_version,t.id,i.id,t.row_version,t.posted_at,
  private.stock_history_membership_identity(p.name,p.sku,p.barcode,p.owner_store_id)
 FROM public.stock_transfers t JOIN public.stock_transfer_items i ON i.transfer_id=t.id
 JOIN public.products p ON p.id=i.product_id JOIN public.stores s ON s.id=t.to_store_id AND s.id COLLATE "C"=t.to_store_id COLLATE "C"
 WHERE t.id=p_transfer AND (p_line IS NULL OR i.id=p_line)
  AND t.status IN ('completed','completed_with_discrepancy') AND t.posted_at IS NOT NULL AND t.posted_at=t.verified_at
  AND i.quantity_verified>0 AND length(s.id) BETWEEN 1 AND 128 AND btrim(s.id)=s.id
 ON CONFLICT DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_observe_inbound_membership(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_capture_membership_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.status NOT IN ('completed','completed_with_discrepancy') OR NEW.posted_at IS NULL OR NEW.posted_at IS DISTINCT FROM NEW.verified_at THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.status,OLD.posted_at,OLD.verified_at,OLD.to_store_id COLLATE "C")
  IS NOT DISTINCT FROM ROW(NEW.status,NEW.posted_at,NEW.verified_at,NEW.to_store_id COLLATE "C") THEN RETURN NULL; END IF;
 PERFORM private.stock_history_observe_inbound_membership(NEW.id,NULL);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_membership_transfer() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_membership_transfers AFTER INSERT OR UPDATE OF status,posted_at,verified_at,to_store_id ON public.stock_transfers
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_capture_membership_transfer();

CREATE FUNCTION private.stock_history_capture_membership_transfer_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.product_id IS NULL OR COALESCE(NEW.quantity_verified,0)<=0 THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.transfer_id,OLD.product_id,OLD.quantity_verified)
  IS NOT DISTINCT FROM ROW(NEW.transfer_id,NEW.product_id,NEW.quantity_verified) THEN RETURN NULL; END IF;
 PERFORM private.stock_history_observe_inbound_membership(NEW.transfer_id,NEW.id);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_membership_transfer_item() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_membership_transfer_items AFTER INSERT OR UPDATE OF transfer_id,product_id,quantity_verified ON public.stock_transfer_items
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_capture_membership_transfer_item();

-- Preparation-only reader. An opening identity may include a retired product;
-- a transaction observation also cannot settle the original effective time.
-- No row applies to a historic cutoff until a separate source admits it.
CREATE FUNCTION private.stock_history_product_membership_evidence(p_branch text,p_product uuid,p_cutoff_ticks numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE total bigint; high bigint; sample jsonb;
BEGIN
 IF p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128 OR btrim(p_branch)<>p_branch OR p_product IS NULL
  OR p_cutoff_ticks IS NULL OR p_cutoff_ticks<>trunc(p_cutoff_ticks) OR abs(p_cutoff_ticks)>=100000000000000000000::numeric
 THEN RAISE EXCEPTION 'STOCK_MEMBERSHIP_INVALID_REQUEST'; END IF;
 SELECT count(*),COALESCE(max(o.id),0) INTO total,high
 FROM private.stock_history_product_membership_observations o WHERE o.store_id=p_branch AND o.product_id=p_product;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('observationId',o.id::text,'kind',o.event_kind,'sourceVersion',o.source_version,
  'transferId',o.transfer_id,'transferLineId',o.transfer_line_id,'transferVersion',o.transfer_version,
  'sourcePostedAt',o.source_posted_at,'identity',o.product_snapshot,'observedAt',o.observed_at) ORDER BY o.id DESC),'[]'::jsonb)
 INTO sample FROM (SELECT * FROM private.stock_history_product_membership_observations r
  WHERE r.store_id=p_branch AND r.product_id=p_product ORDER BY r.id DESC LIMIT 20) o;
 RETURN jsonb_build_object('branchId',p_branch,'productId',p_product,'cutoffTicks',trunc(p_cutoff_ticks)::text,
  'revision','stock-membership.v1:'||total::text||':'||high::text,'observations',sample,'hasMoreObservations',total>20,
  'status',CASE WHEN total=0 THEN 'unknown' ELSE 'recorded_unresolved' END,'membershipVerified',false,
  'reason',CASE WHEN total=0 THEN 'NO_SCOPED_MEMBERSHIP_EVIDENCE' ELSE 'ORIGINAL_MEMBERSHIP_TIME_UNVERIFIED' END);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_product_membership_evidence(text,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
