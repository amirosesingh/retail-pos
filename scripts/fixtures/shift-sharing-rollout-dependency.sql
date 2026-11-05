-- Test-only captured FIN62 cohort dependency; no approvals inserted.
-- Captured prefix SHA256 a320bf4c9c293233ee451cd228fcb77b57385b3be17c988732e5e6b4ccc100f6
CREATE SCHEMA fin62_history_preparation; REVOKE ALL ON SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_HISTORY_IMMUTABLE';END $$;
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

COMMIT;
