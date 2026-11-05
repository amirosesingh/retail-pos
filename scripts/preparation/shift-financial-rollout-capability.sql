-- PREPARATION ONLY. Empty rollout metadata is not approval or activation.
-- Owner-approved rollout rows require a separately reviewed maintenance plan,
-- including every registered till sharing the branch and existing pending work.
BEGIN;
CREATE SCHEMA fin62_rollout_preparation;
REVOKE ALL ON SCHEMA fin62_rollout_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_rollout_preparation.approvals(
 organization_id text NOT NULL CHECK(length(organization_id) BETWEEN 1 AND 128),
 branch_id text NOT NULL CHECK(length(branch_id) BETWEEN 1 AND 128),
 terminal_id text NOT NULL CHECK(length(terminal_id) BETWEEN 1 AND 128),
 revision bigint NOT NULL CHECK(revision>0),rollout_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('approved','revoked')),
 approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,branch_id,terminal_id,revision)
);
ALTER TABLE fin62_rollout_preparation.approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_rollout_preparation.approvals FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_rollout_preparation.approvals
 FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
-- Private predicate shared with the authorized settings-save trigger. It is
-- not an authentication API and no client/service role can execute it directly.
CREATE FUNCTION fin62_rollout_preparation.cohort_approved(p_org text,p_branch text,p_terminal text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM fin62_rollout_preparation.approvals approval
  WHERE approval.organization_id=p_org AND approval.branch_id=p_branch AND approval.terminal_id=p_terminal AND approval.status='approved'
   AND approval.revision=(SELECT max(latest.revision) FROM fin62_rollout_preparation.approvals latest WHERE latest.organization_id=p_org AND latest.branch_id=p_branch AND latest.terminal_id=p_terminal)
   AND NOT EXISTS(
    SELECT 1 FROM public.terminal_tokens peer
    WHERE peer.location_id=p_branch AND peer.platform='pc' AND peer.status IN('active','used') AND peer.revoked_at IS NULL AND (peer.is_claimed IS TRUE OR peer.claimed_at IS NOT NULL)
     AND NOT EXISTS(
      SELECT 1 FROM fin62_rollout_preparation.approvals permitted
      WHERE permitted.organization_id=p_org AND permitted.branch_id=p_branch AND permitted.terminal_id=peer.id::text
       AND permitted.rollout_id=approval.rollout_id AND permitted.status='approved'
       AND permitted.revision=(SELECT max(latest.revision) FROM fin62_rollout_preparation.approvals latest WHERE latest.organization_id=p_org AND latest.branch_id=p_branch AND latest.terminal_id=peer.id::text)
     )
   )
 );
$$;
REVOKE ALL ON FUNCTION fin62_rollout_preparation.cohort_approved(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pos_sync_financial_capability(p_org text,p_branch text,p_terminal text,p_shift uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE approval fin62_rollout_preparation.approvals%ROWTYPE;mode text:='disabled';shift_mode text;ready jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_CAPABILITY_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal AND location_id=p_branch AND platform='pc' AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed IS TRUE OR claimed_at IS NOT NULL)) THEN RAISE EXCEPTION 'FIN62_CAPABILITY_TERMINAL_DENIED';END IF;
 SELECT * INTO approval FROM fin62_rollout_preparation.approvals WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN mode:=CASE WHEN approval.status='approved' THEN 'required' ELSE 'blocked' END;END IF;
 IF mode='required' THEN
  -- A shared branch must not silently strand an older registered PC when the
  -- first upgraded PC protects a shift. Every active Operations PC must be in
  -- this same explicitly reviewed rollout; Management/mobile are not inferred
  -- to have local SQL financial-write capability.
  IF NOT fin62_rollout_preparation.cohort_approved(p_org,p_branch,p_terminal) THEN mode:='blocked';END IF;
 END IF;
 IF mode='required' THEN
  IF to_regprocedure('public.pos_live_financial_ready()') IS NULL THEN mode:='blocked';
  ELSE
   EXECUTE 'SELECT public.pos_live_financial_ready()' INTO ready;
   IF ready IS DISTINCT FROM '{"ready":true,"version":2}'::jsonb THEN mode:='blocked';END IF;
  END IF;
 END IF;
 IF p_shift IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts WHERE branch_id=p_branch AND shift_id=p_shift) THEN shift_mode:='required';
  ELSIF EXISTS(SELECT 1 FROM public.shifts WHERE id=p_shift AND store_id=p_branch) THEN shift_mode:='legacy';
  ELSE shift_mode:='unknown';END IF;
 END IF;
 RETURN jsonb_build_object('version',1,'mode',mode,'financialProtocol',2,'localSchema',26,'organizationId',p_org,'branchId',p_branch,'terminalId',p_terminal,'rolloutId',approval.rollout_id,'revision',coalesce(approval.revision::text,'0'),'shiftId',p_shift,'shiftMode',shift_mode);
END $$;
REVOKE ALL ON FUNCTION public.pos_sync_financial_capability(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_financial_capability(text,text,text,uuid) TO service_role;
CREATE FUNCTION fin62_rollout_preparation.assert_approved(p_org text,p_branch text,p_terminal text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE capability jsonb;
BEGIN
 capability:=public.pos_sync_financial_capability(p_org,p_branch,p_terminal,NULL);
 IF capability->>'mode' IS DISTINCT FROM 'required' THEN RAISE EXCEPTION 'FIN62_ROLLOUT_NOT_APPROVED';END IF;
END $$;
REVOKE ALL ON FUNCTION fin62_rollout_preparation.assert_approved(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
